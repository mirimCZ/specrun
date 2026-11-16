import type { Command } from 'commander';
import {
  unshelveSpec,
  type BranchSync,
  type UnshelveResult,
  type UnshelveStep,
} from '../../archive/unshelveSpec.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { runCommand } from '../../process/run.js';
import { isProcessAlive } from '../../runner/lock.js';
import type { CliDeps } from '../cliDeps.js';
import { archiveLines } from './archive.js';
import { merged, progressLine as closeProgressLine, type CloseOverrides } from './close.js';

function progressLine(step: UnshelveStep): string {
  switch (step.step) {
    case 'fetch':
      return `fetching ${step.branch} from ${step.remote} …`;
    case 'revive':
      return `bringing ${step.spec} back on ${step.into}`;
    default:
      return closeProgressLine(step);
  }
}

function syncLine(sync: BranchSync, branch: string, remote: string | null): string | null {
  switch (sync.kind) {
    case 'local-only':
    case 'up-to-date':
      return null;
    case 'created':
      return `fetched ${branch} from ${remote}`;
    case 'fast-forwarded':
      return `updated ${branch} from ${remote}`;
    case 'local-ahead':
      return `the local ${branch} is ahead of ${remote}'s — using it`;
    case 'unreachable':
      return `could not fetch from ${remote}, using the local ${branch}: ${sync.error.split('\n')[0]}`;
  }
}

export function unshelveLines(name: string, result: UnshelveResult): string[] {
  const sync = syncLine(result.sync, result.branch, result.remote);
  const lines = [
    ...(sync === null ? [] : [sync]),
    `Revived ${name} on ${result.into} (commit ${result.revived.slice(0, 7)})`,
  ];
  if (result.carriedReviewed > 0) {
    lines.push(`  ${result.carriedReviewed} reviewed deviation(s) recorded in the branch log`);
  }
  const { closed } = result;
  if (closed === null) {
    lines.push(`Finish it with specrun run ${name}, then specrun close ${name}.`);
    return lines;
  }
  lines.push(`Closed ${name}: ${merged(closed)}`, ...archiveLines(name, closed.archive));
  if (closed.deletedBranch !== null) lines.push(`  deleted branch ${closed.deletedBranch}`);
  if (result.remote !== null) {
    lines.push(
      `The remote branch stays — git push ${result.remote} --delete ${result.branch} to remove it.`,
    );
  }
  lines.push(`Nothing was pushed — git push when ${closed.into} is ready.`);
  return lines;
}

export function register(program: Command, deps: CliDeps, overrides: CloseOverrides = {}): void {
  program
    .command('unshelve')
    .description('Bring a shelved spec back, merge it and archive it as merged')
    .argument('<spec>', 'spec folder name')
    .option('--into <branch>', 'revive and merge on this branch instead of the checked-out one')
    .option('--force', 'merge although tasks are unfinished (passed on to archive)')
    .option('--no-merge', 'only bring the spec back, to finish it with specrun run')
    .action(async (name: string, flags: { into?: string; force?: boolean; merge: boolean }) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const result = await unshelveSpec(
        {
          spec: name,
          force: flags.force === true,
          merge: flags.merge,
          ...(flags.into === undefined ? {} : { into: flags.into }),
        },
        {
          repoRoot,
          config,
          run: overrides.run ?? runCommand,
          now: deps.now,
          isAlive: overrides.isAlive ?? isProcessAlive,
          onProgress: (step) => deps.stdout(`${progressLine(step)}\n`),
        },
      );
      deps.stdout(`${unshelveLines(name, result).join('\n')}\n`);
    });
}
