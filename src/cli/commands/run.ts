import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import type { Command } from 'commander';
import { CONFIG_FILE, loadConfig, findRepoRoot } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import { runsShared } from '../../git/workspace.js';
import { keepAwake } from '../../limits/keepAwake.js';
import { systemClock } from '../../limits/clock.js';
import { runCommand } from '../../process/run.js';
import {
  runSpec,
  type RunAccount,
  type RunResult,
  type RunSpecDeps,
  type RunSpecOptions,
} from '../../runner/runSpec.js';
import { prepareAccounts } from '../../accounts/prepare.js';
import { loadGlobalConfig } from '../../config/globalConfig.js';
import { probeUsage } from '../../session/probeUsage.js';
import { createSdkSession } from '../../session/sdkSession.js';
import type { RunReporter } from '../../runner/reporter.js';
import {
  planAll,
  runAll,
  type RunAllDeps,
  type RunAllOptions,
  type RunAllResult,
} from '../../runner/runAll.js';
import { listSpecs } from '../../spec/loadSpec.js';
import { createInkReporter, type InkReporter } from '../../ui/createInkReporter.js';
import { afterRun, allDone, type AfterRunInput } from '../afterRun.js';
import { planLines, summaryMarkdown, summaryRows } from '../allSummary.js';
import type { CliDeps } from '../cliDeps.js';
import { createLineReporter } from '../lineReporter.js';
import { createRunControls, type RunControls } from '../runControls.js';
import { table } from '../table.js';
import { runClose } from './close.js';
import { setupConfig } from './init.js';
import { runReview } from './review.js';

// Same relative path from src/cli/commands (tsx, vitest) and dist/cli/commands (build).
const { version } = createRequire(import.meta.url)('../../../package.json') as {
  version: string;
};

/** Seams for tests: the orchestration, the exit code and the signal source. */
export interface RunCommandOverrides {
  runSpec?: (options: RunSpecOptions, deps: RunSpecDeps) => Promise<RunResult>;
  runAll?: (options: RunAllOptions, deps: RunAllDeps) => Promise<RunAllResult>;
  /** The questions after a complete run on a terminal. */
  afterRun?: (input: AfterRunInput, deps: CliDeps) => Promise<void>;
  setExitCode?: (code: number) => void;
  /** Registers the SIGINT and SIGTERM handlers; returns the unregister function. */
  onSignal?: (handlers: SignalHandlers) => () => void;
  keepAwake?: boolean;
  /** Defaults to `process.stdout.isTTY`. */
  isTTY?: boolean;
  createInkReporter?: (controls: RunControls) => InkReporter;
}

export interface SignalHandlers {
  /** SIGINT: Ctrl+C without the dashboard (which reads keys itself), or `kill -INT`. */
  interrupt: () => void;
  /** SIGTERM: always aborts right away. */
  terminate: () => void;
}

interface RunFlags {
  all?: boolean;
  dryRun?: boolean;
  task?: string;
  retryBlocked?: boolean;
  base: string;
  model?: string;
  burn?: boolean;
  account?: string;
  // commander turns `--no-ui` into `ui: false`.
  ui: boolean;
}

/** First run in a repo: offer the init wizard instead of failing on the missing config. */
async function ensureConfig(repoRoot: string, deps: CliDeps): Promise<void> {
  if (!deps.interactive || existsSync(join(repoRoot, CONFIG_FILE))) return;
  const prompter = deps.prompter();
  let yes: boolean;
  try {
    yes = await prompter.confirm(`No ${CONFIG_FILE} in ${repoRoot} — set it up now?`, true);
  } finally {
    prompter.close();
  }
  if (!yes) {
    throw new SpecrunError('config-missing', `${CONFIG_FILE} not found in ${repoRoot}`, [
      'run specrun init to create it',
    ]);
  }
  await setupConfig(repoRoot, deps, { interactive: true });
}

function processSignals({ interrupt, terminate }: SignalHandlers): () => void {
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  return () => {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  };
}

export function buildRunOptions(
  spec: string,
  flags: RunFlags,
  workspace: RunSpecOptions['workspace'],
): RunSpecOptions {
  return {
    spec,
    base: flags.base,
    retryBlocked: flags.retryBlocked === true,
    workspace,
    ...(flags.burn === true ? { burn: true } : {}),
    ...(flags.task === undefined ? {} : { taskFilter: flags.task }),
    ...(flags.model === undefined ? {} : { modelOverride: flags.model }),
  };
}

function checkFlags(spec: string | undefined, flags: RunFlags): void {
  if ((spec === undefined) === (flags.all !== true)) {
    throw new SpecrunError('spec-missing', 'Name a spec, or use --all');
  }
  if (flags.all === true && flags.task !== undefined) {
    throw new SpecrunError('spec-invalid', '--task needs a spec, not --all');
  }
  if (flags.dryRun === true && flags.all !== true) {
    throw new SpecrunError('spec-invalid', '--dry-run works with --all only');
  }
}

/** Prints the table and keeps it in `.specrun/logs/all/` (SRD-31). */
function reportAll(result: RunAllResult, repoRoot: string, base: string, deps: CliDeps): void {
  const at = deps.now();
  const file = join(
    repoRoot,
    '.specrun',
    'logs',
    'all',
    `summary-${at.toISOString().replace(/[:.]/g, '-')}.md`,
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, summaryMarkdown(result, at, base));
  const merged =
    result.merged > 0 ? [`merged ${result.merged} commit(s) of ${base} into specrun/all`] : [];
  deps.stdout(
    `${[...merged, table(summaryRows(result.specs)), `summary: ${relative(repoRoot, file)}`].join('\n')}\n`,
  );
}

export function register(
  program: Command,
  deps: CliDeps,
  overrides: RunCommandOverrides = {},
): void {
  program
    .command('run')
    .description('Run a spec — or every spec with --all — task by task until done or a limit')
    .argument('[spec]', 'spec folder name under specsDir')
    .option('--all', 'run every spec, alphabetically, in one shared worktree')
    .option('--dry-run', 'with --all: show what would run, change nothing')
    .option('--task <id>', 'run only this task')
    .option('--retry-blocked', 'run blocked tasks again')
    .option('--base <ref>', 'ref the spec branch is created from', 'HEAD')
    .option('--model <alias>', 'model alias for every session')
    .option(
      '-b, --burn',
      'with several accounts: move on when the 5-hour window is low instead of waiting',
    )
    .option('--account <name>', 'use only this account (no switching)')
    .option('--no-ui', 'plain log lines instead of the dashboard')
    .action(async (spec: string | undefined, flags: RunFlags) => {
      checkFlags(spec, flags);
      const repoRoot = findRepoRoot(deps.cwd);
      await ensureConfig(repoRoot, deps);
      const config = loadConfig(repoRoot);
      const setExitCode = overrides.setExitCode ?? ((code) => void (process.exitCode = code));
      const allOptions = {
        base: flags.base,
        retryBlocked: flags.retryBlocked === true,
        ...(flags.burn === true ? { burn: true } : {}),
        ...(flags.model === undefined ? {} : { modelOverride: flags.model }),
      };
      if (flags.dryRun === true) {
        const plan = await planAll(allOptions, { repoRoot, config, run: runCommand });
        deps.stdout(`${planLines(plan, flags.base).join('\n')}\n`);
        setExitCode(plan.conflicts.length > 0 ? 1 : 0);
        return;
      }
      // MAD-15: tokens are resolved once, before any work starts; a failure ends the command here.
      const prepared = await prepareAccounts(
        {
          config,
          global: loadGlobalConfig({ homedir: deps.homedir }),
          selection:
            flags.account === undefined ? { kind: 'all' } : { kind: 'pinned', name: flags.account },
        },
        { env: deps.env, run: runCommand, platform: process.platform, cwd: repoRoot },
      );
      for (const warning of prepared.warnings) deps.stderr(`warning: ${warning}\n`);
      const [firstAccount, ...otherAccounts] = prepared.accounts.map(
        ({ env, ...account }): RunAccount => ({
          ...account,
          env,
          probe: () => probeUsage({ cwd: repoRoot, ...(env === null ? {} : { env }) }),
        }),
      );
      if (firstAccount === undefined) throw new SpecrunError('account-unknown', 'no account');
      const isTTY = overrides.isTTY ?? process.stdout.isTTY === true;

      /** One run with its own controls and dashboard; the questions afterwards may start another. */
      const execute = async (): Promise<number> => {
        const controller = new AbortController();
        // Bound late: the dashboard needs the controls, the controls log through the reporter.
        let reporter: RunReporter | null = null;
        const controls = createRunControls({
          abort: () => controller.abort(),
          log: (message) => reporter?.log('warn', message),
        });
        const unregister = (overrides.onSignal ?? processSignals)({
          interrupt: () => controls.interrupt(),
          terminate: () => controller.abort(),
        });
        const awake =
          overrides.keepAwake === false
            ? { stop: (): void => undefined }
            : keepAwake({ pid: process.pid, platform: process.platform, spawn });
        const color = deps.env['NO_COLOR'] === undefined && isTTY;
        // SRD-2: the dashboard on a terminal; log lines for pipes, files and `--no-ui`.
        const ink =
          flags.ui && isTTY
            ? (
                overrides.createInkReporter ??
                ((c: RunControls) => createInkReporter({ stdout: process.stdout, controls: c }))
              )(controls)
            : null;
        reporter = ink?.reporter ?? createLineReporter(deps.stdout, { color, now: deps.now });
        try {
          const runDeps: RunSpecDeps = {
            repoRoot,
            config,
            session: createSdkSession(),
            run: runCommand,
            clock: systemClock,
            accounts: [firstAccount, ...otherAccounts],
            reporter,
            signal: controller.signal,
            stop: controls.stop,
            version,
          };
          const result =
            spec === undefined
              ? await (overrides.runAll ?? runAll)(allOptions, runDeps)
              : await (overrides.runSpec ?? runSpec)(
                  buildRunOptions(
                    spec,
                    flags,
                    runsShared(repoRoot, config, spec) ? 'shared' : 'own',
                  ),
                  runDeps,
                );
          await ink?.unmount();
          if ('specs' in result) reportAll(result, repoRoot, flags.base, deps);
          if (result.message !== undefined && result.exitCode !== 0) {
            deps.stderr(`specrun: ${result.message}\n`);
          }
          return result.exitCode;
        } finally {
          // Also on a throw, so main.ts prints its error below the last frame, not into it.
          await ink?.unmount();
          unregister();
          awake.stop();
        }
      };

      const code = await execute();
      setExitCode(code);
      // SRD-33: only after a complete run, and only where someone can answer.
      const specs = spec === undefined ? listSpecs(repoRoot, config) : [spec];
      const answerable = flags.ui && isTTY && deps.interactive;
      if (code !== 0 || !answerable || !allDone(repoRoot, config, specs)) return;
      const shared = spec === undefined || runsShared(repoRoot, config, spec);
      await (overrides.afterRun ?? afterRun)(
        {
          repoRoot,
          config,
          specs,
          rerun: async () => {
            const again = await execute();
            setExitCode(again);
            return again === 0 && allDone(repoRoot, config, specs);
          },
          review: () => runReview(specs, {}, repoRoot, config, deps),
          close: () =>
            runClose(
              { spec: shared ? null : (spec ?? null), force: false },
              repoRoot,
              config,
              deps,
            ),
          closeCommand: shared ? 'specrun close --all' : `specrun close ${spec ?? ''}`,
          run: runCommand,
        },
        deps,
      );
    });
}
