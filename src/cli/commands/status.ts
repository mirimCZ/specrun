import type { Command } from 'commander';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { readEvents } from '../../events/eventStore.js';
import { deriveState, type SpecState } from '../../events/taskState.js';
import { isProcessAlive, lockFile, readLockPid } from '../../runner/lock.js';
import { formatUsd } from '../../progress/renderProgress.js';
import { SpecrunError } from '../../errors.js';
import { listSpecs, loadSpec } from '../../spec/loadSpec.js';
import type { Config } from '../../config/configSchema.js';
import { activeSpecFiles, type CliDeps } from '../cliDeps.js';
import { table } from '../table.js';

interface Overview {
  name: string;
  done: number;
  total: number;
  blocked: number;
  runningPid: number | null;
}

function runningPid(repoRoot: string, spec: string): number | null {
  const pid = readLockPid(lockFile(repoRoot, spec));
  return pid !== null && isProcessAlive(pid) ? pid : null;
}

function load(repoRoot: string, config: Config, name: string) {
  const files = activeSpecFiles(repoRoot, config, name);
  const { spec } = loadSpec(files.base, config, name);
  const state: SpecState = deriveState(spec, readEvents(files.eventsFile).events);
  return { files, spec, state };
}

function overview(repoRoot: string, config: Config, name: string): Overview {
  const { spec, state } = load(repoRoot, config, name);
  const statuses = [...state.tasks.values()].map((task) => task.status);
  return {
    name,
    done: statuses.filter((s) => s === 'done').length,
    total: spec.tasks.length,
    blocked: statuses.filter((s) => s === 'blocked').length,
    runningPid: runningPid(repoRoot, name),
  };
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('status')
    .description('Show the state of all specs, or the task table of one')
    .argument('[spec]', 'spec folder name')
    .option('--json', 'machine-readable output')
    .action((name: string | undefined, flags: { json?: boolean }) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);

      if (name === undefined) {
        const all = listSpecs(repoRoot, config).map((spec) => overview(repoRoot, config, spec));
        if (flags.json === true) {
          deps.stdout(`${JSON.stringify(all, null, 2)}\n`);
          return;
        }
        if (all.length === 0) {
          deps.stdout(`No specs found under ${config.specsDir}/\n`);
          return;
        }
        const rows = all.map((s) => [
          s.name,
          `${s.done}/${s.total}`,
          s.blocked > 0 ? `${s.blocked} blocked` : '',
          s.runningPid === null ? '' : `running (pid ${s.runningPid})`,
        ]);
        deps.stdout(`${table(rows)}\n`);
        return;
      }

      if (
        !listSpecs(repoRoot, config).includes(name) &&
        activeSpecFiles(repoRoot, config, name).worktree === null
      ) {
        throw new SpecrunError('spec-missing', `Spec "${name}" not found`);
      }
      const { files, spec, state } = load(repoRoot, config, name);
      const pid = runningPid(repoRoot, name);
      const branch = spec.branch ?? `specrun/${name}`;
      const tasks = spec.tasks.map((task) => {
        const s = state.tasks.get(task.id);
        return {
          id: task.id,
          title: task.title,
          size: task.size,
          model: task.model,
          status: s?.status ?? 'todo',
          turns: s?.totals.turns ?? 0,
          costUsd: s?.totals.costUsd ?? 0,
        };
      });
      if (flags.json === true) {
        const info = { spec: name, branch, worktree: files.worktree, runningPid: pid, tasks };
        deps.stdout(`${JSON.stringify(info, null, 2)}\n`);
        return;
      }
      const rows = [
        ['ID', 'TITLE', 'SIZE', 'MODEL', 'STATUS', 'TURNS', 'COST'],
        ...tasks.map((t) => [
          t.id,
          t.title,
          t.size,
          t.model,
          t.status,
          String(t.turns),
          formatUsd(t.costUsd),
        ]),
      ];
      deps.stdout(`${table(rows)}\n\n`);
      deps.stdout(`branch:   ${branch}\n`);
      deps.stdout(`worktree: ${files.worktree ?? '(none)'}\n`);
      deps.stdout(`run:      ${pid === null ? 'not running' : `running (pid ${pid})`}\n`);
    });
}
