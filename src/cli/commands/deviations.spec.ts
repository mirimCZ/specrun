import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureDeps,
  eventLine,
  makeTempRepo,
  writeDemoSpec,
} from '../../../test/fixtures/specRepo.js';
import { writeArchivedHistory } from '../../../test/fixtures/archive.js';
import { doneTask } from '../../../test/fixtures/taskEvents.js';
import type { InteractiveResult } from '../../process/run.js';
import { DeviationsJsonSchema } from '../../stats/jsonOutput.js';
import { createProgram } from '../program.js';
import { register } from './deviations.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
  const specDir = writeDemoSpec(dir);
  const completed = (task: string, deviations: unknown[]): string =>
    eventLine({
      t: 'task.completed',
      task,
      sessionId: null,
      payload: { summary: 's', commitMessage: 'm', notes: [], deviations },
    });
  writeFileSync(
    join(specDir, 'events.jsonl'),
    doneTask(
      'D-1',
      10,
      0.3,
      completed('D-1', [
        { kind: 'spec-bug', decision: 'use X', what: 'brief wrong', why: 'code differs' },
        { kind: 'scope', what: 'extra file', why: 'needed' },
        {
          kind: 'ambiguity',
          what: 'kept the alias',
          why: 'simplest',
          question: { text: 'Keep the alias?', options: ['keep', 'drop'], chosen: 'keep' },
        },
      ]),
    ) +
      completed('D-2', [{ kind: 'test-trap', what: 'flaky', why: 'timing' }]) +
      eventLine({ t: 'task.blocked', task: 'D-2', reason: 'stuck', source: 'agent' }),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function deviations(...args: string[]): Promise<string> {
  const deps = captureDeps(dir);
  await createProgram(deps).parseAsync(['node', 'specrun', 'deviations', ...args]);
  return deps.out.join('');
}

interface Launch {
  cmd: string;
  args: readonly string[];
  cwd: string;
}

/** A terminal session: `launch` stands in for Claude Code. */
async function review(
  args: string[],
  result: InteractiveResult = { code: 0, error: null },
): Promise<{ launches: Launch[]; exit: number[]; out: string }> {
  const deps = { ...captureDeps(dir), interactive: true };
  const launches: Launch[] = [];
  const exit: number[] = [];
  const program = new Command('specrun');
  register(program, deps, {
    launch: (cmd, launchArgs, opts) => {
      launches.push({ cmd, args: launchArgs, cwd: opts.cwd });
      return Promise.resolve(result);
    },
    setExitCode: (code) => void exit.push(code),
  });
  await program.parseAsync(['node', 'specrun', 'deviations', ...args]);
  return { launches, exit, out: deps.out.join('') };
}

describe('specrun deviations', () => {
  it('groups by kind with counts, including blocked tasks', async () => {
    const output = await deviations();
    expect(output).toContain('spec-bug (1)');
    expect(output).toContain('demo/D-1 [spec-bug] use X: brief wrong — code differs');
    expect(output).toContain('demo/D-2 [test-trap] flaky — timing');
    expect(output).toContain(
      'demo/D-1 [ambiguity] kept the alias — simplest\n    Q: Keep the alias? → keep (over drop)',
    );
  });

  it('includes deviations kept by archived specs', async () => {
    writeArchivedHistory(dir, 'old', [
      {
        spec: 'old',
        task: 'OLD-1',
        kind: 'test-trap',
        decision: null,
        what: 'fake timers',
        why: 'leaked',
        question: null,
      },
    ]);
    const output = await deviations('--kind', 'test-trap');
    expect(output).toContain('test-trap (2)');
    expect(output).toContain('old/OLD-1 [test-trap] fake timers — leaked');
  });

  it('filters by kind', async () => {
    const output = await deviations('--kind', 'scope');
    expect(output).toContain('extra file');
    expect(output).not.toContain('brief wrong');
    await expect(deviations('--kind', 'nope')).rejects.toThrow('Invalid --kind');
  });

  it('validates its --json output against the schema', async () => {
    const json = DeviationsJsonSchema.parse(JSON.parse(await deviations('--json')));
    expect(json.deviations).toHaveLength(4);
    expect(json.counts).toEqual({ 'spec-bug': 1, scope: 1, ambiguity: 1, 'test-trap': 1 });
    expect(json.deviations.find((d) => d.kind === 'ambiguity')?.question).toEqual({
      text: 'Keep the alias?',
      options: ['keep', 'drop'],
      chosen: 'keep',
    });
    expect(json.deviations.find((d) => d.kind === 'scope')?.question).toBeNull();
  });

  describe('in a terminal', () => {
    it('starts Claude with the review instructions and the listing', async () => {
      writeArchivedHistory(dir, 'old', [
        {
          spec: 'old',
          task: 'OLD-1',
          kind: 'scope',
          decision: null,
          what: 'renamed',
          why: 'clash',
          question: null,
        },
      ]);
      const { launches, exit, out } = await review(['--kind', 'scope'], { code: 3, error: null });

      expect(out).toContain('Reviewing 2 deviation(s) with Claude');
      expect(launches).toHaveLength(1);
      const [launch] = launches;
      expect(launch?.cmd).toBe('claude');
      expect(launch?.cwd).toBe(dir);
      expect(launch?.args[0]).toBe('--append-system-prompt');
      expect(launch?.args[1]).toContain('# Deviation review');
      const message = launch?.args[2] ?? '';
      expect(message).toContain('(`specrun deviations --kind scope`)');
      expect(message).toContain('demo/D-1 [scope] extra file — needed');
      expect(message).not.toContain('brief wrong');
      expect(message).toContain('- demo: docs/demo — branch specrun/demo, no worktree');
      expect(message).toMatch(
        /- old: archived in docs\/archive\/old — full spec at commit \w+ \(docs\/old\)/,
      );
      // Claude's exit code becomes ours.
      expect(exit).toEqual([3]);
    });

    it('only prints with --print, and when there is nothing to review', async () => {
      const printed = await review(['--print']);
      expect(printed.launches).toEqual([]);
      expect(printed.out).toContain('spec-bug (1)');

      const empty = await review(['--kind', 'constraint']);
      expect(empty.launches).toEqual([]);
      expect(empty.out).toBe('No deviations reported.\n');
    });

    it('explains a missing claude binary', async () => {
      await expect(review([], { code: -1, error: 'spawn claude ENOENT' })).rejects.toThrow(
        'Could not start claude',
      );
    });
  });
});
