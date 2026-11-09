import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { createEventStore } from '../../events/eventStore.js';
import { SpecrunError } from '../../errors.js';
import { isProcessAlive, lockFile, readLockPid } from '../../runner/lock.js';
import { loadSpec } from '../../spec/loadSpec.js';
import { activeSpecFiles, type CliDeps } from '../cliDeps.js';

const STATUSES = ['todo', 'done', 'blocked'] as const;
type ManualStatus = (typeof STATUSES)[number];

function isManualStatus(value: string): value is ManualStatus {
  return (STATUSES as readonly string[]).includes(value);
}

/** SRD-5: the only writer of events.jsonl besides the runner. */
export function register(program: Command, deps: CliDeps): void {
  program
    .command('set')
    .description('Override the status of a task by hand (recorded as manual.status)')
    .argument('<spec>', 'spec folder name')
    .argument('<task>', 'task id')
    .argument('<status>', STATUSES.join(' | '))
    .requiredOption('--reason <text>', 'why the status is changed')
    .action((name: string, task: string, status: string, flags: { reason: string }) => {
      if (!isManualStatus(status)) {
        throw new SpecrunError('spec-invalid', `Invalid status "${status}"`, [
          `expected one of: ${STATUSES.join(', ')}`,
        ]);
      }
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const files = activeSpecFiles(repoRoot, config, name);
      const { spec } = loadSpec(files.base, config, name);
      if (!spec.tasks.some((t) => t.id === task)) {
        throw new SpecrunError('spec-invalid', `Task "${task}" is not in spec "${name}"`);
      }
      const pid = readLockPid(lockFile(repoRoot, name));
      if (pid !== null && isProcessAlive(pid)) {
        throw new SpecrunError('locked', `A run holds the lock of "${name}" (pid ${pid})`, [
          'stop it (Ctrl-C) before changing a status',
        ]);
      }
      createEventStore({
        file: files.eventsFile,
        runId: `manual-${randomUUID()}`,
        clock: { now: deps.now },
      }).append({ t: 'manual.status', task, status, reason: flags.reason });
      deps.stdout(`${task} → ${status}\n`);
    });
}
