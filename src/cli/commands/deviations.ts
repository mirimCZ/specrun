import { join, relative } from 'node:path';
import type { Command } from 'commander';
import { archiveRoot } from '../../archive/history.js';
import type { Config } from '../../config/configSchema.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import { DEVIATION_KINDS } from '../../events/eventSchema.js';
import { formatQuestion } from '../../events/formatQuestion.js';
import { runInteractive, type InteractiveRunner } from '../../process/run.js';
import { buildReview, type ReviewSpec } from '../../review/buildReview.js';
import { specDir } from '../../spec/loadSpec.js';
import { deviationEntries } from '../../stats/aggregate.js';
import { DeviationsJsonSchema, type DeviationsJson } from '../../stats/jsonOutput.js';
import { activeSpecFiles, type CliDeps } from '../cliDeps.js';
import { loadRunHistory, type RunHistory } from '../specInputs.js';

type Entry = DeviationsJson['deviations'][number];

/** Seams for tests: the Claude Code process and the exit code. */
export interface DeviationsOverrides {
  launch?: InteractiveRunner;
  setExitCode?: (code: number) => void;
}

interface DeviationsFlags {
  kind?: string;
  json?: boolean;
  print?: boolean;
}

function isKind(value: string): value is Entry['kind'] {
  return (DEVIATION_KINDS as readonly string[]).includes(value);
}

function inline(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

function formatListing(entries: readonly Entry[], counts: Record<string, number>): string {
  const sections = DEVIATION_KINDS.filter((kind) => (counts[kind] ?? 0) > 0).map((kind) => {
    const lines = entries
      .filter((e) => e.kind === kind)
      .map((e) => {
        const decision = e.decision === null ? '' : `${inline(e.decision)}: `;
        const line = `  ${e.spec}/${e.task} [${e.kind}] ${decision}${inline(e.what)} — ${inline(e.why)}`;
        return e.question === null ? line : `${line}\n    ${formatQuestion(e.question)}`;
      });
    return `${kind} (${counts[kind]})\n${lines.join('\n')}`;
  });
  return `${sections.join('\n\n')}\n`;
}

function reviewSpecs(
  repoRoot: string,
  config: Config,
  history: RunHistory,
  entries: readonly Entry[],
): ReviewSpec[] {
  const named = new Set(entries.map((e) => e.spec));
  const rel = (path: string): string => relative(repoRoot, path) || '.';
  const live = history.inputs
    .filter((input) => named.has(input.name))
    .map((input): ReviewSpec => {
      const files = activeSpecFiles(repoRoot, config, input.name);
      return {
        kind: 'live',
        name: input.name,
        files: rel(specDir(files.base, config, input.name)),
        worktree: files.worktree === null ? null : rel(files.worktree),
        branch: input.spec.branch ?? `specrun/${input.name}`,
      };
    });
  const archived = history.archived
    .filter((h) => named.has(h.spec))
    .map((h): ReviewSpec => ({
      kind: 'archived',
      name: h.spec,
      files: rel(join(archiveRoot(repoRoot, config), h.spec)),
      commit: h.commit,
      original: join(config.specsDir, h.spec),
    }));
  return [...live, ...archived];
}

export function register(
  program: Command,
  deps: CliDeps,
  overrides: DeviationsOverrides = {},
): void {
  program
    .command('deviations')
    .description('Deviations agents reported, grouped by kind; in a terminal reviewed with Claude')
    .argument('[spec...]', 'spec folder names (default: all specs of this repo)')
    .option('--kind <kind>', `only one kind: ${DEVIATION_KINDS.join(' | ')}`)
    .option('--json', 'machine-readable output')
    .option('--print', 'only print them, even in a terminal')
    .action(async (names: string[], flags: DeviationsFlags) => {
      if (flags.kind !== undefined && !isKind(flags.kind)) {
        throw new SpecrunError('spec-invalid', `Invalid --kind "${flags.kind}"`, [
          `expected one of: ${DEVIATION_KINDS.join(', ')}`,
        ]);
      }
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const history = loadRunHistory(repoRoot, config, names);
      const entries = [
        ...deviationEntries(history.inputs),
        ...history.archived.flatMap((h) => h.deviations),
      ].filter((e) => flags.kind === undefined || e.kind === flags.kind);

      const counts: Record<string, number> = {};
      for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;

      if (flags.json === true) {
        const output = DeviationsJsonSchema.parse({
          version: 1,
          generatedAt: deps.now().toISOString(),
          deviations: entries,
          counts,
        });
        deps.stdout(`${JSON.stringify(output, null, 2)}\n`);
        return;
      }
      if (entries.length === 0) {
        deps.stdout('No deviations reported.\n');
        return;
      }
      const listing = formatListing(entries, counts);
      // Agents and pipes (the feedback skill) get the listing; a person gets the review.
      if (!deps.interactive || flags.print === true) {
        deps.stdout(listing);
        return;
      }

      const command = [
        'specrun deviations',
        ...names,
        ...(flags.kind === undefined ? [] : ['--kind', flags.kind]),
      ].join(' ');
      const review = buildReview({
        command,
        listing,
        specs: reviewSpecs(repoRoot, config, history, entries),
      });
      deps.stdout(
        `Reviewing ${entries.length} deviation(s) with Claude — --print only lists them.\n`,
      );
      const result = await (overrides.launch ?? runInteractive)(
        'claude',
        ['--append-system-prompt', review.systemPrompt, review.message],
        { cwd: repoRoot, env: deps.env },
      );
      if (result.error !== null) {
        throw new SpecrunError('claude-missing', 'Could not start claude', [
          result.error,
          'install Claude Code (https://claude.com/claude-code), or use --print',
        ]);
      }
      (overrides.setExitCode ?? ((code) => void (process.exitCode = code)))(result.code);
    });
}
