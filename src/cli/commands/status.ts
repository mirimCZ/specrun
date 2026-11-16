import type { Command } from 'commander';
import {
  isShelved,
  readArchivedHistories,
  refuseShelved,
  type ShelvedHistory,
} from '../../archive/history.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { readEvents } from '../../events/eventStore.js';
import { deriveState, type SpecState } from '../../events/taskState.js';
import { isProcessAlive, lockFile, readLockPid } from '../../runner/lock.js';
import { formatUsd } from '../../progress/renderProgress.js';
import { SpecrunError } from '../../errors.js';
import { SHARED_BRANCH } from '../../git/workspace.js';
import { listSpecs, loadSpec } from '../../spec/loadSpec.js';
import type { Config } from '../../config/configSchema.js';
import { activeSpecFiles, type ActiveSpecFiles, type CliDeps } from '../cliDeps.js';
import { table } from '../table.js';

interface Overview {
  name: string;
  done: number;
  total: number;
  blocked: number;
  /** Where the live copy is: own worktree, the shared one of `run --all`, or the checkout. */
  workspace: ActiveSpecFiles['workspace'];
  runningPid: number | null;
}

/** SRD-35: in the same list, so `--json` keeps its shape; only its branch has the spec. */
interface ShelvedOverview {
  name: string;
  /** Tasks done when it was shelved; the total is only on the branch. */
  done: number;
  workspace: 'shelved';
  shelved: ShelvedHistory['outcome'];
}

function shelvedOverviews(repoRoot: string, config: Config): ShelvedOverview[] {
  return readArchivedHistories(repoRoot, config)
    .filter(isShelved)
    .map((history) => ({
      name: history.spec,
      done: history.samples.length,
      workspace: 'shelved',
      shelved: history.outcome,
    }));
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
  const { files, spec, state } = load(repoRoot, config, name);
  const statuses = [...state.tasks.values()].map((task) => task.status);
  return {
    name,
    done: statuses.filter((s) => s === 'done').length,
    total: spec.tasks.length,
    blocked: statuses.filter((s) => s === 'blocked').length,
    workspace: files.workspace,
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
        const shelved = shelvedOverviews(repoRoot, config);
        if (flags.json === true) {
          deps.stdout(`${JSON.stringify([...all, ...shelved], null, 2)}\n`);
          return;
        }
        if (all.length === 0 && shelved.length === 0) {
          deps.stdout(`No specs found under ${config.specsDir}/\n`);
          return;
        }
        const sections: string[] = [];
        if (all.length > 0) {
          const rows = all.map((s) => [
            s.name,
            `${s.done}/${s.total}`,
            s.blocked > 0 ? `${s.blocked} blocked` : '',
            s.workspace === 'checkout' ? '' : s.workspace === 'shared' ? 'run --all' : 'worktree',
            s.runningPid === null ? '' : `running (pid ${s.runningPid})`,
          ]);
          sections.push(table(rows));
        }
        if (shelved.length > 0) {
          const rows = shelved.map((s) => [
            s.name,
            `${s.done} done`,
            s.shelved.branch,
            s.shelved.remote ?? 'local only',
            s.shelved.shelvedAt.slice(0, 10),
            s.shelved.reason,
          ]);
          sections.push(`Shelved, not merged (specrun unshelve <spec>):\n${table(rows)}`);
        }
        deps.stdout(`${sections.join('\n\n')}\n`);
        return;
      }

      if (
        !listSpecs(repoRoot, config).includes(name) &&
        activeSpecFiles(repoRoot, config, name).worktree === null
      ) {
        refuseShelved(repoRoot, config, name);
        throw new SpecrunError('spec-missing', `Spec "${name}" not found`);
      }
      const { files, spec, state } = load(repoRoot, config, name);
      const pid = runningPid(repoRoot, name);
      const branch =
        files.workspace === 'shared' ? SHARED_BRANCH : (spec.branch ?? `specrun/${name}`);
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
