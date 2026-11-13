import type { Command } from 'commander';
import { closeSpec, type CloseStep } from '../../archive/closeSpec.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
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
      return 'archiving …';
  }
}

export function register(program: Command, deps: CliDeps, overrides: CloseOverrides = {}): void {
  program
    .command('close')
    .description('Merge a finished spec into the current branch and archive it')
    .argument('<spec>', 'spec folder name')
    .option('--into <branch>', 'merge into this branch instead of the checked-out one')
    .option('--force', 'close although tasks are unfinished (passed on to archive)')
    .action(async (name: string, flags: { into?: string; force?: boolean }) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const result = await closeSpec(
        { spec: name, force: flags.force === true, ...(flags.into ? { into: flags.into } : {}) },
        {
          repoRoot,
          config,
          run: overrides.run ?? runCommand,
          now: deps.now,
          isAlive: overrides.isAlive ?? isProcessAlive,
          onProgress: (step) => deps.stdout(`${progressLine(step)}\n`),
        },
      );
      const merged =
        result.merge === 'already'
          ? `${result.branch} was already merged into ${result.into}`
          : `merged ${result.branch} into ${result.into} (${result.merge}, ${result.commits} commit(s))`;
      const lines = [`Closed ${name}: ${merged}`, ...archiveLines(name, result.archive)];
      if (result.deletedBranch !== null) lines.push(`  deleted branch ${result.deletedBranch}`);
      lines.push(`Nothing was pushed — git push when ${result.into} is ready.`);
      deps.stdout(`${lines.join('\n')}\n`);
    });
}
