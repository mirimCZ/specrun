import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Command } from 'commander';
import type { Config } from '../../config/configSchema.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import { DEVIATION_KINDS } from '../../events/eventSchema.js';
import {
  runCommand,
  runInteractive,
  type InteractiveRunner,
  type ProcessRunner,
} from '../../process/run.js';
import { buildReview } from '../../review/buildReview.js';
import { markReviewed } from '../../review/markReviewed.js';
import { gatherReviewContext } from '../../review/reviewContext.js';
import { accountForSession } from '../accountsFor.js';
import type { CliDeps } from '../cliDeps.js';
import { formatListing, selectDeviations } from '../deviationListing.js';
import { askYes } from '../prompter.js';

/** Seams for tests: git, the Claude Code process and the exit code. */
export interface ReviewOverrides {
  run?: ProcessRunner;
  launch?: InteractiveRunner;
  setExitCode?: (code: number) => void;
}

export interface ReviewFlags {
  kind?: string;
  print?: boolean;
  includeReviewed?: boolean;
  account?: string;
}

/**
 * Starts Claude Code on the deviations of `names` (all specs when empty) not reviewed before;
 * resolves to its exit code, or null when there was nothing to review. Shared with the question
 * at the end of a run.
 */
export async function runReview(
  names: readonly string[],
  flags: ReviewFlags,
  repoRoot: string,
  config: Config,
  deps: CliDeps,
  overrides: ReviewOverrides = {},
): Promise<number | null> {
  const includeReviewed = flags.includeReviewed === true;
  const { history, entries, counts } = selectDeviations(
    repoRoot,
    config,
    names,
    flags.kind,
    includeReviewed,
  );
  if (entries.length === 0) {
    const skipped = includeReviewed
      ? 0
      : selectDeviations(repoRoot, config, names, flags.kind, true).entries.length;
    deps.stdout(
      skipped === 0
        ? 'No deviations reported — nothing to review.\n'
        : `All ${skipped} deviation(s) were reviewed before — --include-reviewed shows them again.\n`,
    );
    return null;
  }

  const context = await gatherReviewContext({
    repoRoot,
    config,
    inputs: history.inputs,
    archived: history.archived,
    entries,
    run: overrides.run ?? runCommand,
  });
  const command = [
    'specrun review',
    ...names,
    ...(flags.kind === undefined ? [] : ['--kind', flags.kind]),
    ...(includeReviewed ? ['--include-reviewed'] : []),
  ].join(' ');
  const review = buildReview({ command, listing: formatListing(entries, counts), context });
  if (flags.print === true) {
    deps.stdout(`${review.systemPrompt}\n---\n\n${review.message}\n`);
    return 0;
  }
  if (!deps.interactive) {
    throw new SpecrunError('terminal-required', 'specrun review needs a terminal', [
      'run it in a terminal, or use --print (or specrun deviations) for the text',
    ]);
  }

  // MAD-15: the token is resolved before anything is written; an error ends the command here.
  const account = await accountForSession(repoRoot, config, flags.account, deps);

  // A file, not an argument: the context outgrows the per-argument limit of some systems.
  const dir = join(repoRoot, '.specrun', 'review');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${names.length === 0 ? 'all' : names.join('+')}.md`);
  writeFileSync(file, review.systemPrompt);
  deps.stdout(
    `Reviewing ${entries.length} deviation(s) with Claude — context in ${relative(repoRoot, file)}\n`,
  );
  const result = await (overrides.launch ?? runInteractive)(
    'claude',
    ['--append-system-prompt-file', file, review.message],
    { cwd: repoRoot, env: account.env ?? deps.env },
  );
  if (result.error !== null) {
    throw new SpecrunError('claude-missing', 'Could not start claude', [
      result.error,
      'install Claude Code (https://claude.com/claude-code), or use --print',
    ]);
  }

  // Asked, not assumed: a review cut short should come back next time.
  const unreviewed = entries.filter((e) => !e.reviewed).length;
  if (
    result.code === 0 &&
    unreviewed > 0 &&
    (await askYes(deps.prompter, `Mark the ${unreviewed} deviation(s) as reviewed?`))
  ) {
    const files = markReviewed({
      repoRoot,
      config,
      entries,
      archived: history.archived,
      now: deps.now,
    });
    deps.stdout(
      `Marked as reviewed in ${files.map((f) => relative(repoRoot, f)).join(', ')} — ` +
        'later reviews skip them (--include-reviewed shows them).\n',
    );
  }
  return result.code;
}

export function register(program: Command, deps: CliDeps, overrides: ReviewOverrides = {}): void {
  program
    .command('review')
    .description('Review the reported deviations with Claude Code, on this terminal')
    .argument('[spec...]', 'spec folder names (default: all specs of this repo)')
    .option('--kind <kind>', `only one kind: ${DEVIATION_KINDS.join(' | ')}`)
    .option('--print', 'print what Claude would get instead of starting it')
    .option('--include-reviewed', 'also the deviations an earlier review marked')
    .option('--account <name>', 'start Claude on this account (default: the priority account)')
    .action(async (names: string[], flags: ReviewFlags) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const code = await runReview(names, flags, repoRoot, config, deps, overrides);
      // --print and an empty review end normally.
      if (code !== null && flags.print !== true) {
        (overrides.setExitCode ?? ((c) => void (process.exitCode = c)))(code);
      }
    });
}
