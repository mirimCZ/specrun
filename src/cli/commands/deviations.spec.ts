import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureDeps,
  eventLine,
  makeTempRepo,
  writeDemoSpec,
} from '../../../test/fixtures/specRepo.js';
import { SHELVED, writeArchivedHistory } from '../../../test/fixtures/archive.js';
import { doneTask } from '../../../test/fixtures/taskEvents.js';
import { DeviationsJsonSchema } from '../../stats/jsonOutput.js';
import { createProgram } from '../program.js';

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

  it('marks deviations of shelved specs', async () => {
    const deviation = {
      spec: 'old',
      task: 'OLD-1',
      kind: 'scope',
      decision: null,
      what: 'extra flag',
      why: 'needed',
      question: null,
    } as const;
    writeArchivedHistory(dir, 'old', [deviation], SHELVED);
    expect(await deviations('--kind', 'scope')).toContain(
      'old/OLD-1 [scope] (shelved) extra flag — needed',
    );
    const json = DeviationsJsonSchema.parse(JSON.parse(await deviations('--json')));
    expect(json.shelved).toEqual(['old']);
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
});
