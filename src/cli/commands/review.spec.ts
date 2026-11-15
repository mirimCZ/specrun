import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureDeps,
  eventLine,
  makeTempRepo,
  writeDemoSpec,
} from '../../../test/fixtures/specRepo.js';
import { createScriptedPrompter } from '../../../test/fakes/fakePrompter.js';
import { writeArchivedHistory } from '../../../test/fixtures/archive.js';
import { doneTask } from '../../../test/fixtures/taskEvents.js';
import { readArchivedHistories } from '../../archive/history.js';
import { ConfigSchema } from '../../config/configSchema.js';
import { readEvents } from '../../events/eventStore.js';
import type { InteractiveResult } from '../../process/run.js';
import { register } from './review.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
  const specDir = writeDemoSpec(dir);
  writeFileSync(
    join(specDir, 'events.jsonl'),
    doneTask(
      'D-1',
      10,
      0.3,
      eventLine({
        t: 'task.completed',
        task: 'D-1',
        sessionId: null,
        payload: {
          summary: 's',
          commitMessage: 'm',
          notes: [],
          deviations: [
            { kind: 'scope', what: 'extra file', why: 'needed' },
            { kind: 'test-trap', what: 'flaky', why: 'timing' },
          ],
        },
      }),
    ),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Launch {
  cmd: string;
  args: readonly string[];
  cwd: string;
}

async function review(
  args: string[],
  {
    interactive = true,
    result = { code: 0, error: null } as InteractiveResult,
    answers = [] as string[],
  } = {},
): Promise<{ launches: Launch[]; exit: number[]; out: string; prompts: string[] }> {
  const scripted = createScriptedPrompter(answers);
  const deps = { ...captureDeps(dir), interactive, prompter: () => scripted.prompter };
  const launches: Launch[] = [];
  const exit: number[] = [];
  const program = new Command('specrun');
  register(program, deps, {
    // No git here: every git call fails, so commits and branches are simply unknown.
    run: () => Promise.resolve({ code: 128, stdout: '', stderr: 'no git', durationMs: 0 }),
    launch: (cmd, launchArgs, opts) => {
      launches.push({ cmd, args: launchArgs, cwd: opts.cwd });
      return Promise.resolve(result);
    },
    setExitCode: (code) => void exit.push(code),
  });
  await program.parseAsync(['node', 'specrun', 'review', ...args]);
  return { launches, exit, out: deps.out.join(''), prompts: scripted.prompts };
}

describe('specrun review', () => {
  it('starts Claude with the context file and the listing as the first message', async () => {
    const { launches, exit, out } = await review(['demo', '--kind', 'scope'], {
      result: { code: 3, error: null },
    });

    expect(out).toContain(
      'Reviewing 1 deviation(s) with Claude — context in .specrun/review/demo.md',
    );
    expect(launches).toHaveLength(1);
    const [launch] = launches;
    expect(launch?.cmd).toBe('claude');
    expect(launch?.cwd).toBe(dir);
    expect(launch?.args[0]).toBe('--append-system-prompt-file');
    const file = launch?.args[1] ?? '';
    expect(file).toBe(join(dir, '.specrun', 'review', 'demo.md'));
    const systemPrompt = readFileSync(file, 'utf8');
    expect(systemPrompt).toContain('# Deviation review');
    expect(systemPrompt).toContain('## Spec demo — Demo');
    expect(systemPrompt).toContain('<brief path="docs/demo/tasks/D-1.md">\n# D-1\n</brief>');
    expect(systemPrompt).toContain('No commit');
    const message = launch?.args[2] ?? '';
    expect(message).toContain('(`specrun review demo --kind scope`)');
    expect(message).toContain('demo/D-1 [scope] extra file — needed');
    expect(message).not.toContain('flaky');
    // Claude's exit code becomes ours.
    expect(exit).toEqual([3]);
  });

  it('prints what Claude would get with --print, also without a terminal', async () => {
    const { launches, out } = await review(['--print'], { interactive: false });
    expect(launches).toEqual([]);
    expect(out).toContain('# Review context');
    expect(out).toContain("Let's review these deviations together (`specrun review`)");
  });

  it('needs a terminal otherwise, and something to review', async () => {
    await expect(review([], { interactive: false })).rejects.toThrow('needs a terminal');
    const empty = await review(['--kind', 'constraint']);
    expect(empty.launches).toEqual([]);
    expect(empty.out).toBe('No deviations reported — nothing to review.\n');
  });

  it('marks the reviewed deviations on yes, so the next review skips them', async () => {
    const first = await review(['demo', '--kind', 'scope'], { answers: [''] });
    expect(first.prompts).toEqual(['Mark the 1 deviation(s) as reviewed? [Y/n] ']);
    expect(first.out).toContain('Marked as reviewed in docs/demo/events.jsonl');
    const { events } = readEvents(join(dir, 'docs', 'demo', 'events.jsonl'));
    expect(events.at(-1)).toMatchObject({
      t: 'deviations.reviewed',
      deviations: [{ task: 'D-1', id: expect.stringMatching(/^[0-9a-f]{12}$/) }],
    });

    // Only the test trap is left; --include-reviewed brings the scope one back.
    const second = await review([], { answers: ['n'] });
    expect(second.launches[0]?.args[2]).toContain('demo/D-1 [test-trap] flaky');
    expect(second.launches[0]?.args[2]).not.toContain('extra file');
    const again = await review(['--include-reviewed'], { answers: ['n'] });
    expect(again.prompts).toEqual(['Mark the 1 deviation(s) as reviewed? [Y/n] ']);
    expect(again.launches[0]?.args[2]).toContain('demo/D-1 [scope] (reviewed) extra file');

    await review([], { answers: ['y'] });
    const done = await review([]);
    expect(done.launches).toEqual([]);
    expect(done.out).toBe(
      'All 2 deviation(s) were reviewed before — --include-reviewed shows them again.\n',
    );
  });

  it('rewrites history.json for archived specs', async () => {
    writeArchivedHistory(dir, 'old', [
      {
        spec: 'old',
        task: 'OLD-1',
        kind: 'spec-bug',
        decision: null,
        what: 'wrong path',
        why: 'moved',
        question: null,
      },
    ]);
    const { out } = await review(['old'], { answers: [''] });
    expect(out).toContain('Marked as reviewed in docs/archive/old/history.json');
    const config = ConfigSchema.parse({ verify: [{ name: 'ok', command: 'true' }] });
    expect(readArchivedHistories(dir, config)[0]?.deviations[0]?.reviewed).toBe(true);
  });

  it('asks nothing when Claude fails, and nothing is marked on no', async () => {
    const failed = await review(['demo'], { result: { code: 1, error: null } });
    expect(failed.prompts).toEqual([]);
    const declined = await review(['demo'], { answers: ['n'] });
    expect(declined.out).not.toContain('Marked');
    expect((await review(['demo'], { answers: ['n'] })).launches).toHaveLength(1);
  });

  it('explains a missing claude binary', async () => {
    await expect(
      review([], { result: { code: -1, error: 'spawn claude ENOENT' } }),
    ).rejects.toThrow('Could not start claude');
  });
});
