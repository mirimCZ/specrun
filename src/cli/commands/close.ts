import type { Command } from 'commander';
import { closeAll } from '../../archive/closeAll.js';
import { closeSpec, type CloseStep, type MergeResult } from '../../archive/closeSpec.js';
import type { Config } from '../../config/configSchema.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import { runCommand, type ProcessRunner } from '../../process/run.js';
import { isProcessAlive } from '../../runner/lock.js';
import type { CliDeps } from '../cliDeps.js';
import { stepDuration } from '../eventLines.js';
import { archiveLines } from './archive.js';

/** Seams for tests: git and the verify commands, and the lock owner check. */
export interface CloseOverrides {
  run?: ProcessRunner;
  isAlive?: (pid: number) => boolean;
}

function progressLine(step: CloseStep): string {
  switch (step.step) {
    case 'merge': {
      const how = step.fastForward ? 'fast-forward' : 'merge commit';
      return `merging ${step.branch} into ${step.into}: ${step.commits} commit(s), ${how}`;
    }
    case 'verify':
      return `verify after the merge: ${step.steps.join(' → ')} …`;
    case 'verify-step': {
      const { name, ok, durationMs } = step.finished;
      return `  ${name}: ${ok ? 'ok' : 'failed'} (${stepDuration(durationMs)})`;
    }
    case 'archive':
      return `archiving ${step.spec} …`;
  }
}

export interface CloseTarget {
  /** Null: `--all`, the shared branch of `run --all`. */
  spec: string | null;
  into?: string;
  force: boolean;
}

/** Closes and prints the report; shared with the question at the end of `specrun run`. */
export async function runClose(
  target: CloseTarget,
  repoRoot: string,
  config: Config,
  deps: CliDeps,
  overrides: CloseOverrides = {},
): Promise<void> {
  const closeDeps = {
    repoRoot,
    config,
    run: overrides.run ?? runCommand,
    now: deps.now,
    isAlive: overrides.isAlive ?? isProcessAlive,
    onProgress: (step: CloseStep) => deps.stdout(`${progressLine(step)}\n`),
  };
  const into = target.into === undefined ? {} : { into: target.into };
  const merged = (result: MergeResult): string =>
    result.merge === 'already'
      ? `${result.branch} was already merged into ${result.into}`
      : `merged ${result.branch} into ${result.into} (${result.merge}, ${result.commits} commit(s))`;

  const report = async (): Promise<{ into: string; lines: string[] }> => {
    if (target.spec === null) {
      const result = await closeAll({ force: target.force, ...into }, closeDeps);
      const worktree =
        result.removedWorktree === null ? '' : `worktree ${result.removedWorktree} and `;
      return {
        into: result.into,
        lines: [
          `Closed ${result.archived.length} spec(s): ${merged(result)}`,
          ...result.archived.flatMap(({ spec, archive }) => archiveLines(spec, archive)),
          `  removed ${worktree}branch ${result.branch}`,
        ],
      };
    }
    const result = await closeSpec({ spec: target.spec, force: target.force, ...into }, closeDeps);
    return {
      into: result.into,
      lines: [
        `Closed ${target.spec}: ${merged(result)}`,
        ...archiveLines(target.spec, result.archive),
        ...(result.deletedBranch === null ? [] : [`  deleted branch ${result.deletedBranch}`]),
      ],
    };
  };
  const closed = await report();
  closed.lines.push(`Nothing was pushed — git push when ${closed.into} is ready.`);
  deps.stdout(`${closed.lines.join('\n')}\n`);
}

export function register(program: Command, deps: CliDeps, overrides: CloseOverrides = {}): void {
  program
    .command('close')
    .description('Merge a finished spec into the current branch and archive it')
    .argument('[spec]', 'spec folder name')
    .option('--all', 'close every spec of specrun run --all (its shared branch)')
    .option('--into <branch>', 'merge into this branch instead of the checked-out one')
    .option('--force', 'close although tasks are unfinished (passed on to archive)')
    .action(
      async (
        name: string | undefined,
        flags: { all?: boolean; into?: string; force?: boolean },
      ) => {
        if ((name === undefined) === (flags.all !== true)) {
          throw new SpecrunError('spec-missing', 'Name a spec, or use --all');
        }
        const repoRoot = findRepoRoot(deps.cwd);
        const config = loadConfig(repoRoot);
        await runClose(
          {
            spec: name ?? null,
            force: flags.force === true,
            ...(flags.into === undefined ? {} : { into: flags.into }),
          },
          repoRoot,
          config,
          deps,
          overrides,
        );
      },
    );
}
