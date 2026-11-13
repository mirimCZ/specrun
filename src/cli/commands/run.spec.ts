import { rmSync } from 'node:fs';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureDeps, makeTempRepo, writeDemoSpec } from '../../../test/fixtures/specRepo.js';
import { nullReporter } from '../../runner/reporter.js';
import type { RunResult, RunSpecDeps, RunSpecOptions } from '../../runner/runSpec.js';
import { register, type RunCommandOverrides, type SignalHandlers } from './run.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
  writeDemoSpec(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function runCli(
  args: string[],
  result: RunResult,
  extra: RunCommandOverrides = {},
  cliDeps = captureDeps(dir),
): Promise<{ options: RunSpecOptions; deps: RunSpecDeps; exit: number[]; err: string[] }> {
  const captured: { options?: RunSpecOptions; deps?: RunSpecDeps } = {};
  const exit: number[] = [];
  const program = new Command('specrun');
  register(program, cliDeps, {
    isTTY: false,
    ...extra,
    runSpec: (options, deps) => {
      captured.options = options;
      captured.deps = deps;
      return Promise.resolve(result);
    },
    setExitCode: (code) => void exit.push(code),
    onSignal: () => () => undefined,
    keepAwake: false,
  });
  await program.parseAsync(['node', 'specrun', 'run', ...args]);
  if (captured.options === undefined || captured.deps === undefined) throw new Error('not called');
  return { options: captured.options, deps: captured.deps, exit, err: cliDeps.err };
}

function fakeInk(
  calls: string[],
  err: readonly string[] = [],
): NonNullable<RunCommandOverrides['createInkReporter']> {
  return () => {
    calls.push('mount');
    return {
      reporter: nullReporter,
      unmount: () => {
        calls.push(`unmount (${err.length} errors printed)`);
        return Promise.resolve();
      },
    };
  };
}

describe('specrun run', () => {
  it('maps flags to runSpec options and sets the exit code', async () => {
    const { options, deps, exit } = await runCli(
      [
        'demo',
        '--task',
        'D-1',
        '--retry-blocked',
        '--all-phases',
        '--base',
        'develop',
        '--model',
        'opus',
        '--no-ui',
      ],
      { exitCode: 75, reason: 'paused-weekly' },
    );
    expect(options).toEqual({
      spec: 'demo',
      base: 'develop',
      taskFilter: 'D-1',
      retryBlocked: true,
      allPhases: true,
      modelOverride: 'opus',
    });
    expect(deps.repoRoot).toBe(dir);
    expect(exit).toEqual([75]);
  });

  it('uses defaults without flags', async () => {
    const { options, exit } = await runCli(['demo'], { exitCode: 0, reason: 'done' });
    expect(options).toEqual({
      spec: 'demo',
      base: 'HEAD',
      retryBlocked: false,
      allPhases: false,
    });
    expect(exit).toEqual([0]);
  });

  it('shows the dashboard on a TTY and unmounts it before the final message', async () => {
    const calls: string[] = [];
    const cliDeps = captureDeps(dir);
    const { deps, err } = await runCli(
      ['demo'],
      { exitCode: 1, reason: 'failed', message: 'boom' },
      { isTTY: true, createInkReporter: fakeInk(calls, cliDeps.err) },
      cliDeps,
    );
    expect(deps.reporter).toBe(nullReporter);
    // unmount runs again in `finally`; the real reporter makes the second call a no-op.
    expect(calls.slice(0, 2)).toEqual(['mount', 'unmount (0 errors printed)']);
    expect(err).toEqual(['specrun: boom\n']);
  });

  it('prints log lines with --no-ui or without a TTY', async () => {
    for (const [args, isTTY] of [
      [['demo', '--no-ui'], true],
      [['demo'], false],
    ] as const) {
      const calls: string[] = [];
      const { deps } = await runCli(
        [...args],
        { exitCode: 0, reason: 'done' },
        { isTTY, createInkReporter: fakeInk(calls) },
      );
      expect(calls).toEqual([]);
      expect(deps.reporter).not.toBe(nullReporter);
    }
  });

  it('asks to stop on the first SIGINT, aborts on the second and on SIGTERM', async () => {
    const seen: string[] = [];
    for (const signals of [['interrupt', 'interrupt'], ['terminate']] as const) {
      let handlers: SignalHandlers | null = null;
      const program = new Command('specrun');
      register(program, captureDeps(dir), {
        isTTY: false,
        keepAwake: false,
        setExitCode: () => undefined,
        onSignal: (registered) => {
          handlers = registered;
          return () => undefined;
        },
        runSpec: (_options, deps) => {
          for (const name of signals) {
            handlers?.[name]();
            seen.push(`${name}: stop=${deps.stop?.requested} aborted=${deps.signal.aborted}`);
          }
          return Promise.resolve({ exitCode: 0, reason: 'done' });
        },
      });
      await program.parseAsync(['node', 'specrun', 'run', 'demo']);
    }
    expect(seen).toEqual([
      'interrupt: stop=true aborted=false',
      'interrupt: stop=true aborted=true',
      'terminate: stop=false aborted=true',
    ]);
  });
});
