import { relative } from 'node:path';
import type { Config } from '../config/configSchema.js';
import { SpecrunError } from '../errors.js';
import { readEvents } from '../events/eventStore.js';
import { deriveState } from '../events/taskState.js';
import { createGit } from '../git/git.js';
import type { ProcessRunner } from '../process/run.js';
import { loadSpec } from '../spec/loadSpec.js';
import { activeSpecFiles, type CliDeps } from './cliDeps.js';
import { selectDeviations } from './deviationListing.js';
import { askYes } from './prompter.js';

export interface AfterRunInput {
  repoRoot: string;
  config: Config;
  /** The spec of `run <spec>`, or every spec of `run --all`. */
  specs: readonly string[];
  /** Runs the specs again; resolves to whether every task is done then. */
  rerun: () => Promise<boolean>;
  /** Starts the deviation review; resolves when Claude exits. */
  review: () => Promise<unknown>;
  close: () => Promise<void>;
  /** The close command the user would type, for hints. */
  closeCommand: string;
  run: ProcessRunner;
}

/** Tasks of `specs` that are not done, from each spec's live copy. */
export function openTasks(repoRoot: string, config: Config, specs: readonly string[]): number {
  let open = 0;
  for (const name of specs) {
    const files = activeSpecFiles(repoRoot, config, name);
    const { spec } = loadSpec(files.base, config, name);
    const state = deriveState(spec, readEvents(files.eventsFile).events);
    open += spec.tasks.filter((task) => state.tasks.get(task.id)?.status !== 'done').length;
  }
  return open;
}

/** Load errors of `specs`' live copies — a review can leave a tasks.yaml the next run rejects. */
function specProblems(repoRoot: string, config: Config, specs: readonly string[]): string[] {
  const problems: string[] = [];
  for (const name of specs) {
    try {
      loadSpec(activeSpecFiles(repoRoot, config, name).base, config, name);
    } catch (error) {
      if (!(error instanceof SpecrunError)) throw error;
      problems.push(error.message);
    }
  }
  return problems;
}

function ask(deps: CliDeps, question: string): Promise<boolean> {
  return askYes(deps.prompter, question);
}

/**
 * SRD-33: after a run that finished every task, on a terminal — review the deviations, commit
 * what the review changed, run the tasks it added, then close.
 */
export async function afterRun(input: AfterRunInput, deps: CliDeps): Promise<void> {
  const { repoRoot, config, specs } = input;
  const workspaces = [
    ...new Set([repoRoot, ...specs.map((name) => activeSpecFiles(repoRoot, config, name).base)]),
  ];
  const where = (path: string): string => relative(repoRoot, path) || 'the main checkout';
  const dirty = async (): Promise<string[]> => {
    const found: string[] = [];
    for (const path of workspaces) {
      if (!(await createGit(path, input.run).isClean())) found.push(path);
    }
    return found;
  };

  if (selectDeviations(repoRoot, config, specs, undefined, false).entries.length > 0) {
    if (!(await ask(deps, 'Run specrun review on the finished specs?'))) return;
    const dirtyBefore = new Set(await dirty());
    await input.review();

    const problems = specProblems(repoRoot, config, specs);
    if (problems.length > 0) {
      deps.stdout(
        `Not committing: the review left an invalid spec — fix it, then commit and run again.\n` +
          `${problems.join('\n')}\n`,
      );
      return;
    }

    // Only what the review changed is offered; earlier changes are the user's own.
    for (const path of await dirty()) {
      if (dirtyBefore.has(path)) continue;
      if (!(await ask(deps, `Commit the review changes in ${where(path)}?`))) {
        deps.stdout(`Not closing: ${where(path)} has uncommitted changes.\n`);
        return;
      }
      const git = createGit(path, input.run);
      await git.addAll();
      const scope = specs.length === 1 ? (specs[0] ?? 'specs') : 'specs';
      await git.commit({
        subject: `docs(${scope}): review deviations`,
        body: '',
        trailers: config.commitTrailers,
      });
    }

    const open = openTasks(repoRoot, config, specs);
    if (open > 0) {
      if (!(await ask(deps, `Run the ${open} new task(s)?`))) return;
      if (!(await input.rerun())) return;
    }
  }

  const left = await dirty();
  if (left.length > 0) {
    deps.stdout(
      `Not offering ${input.closeCommand}: uncommitted changes in ${left.map(where).join(', ')} — ` +
        'commit or stash them first.\n',
    );
    return;
  }
  if (!(await ask(deps, 'Run specrun close on the finished specs?'))) return;
  await input.close();
}

/** Every task of every spec done — the condition for the questions at all. */
export function allDone(repoRoot: string, config: Config, specs: readonly string[]): boolean {
  return specs.length > 0 && openTasks(repoRoot, config, specs) === 0;
}
