import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Config } from '../config/configSchema.js';
import { SpecrunError } from '../errors.js';
import { EVENTS_FILE, readEvents } from '../events/eventStore.js';
import { deriveState, runnableTasks, type SpecState } from '../events/taskState.js';
import { createGit } from '../git/git.js';
import { SHARED_BRANCH, SHARED_ID, sharedWorktreePath } from '../git/workspace.js';
import {
  ensureCheckout,
  ensureWorktree,
  worktreePath,
  type WorktreeStep,
} from '../git/worktree.js';
import type { ProcessRunner } from '../process/run.js';
import { listSpecs, loadSpec, SPEC_FILE, specDir, type LoadedSpec } from '../spec/loadSpec.js';
import { runVerify } from '../verify/verify.js';
import { acquireLock, isProcessAlive, lockFile, type Lock } from './lock.js';
import type { RunReporter } from './reporter.js';
import {
  CHECKOUT_LOCK,
  runSpec,
  workspacePhase,
  type RunResult,
  type RunSpecDeps,
  type RunSpecOptions,
} from './runSpec.js';

export interface RunAllOptions {
  /** Ref the shared branch is created from, and merged into it on later runs. */
  base: string;
  retryBlocked: boolean;
  modelOverride?: string;
}

export interface RunAllDeps extends RunSpecDeps {
  /** Seam for tests. */
  runSpec?: (options: RunSpecOptions, deps: RunSpecDeps) => Promise<RunResult>;
}

export type SpecOutcome =
  | { kind: 'ran'; result: RunResult }
  /** Nothing to do at the start: `done`, or only tasks that wait for blocked ones. */
  | { kind: 'skipped'; reason: 'done' | 'nothing-runnable' }
  /** The run stopped before this spec's turn. */
  | { kind: 'not-run' }
  /** runSpec threw (lock, invalid spec, worktree). */
  | { kind: 'failed'; message: string };

export interface TaskTally {
  done: number;
  total: number;
  blocked: number;
  costUsd: number;
}

export interface SpecSummary {
  spec: string;
  outcome: SpecOutcome;
  tasks: TaskTally;
  /** Cost of this run's sessions. */
  costUsd: number;
  durationMs: number;
}

export interface RunAllResult {
  exitCode: RunResult['exitCode'];
  specs: SpecSummary[];
  /** Commits of the base merged into the shared branch before the first spec. */
  merged: number;
  message?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function tally(loaded: LoadedSpec, state: SpecState): TaskTally {
  const statuses = loaded.spec.tasks.map((task) => state.tasks.get(task.id));
  return {
    done: statuses.filter((s) => s?.status === 'done').length,
    total: statuses.length,
    blocked: statuses.filter((s) => s?.status === 'blocked').length,
    costUsd: statuses.reduce((sum, s) => sum + (s?.totals.costUsd ?? 0), 0),
  };
}

function stateOf(loaded: LoadedSpec): SpecState {
  return deriveState(loaded.spec, readEvents(join(loaded.dir, EVENTS_FILE)).events);
}

/** SRD-31: a spec with a workspace of its own would run twice, from two diverging logs. */
async function ownWorkspaces(
  repoRoot: string,
  names: readonly string[],
  run: ProcessRunner,
): Promise<string[]> {
  const git = createGit(repoRoot, run);
  const found: string[] = [];
  for (const name of names) {
    const path = worktreePath(repoRoot, name);
    if (existsSync(path)) found.push(`${name}: own worktree ${relative(repoRoot, path)}`);
    else if (await git.branchExists(`specrun/${name}`))
      found.push(`${name}: own branch specrun/${name}`);
  }
  return found;
}

/** Brings specs (and code) committed on the base since the last `run --all` into the branch. */
async function mergeBase(
  workspace: string,
  baseSha: string,
  base: string,
  deps: Pick<RunSpecDeps, 'repoRoot' | 'config' | 'run' | 'reporter'>,
): Promise<number> {
  const git = createGit(workspace, deps.run);
  const commits = await git.countCommits('HEAD', baseSha);
  if (commits === 0) return 0;
  const where = relative(deps.repoRoot, workspace) || '.';
  if (!(await git.isClean())) {
    throw new SpecrunError('git-failed', `${where} has uncommitted changes`, [
      `commit or discard them, then run again — ${base} is merged into ${SHARED_BRANCH} first`,
    ]);
  }
  const before = await git.head();
  const fastForward = await git.isAncestor('HEAD', baseSha);
  deps.reporter.log('info', `merging ${commits} commit(s) of ${base} into ${SHARED_BRANCH}`);
  const merged = await git.merge(baseSha, fastForward ? 'ff-only' : 'merge');
  if (!merged.ok) {
    throw new SpecrunError('git-failed', `Merging ${base} into ${SHARED_BRANCH} failed (aborted)`, [
      ...merged.error.split('\n').slice(-10),
      `merge it by hand in ${where} (git merge ${baseSha.slice(0, 7)}), then run again`,
    ]);
  }
  // A fast-forward lands on a tree the base already had; only a real merge is new.
  if (!fastForward) {
    const verify = await runVerify({
      steps: deps.config.verify,
      cwd: workspace,
      logFile: join(deps.repoRoot, '.specrun', 'logs', 'all', 'merge-verify.log'),
      run: deps.run,
    });
    if (!verify.ok) {
      await git.resetHard(before);
      throw new SpecrunError(
        'git-failed',
        `Verify failed after merging ${base} into ${SHARED_BRANCH} (merge undone)`,
        [...verify.summary.split('\n'), `fix it on ${base}, or merge by hand in ${where}`],
      );
    }
  }
  return commits;
}

function acquireAll(names: readonly string[], deps: RunSpecDeps): Lock[] {
  const locks: Lock[] = [];
  const pid = deps.pid ?? process.pid;
  const isAlive = deps.isAlive ?? isProcessAlive;
  try {
    for (const name of [SHARED_ID, ...names, ...(deps.config.worktree ? [] : [CHECKOUT_LOCK])]) {
      locks.push(acquireLock(lockFile(deps.repoRoot, name), pid, isAlive));
    }
    return locks;
  } catch (error) {
    for (const lock of locks.reverse()) lock.release();
    throw error;
  }
}

function withPosition(reporter: RunReporter, index: number, total: number): RunReporter {
  return { ...reporter, plan: (plan) => reporter.plan({ ...plan, position: { index, total } }) };
}

/**
 * SRD-31: every spec under `specsDir`, alphabetically, one after another in the shared worktree.
 * `done` goes on to the next spec; any other end stops the whole run. Setup problems throw
 * before any spec runs.
 */
export async function runAll(options: RunAllOptions, deps: RunAllDeps): Promise<RunAllResult> {
  const { repoRoot, config, clock } = deps;
  const names = listSpecs(repoRoot, config);
  if (names.length === 0) {
    throw new SpecrunError('spec-missing', `No specs found under ${config.specsDir}/`);
  }
  const own = await ownWorkspaces(repoRoot, names, deps.run);
  if (own.length > 0) {
    throw new SpecrunError('worktree-exists', 'run --all needs every spec in the shared worktree', [
      ...own,
      'finish and close them first (specrun run <spec>, specrun close <spec>)',
    ]);
  }

  const locks = acquireAll(names, deps);
  try {
    // Before the checkout may switch to the shared branch, which would move HEAD.
    const baseSha = await createGit(repoRoot, deps.run).resolve(options.base);
    const workspace = {
      repoRoot,
      spec: SHARED_ID,
      branch: SHARED_BRANCH,
      base: options.base,
      run: deps.run,
      onProgress: (step: WorktreeStep) => deps.reporter.phase(workspacePhase(repoRoot, step)),
    };
    const { path: shared } = config.worktree
      ? await ensureWorktree({ ...workspace, setup: config.setup, copyFiles: config.worktreeFiles })
      : await ensureCheckout(workspace);
    const merged = await mergeBase(shared, baseSha, options.base, deps);

    const missing = names.filter(
      (name) => !existsSync(join(specDir(shared, config, name), SPEC_FILE)),
    );
    if (missing.length > 0) {
      throw new SpecrunError(
        'spec-missing',
        `Not committed on ${options.base}: ${missing.join(', ')}`,
        [`commit the spec folder(s) — run --all merges ${options.base} into ${SHARED_BRANCH}`],
      );
    }
    const specs = names.map((name) => loadSpec(shared, config, name));
    const ownBranch = specs.filter((loaded) => loaded.spec.branch !== undefined);
    if (ownBranch.length > 0) {
      throw new SpecrunError('spec-invalid', 'run --all runs every spec on the shared branch', [
        ...ownBranch.map(
          (loaded) => `${loaded.name}: tasks.yaml sets branch ${loaded.spec.branch}`,
        ),
        'remove the branch key, or run that spec on its own',
      ]);
    }

    const withWork = specs.filter(
      (loaded) => runnableTasks(loaded.spec, stateOf(loaded), options).length > 0,
    );
    const summaries: SpecSummary[] = [];
    let end: Pick<RunAllResult, 'exitCode' | 'message'> | null = null;
    for (const loaded of specs) {
      const before = tally(loaded, stateOf(loaded));
      const summary = (outcome: SpecOutcome, tasks = before, durationMs = 0): SpecSummary => ({
        spec: loaded.name,
        outcome,
        tasks,
        costUsd: tasks.costUsd - before.costUsd,
        durationMs,
      });
      const index = withWork.indexOf(loaded);
      if (index === -1) {
        const reason = before.done === before.total ? 'done' : 'nothing-runnable';
        summaries.push(summary({ kind: 'skipped', reason }));
        continue;
      }
      if (end === null && deps.signal.aborted) end = { exitCode: 130 };
      if (end === null && deps.stop?.requested === true)
        end = { exitCode: 0, message: 'stopped on request' };
      if (end !== null) {
        summaries.push(summary({ kind: 'not-run' }));
        continue;
      }

      const started = clock.now().getTime();
      let outcome: SpecOutcome;
      try {
        const result = await (deps.runSpec ?? runSpec)(
          {
            spec: loaded.name,
            base: options.base,
            retryBlocked: options.retryBlocked,
            workspace: 'shared',
            ...(options.modelOverride === undefined
              ? {}
              : { modelOverride: options.modelOverride }),
          },
          { ...deps, reporter: withPosition(deps.reporter, index + 1, withWork.length) },
        );
        outcome = { kind: 'ran', result };
        if (result.reason !== 'done') {
          end = {
            exitCode: result.exitCode,
            message: `${loaded.name}: ${result.message ?? result.reason}`,
          };
        }
      } catch (error) {
        outcome = { kind: 'failed', message: errorMessage(error) };
        end = { exitCode: 1, message: `${loaded.name}: ${errorMessage(error)}` };
        deps.reporter.log('error', `${loaded.name}: ${errorMessage(error)}`);
      }
      summaries.push(
        summary(outcome, tally(loaded, stateOf(loaded)), clock.now().getTime() - started),
      );
    }
    return {
      exitCode: end?.exitCode ?? 0,
      specs: summaries,
      merged,
      ...(end?.message === undefined ? {} : { message: end.message }),
    };
  } finally {
    for (const lock of locks.reverse()) lock.release();
  }
}

export type PlanEntry =
  | { spec: string; kind: 'todo' | 'done' | 'nothing-runnable'; tasks: TaskTally; runnable: number }
  | { spec: string; kind: 'invalid'; problem: string };

export interface AllPlan {
  specs: PlanEntry[];
  /** Why the run would refuse to start (specs with their own worktree or branch). */
  conflicts: string[];
  /** Base commits the run would merge first; null before the shared branch exists. */
  baseCommits: number | null;
}

/** `run --all --dry-run`: what a run would do, read-only. */
export async function planAll(
  options: RunAllOptions,
  deps: { repoRoot: string; config: Config; run: ProcessRunner },
): Promise<AllPlan> {
  const { repoRoot, config } = deps;
  const names = listSpecs(repoRoot, config);
  const conflicts = await ownWorkspaces(repoRoot, names, deps.run);
  const git = createGit(repoRoot, deps.run);
  const baseCommits = (await git.branchExists(SHARED_BRANCH))
    ? await git.countCommits(SHARED_BRANCH, await git.resolve(options.base))
    : null;
  const shared = sharedWorktreePath(repoRoot);
  const specs = names.map((name): PlanEntry => {
    const root = existsSync(join(specDir(shared, config, name), SPEC_FILE)) ? shared : repoRoot;
    try {
      const loaded = loadSpec(root, config, name);
      if (loaded.spec.branch !== undefined) {
        conflicts.push(`${name}: tasks.yaml sets branch ${loaded.spec.branch}`);
      }
      const state = stateOf(loaded);
      const tasks = tally(loaded, state);
      const runnable = runnableTasks(loaded.spec, state, options).length;
      const kind = runnable > 0 ? 'todo' : tasks.done === tasks.total ? 'done' : 'nothing-runnable';
      return { spec: name, kind, tasks, runnable };
    } catch (error) {
      return { spec: name, kind: 'invalid', problem: errorMessage(error).split('\n')[0] ?? '' };
    }
  });
  return { specs, conflicts, baseCommits };
}
