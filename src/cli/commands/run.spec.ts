import { rmSync } from 'node:fs';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureDeps, makeTempRepo, writeDemoSpec } from '../../../test/fixtures/specRepo.js';
import type { RunResult, RunSpecDeps, RunSpecOptions } from '../../runner/runSpec.js';
import { register } from './run.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
  writeDemoSpec(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function runCli(
  args: string[],
  result: RunResult,
): Promise<{ options: RunSpecOptions; deps: RunSpecDeps; exit: number[] }> {
  const captured: { options?: RunSpecOptions; deps?: RunSpecDeps } = {};
  const exit: number[] = [];
  const program = new Command('specrun');
  register(program, captureDeps(dir), {
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
  return { options: captured.options, deps: captured.deps, exit };
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
});
