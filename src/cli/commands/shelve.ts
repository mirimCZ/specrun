import type { Command } from 'commander';
import { shelveSpec, type ShelveResult, type ShelveStep } from '../../archive/shelveSpec.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import { runCommand } from '../../process/run.js';
import { isProcessAlive } from '../../runner/lock.js';
import type { CliDeps } from '../cliDeps.js';
import type { CloseOverrides } from './close.js';

function progressLine(step: ShelveStep): string {
  switch (step.step) {
    case 'push':
      return `pushing ${step.branch} to ${step.remote} …`;
    case 'switch':
      return `switching the checkout back to ${step.branch}`;
    case 'archive':
      return `archiving ${step.spec} …`;
  }
}

export function shelveLines(name: string, result: ShelveResult): string[] {
  const { archive } = result;
  const tip = result.tip.slice(0, 7);
  const where =
    result.remote === null ? 'kept only locally (--no-push)' : `pushed to ${result.remote}`;
  const lines = [
    `Shelved ${name}: ${result.branch} at ${tip} ${where}, not merged`,
    `Archived ${name} → ${archive.archiveDir} (commit ${archive.commit.slice(0, 7)})`,
  ];
  if (archive.history !== null) {
    lines.push(
      `  history.json: ${archive.history.samples} task samples, ${archive.history.deviations} deviations`,
    );
  }
  if (archive.forced.length > 0) lines.push(`  unfinished: ${archive.forced.join(', ')}`);
  if (result.removedWorktree !== null) {
    lines.push(`  removed worktree ${result.removedWorktree}, kept branch ${result.branch}`);
  }
  if (result.switchedTo !== null)
    lines.push(`  switched the checkout back to ${result.switchedTo}`);
  lines.push(`specrun unshelve ${name} merges it later.`);
  return lines;
}

async function askReason(deps: CliDeps): Promise<string> {
  if (!deps.interactive) {
    throw new SpecrunError('spec-invalid', 'Shelving needs a reason', ['pass --reason <text>']);
  }
  const prompter = deps.prompter();
  try {
    return await prompter.text('Why is it shelved instead of merged?', '');
  } finally {
    prompter.close();
  }
}

export function register(program: Command, deps: CliDeps, overrides: CloseOverrides = {}): void {
  program
    .command('shelve')
    .description('Keep a spec on its branch (pushed) and archive it without merging')
    .argument('<spec>', 'spec folder name')
    .option('--reason <text>', 'why it is not merged (asked on a terminal when missing)')
    .option('--remote <name>', 'remote to push the branch to', 'origin')
    .option('--no-push', 'keep the branch only in this repository')
    .action(async (name: string, flags: { reason?: string; remote: string; push: boolean }) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const reason = flags.reason ?? (await askReason(deps));
      const result = await shelveSpec(
        { spec: name, reason, remote: flags.push ? flags.remote : null },
        {
          repoRoot,
          config,
          run: overrides.run ?? runCommand,
          now: deps.now,
          isAlive: overrides.isAlive ?? isProcessAlive,
          onProgress: (step) => deps.stdout(`${progressLine(step)}\n`),
        },
      );
      deps.stdout(`${shelveLines(name, result).join('\n')}\n`);
    });
}
