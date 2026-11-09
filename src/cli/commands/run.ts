import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Command } from 'commander';
import { loadConfig, findRepoRoot } from '../../config/loadConfig.js';
import { keepAwake } from '../../limits/keepAwake.js';
import { systemClock } from '../../limits/clock.js';
import { runCommand } from '../../process/run.js';
import {
  runSpec,
  type RunResult,
  type RunSpecDeps,
  type RunSpecOptions,
} from '../../runner/runSpec.js';
import { probeUsage } from '../../session/probeUsage.js';
import { createSdkSession } from '../../session/sdkSession.js';
import type { CliDeps } from '../cliDeps.js';
import { createLineReporter } from '../lineReporter.js';

// Same relative path from src/cli/commands (tsx, vitest) and dist/cli/commands (build).
const { version } = createRequire(import.meta.url)('../../../package.json') as {
  version: string;
};

/** Seams for tests: the orchestration, the exit code and the signal source. */
export interface RunCommandOverrides {
  runSpec?: (options: RunSpecOptions, deps: RunSpecDeps) => Promise<RunResult>;
  setExitCode?: (code: number) => void;
  /** Registers an abort handler for SIGINT/SIGTERM; returns the unregister function. */
  onSignal?: (handler: () => void) => () => void;
  keepAwake?: boolean;
}

interface RunFlags {
  task?: string;
  retryBlocked?: boolean;
  allPhases?: boolean;
  base: string;
  model?: string;
  // commander turns `--no-ui` into `ui: false`; until the Ink dashboard (SR-11) it changes nothing.
  ui: boolean;
}

function processSignals(handler: () => void): () => void {
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
}

export function buildRunOptions(spec: string, flags: RunFlags): RunSpecOptions {
  return {
    spec,
    base: flags.base,
    retryBlocked: flags.retryBlocked === true,
    allPhases: flags.allPhases === true,
    ...(flags.task === undefined ? {} : { taskFilter: flags.task }),
    ...(flags.model === undefined ? {} : { modelOverride: flags.model }),
  };
}

export function register(
  program: Command,
  deps: CliDeps,
  overrides: RunCommandOverrides = {},
): void {
  program
    .command('run')
    .description('Run a spec task by task until done, a phase checkpoint or a limit')
    .argument('<spec>', 'spec folder name under specsDir')
    .option('--task <id>', 'run only this task')
    .option('--retry-blocked', 'run blocked tasks again')
    .option('--all-phases', 'do not stop at phase checkpoints')
    .option('--base <ref>', 'ref the spec branch is created from', 'HEAD')
    .option('--model <alias>', 'model alias for every session')
    .option('--no-ui', 'plain log lines instead of the dashboard')
    .action(async (spec: string, flags: RunFlags) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const config = loadConfig(repoRoot);
      const controller = new AbortController();
      const unregister = (overrides.onSignal ?? processSignals)(() => controller.abort());
      const awake =
        overrides.keepAwake === false
          ? { stop: (): void => undefined }
          : keepAwake({ pid: process.pid, platform: process.platform, spawn });
      const color = deps.env['NO_COLOR'] === undefined && process.stdout.isTTY === true;
      try {
        const result = await (overrides.runSpec ?? runSpec)(buildRunOptions(spec, flags), {
          repoRoot,
          config,
          session: createSdkSession(),
          run: runCommand,
          clock: systemClock,
          probeUsage: () => probeUsage({ cwd: repoRoot }),
          reporter: createLineReporter(deps.stdout, { color, now: deps.now }),
          signal: controller.signal,
          version,
        });
        if (result.message !== undefined && result.exitCode !== 0) {
          deps.stderr(`specrun: ${result.message}\n`);
        }
        (overrides.setExitCode ?? ((code) => void (process.exitCode = code)))(result.exitCode);
      } finally {
        unregister();
        awake.stop();
      }
    });
}
