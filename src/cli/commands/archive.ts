import type { Command } from 'commander';
import { archiveSpec } from '../../archive/archiveSpec.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { runCommand } from '../../process/run.js';
import { isProcessAlive } from '../../runner/lock.js';
import type { CliDeps } from '../cliDeps.js';

export function register(program: Command, deps: CliDeps): void {
  program
    .command('archive')
    .description('Replace a finished spec by its README and run history under <specsDir>/archive')
    .argument('<spec>', 'spec folder name')
    .option('--force', 'archive although tasks are unfinished or tasks.yaml is unreadable')
    .action(async (name: string, flags: { force?: boolean }) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const result = await archiveSpec(
        { spec: name, force: flags.force === true },
        { repoRoot, config, run: runCommand, now: deps.now, isAlive: isProcessAlive },
      );
      const lines = [
        `Archived ${name} → ${result.archiveDir} (commit ${result.commit.slice(0, 7)})`,
      ];
      lines.push(
        result.history === null
          ? '  no run history to keep'
          : `  history.json: ${result.history.samples} task samples, ${result.history.deviations} deviations`,
      );
      if (result.removed !== null) {
        lines.push(
          `  removed worktree ${result.removed.worktree} and branch ${result.removed.branch}`,
        );
      }
      if (result.forced.length > 0) lines.push(`  forced: ${result.forced.join(', ')}`);
      lines.push(
        'Move behaviour that still holds into the living docs — the archive is hidden from search (.ignore).',
      );
      deps.stdout(`${lines.join('\n')}\n`);
    });
}
