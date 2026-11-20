import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpecrunError } from '../errors.js';
import type { NewEvent } from './eventSchema.js';
import { createEventStore, readEvents } from './eventStore.js';

const AT = new Date('2026-11-09T10:00:00.000Z');
const clock = { now: (): Date => AT };

const committed: NewEvent = {
  t: 'task.committed',
  task: 'SR-1',
  commit: 'abc1234def',
  filesChanged: 3,
  insertions: 40,
  deletions: 2,
};
const finished: NewEvent = { t: 'run.finished', reason: 'done' };

describe('event store', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'specrun-'));
    file = join(dir, 'specrun', 'specs', 'v1', 'events.jsonl');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('stamps, appends and reads back events', () => {
    const store = createEventStore({ file, runId: 'run-1', clock });
    const first = store.append(committed);
    store.append(finished);

    expect(first).toEqual({ ...committed, v: 1, at: AT.toISOString(), runId: 'run-1' });
    expect(store.read()).toEqual({
      events: [first, { ...finished, v: 1, at: AT.toISOString(), runId: 'run-1' }],
      unknown: 0,
    });
  });

  it('writes one newline-terminated line per event and fsyncs each', () => {
    const synced: number[] = [];
    const store = createEventStore({ file, runId: 'r', clock, fsync: (fd) => synced.push(fd) });
    store.append(committed);
    store.append(finished);

    const lines = readFileSync(file, 'utf8').split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(synced).toHaveLength(2);
  });

  it('rejects an invalid event before writing', () => {
    const store = createEventStore({ file, runId: 'r', clock });
    const bad = { ...committed, filesChanged: -1 };
    expect(() => store.append(bad)).toThrow(SpecrunError);
    expect(readEvents(file).events).toEqual([]);
  });

  it('treats a missing file as an empty log', () => {
    expect(readEvents(join(dir, 'nope.jsonl'))).toEqual({ events: [], unknown: 0 });
  });

  it('skips a half-written last line with a warning', () => {
    const store = createEventStore({ file, runId: 'r', clock });
    store.append(committed);
    appendFileSync(file, '{"v":1,"t":"run.fin');

    const warnings: string[] = [];
    const result = readEvents(file, { onWarning: (w) => warnings.push(w) });
    expect(result.events).toHaveLength(1);
    expect(warnings).toEqual([expect.stringMatching(/:2: skipped a half-written last line/)]);
  });

  it('cuts a half-written last line off before the next append', () => {
    const warnings: string[] = [];
    const store = createEventStore({ file, runId: 'r', clock, onWarning: (w) => warnings.push(w) });
    store.append(committed);
    appendFileSync(file, '{"v":1,"t":"run.fin');
    store.append(finished);

    expect(store.read().events.map((e) => e.t)).toEqual(['task.committed', 'run.finished']);
    expect(warnings).toEqual([expect.stringMatching(/removed a half-written last line/)]);
  });

  it('terminates a complete last line that lost its newline', () => {
    const store = createEventStore({ file, runId: 'r', clock });
    const line = JSON.stringify(store.append(committed));
    writeFileSync(file, line);
    store.append(finished);

    expect(store.read().events.map((e) => e.t)).toEqual(['task.committed', 'run.finished']);
  });

  it('throws with the line number on a corrupt middle line', () => {
    const store = createEventStore({ file, runId: 'r', clock });
    store.append(committed);
    appendFileSync(file, 'garbage\n');
    store.append(finished);

    expect(() => readEvents(file)).toThrow(/line 2:/);
  });

  it('throws with the line number on an invalid known event', () => {
    const flat = join(dir, 'events.jsonl');
    writeFileSync(flat, '{"v":1,"t":"task.committed","task":"SR-1"}\n');
    expect(() => readEvents(flat)).toThrow(
      expect.objectContaining({
        code: 'events-invalid',
        message: expect.stringMatching(/line 1: /),
      }),
    );
  });

  it('skips and counts events of unknown types', () => {
    const store = createEventStore({ file, runId: 'r', clock });
    store.append(committed);
    appendFileSync(file, '{"v":2,"t":"future.thing","at":"2027-01-01T00:00:00Z"}\n');
    store.append(finished);

    const result = store.read();
    expect(result.unknown).toBe(1);
    expect(result.events.map((e) => e.t)).toEqual(['task.committed', 'run.finished']);
  });

  it('round-trips plan.session events with and without metrics', () => {
    const store = createEventStore({ file, runId: 'r', clock });
    const withoutMetrics: NewEvent = {
      t: 'plan.session',
      sessionId: 'p1',
      resumed: false,
      exitCode: 0,
      metrics: null,
    };
    const withMetrics: NewEvent = {
      t: 'plan.session',
      sessionId: 'p1',
      resumed: true,
      exitCode: 1,
      metrics: {
        turns: 3,
        inputTokens: 10,
        outputTokens: 200,
        cacheRead: 3_000,
        cacheWrite: 400,
        peakContext: 1_500,
        models: ['claude-opus', 'claude-sonnet'],
        subagents: {
          files: 1,
          turns: 2,
          inputTokens: 5,
          outputTokens: 60,
          cacheRead: 700,
          cacheWrite: 80,
        },
      },
    };
    const first = store.append(withoutMetrics);
    const second = store.append(withMetrics);

    expect(store.read()).toEqual({ events: [first, second], unknown: 0 });
    expect(second).toMatchObject(withMetrics);
  });
  it('round-trips account.switched and session.started with an account', () => {
    const store = createEventStore({ file, runId: 'r', clock });
    const switched: NewEvent = {
      t: 'account.switched',
      task: 'SR-1',
      from: 'lorem',
      to: 'ipsum',
      reason: 'session-low',
    };
    const started: NewEvent = {
      t: 'session.started',
      task: 'SR-1',
      sessionId: null,
      segment: 1,
      attempt: 1,
      model: 'claude-opus',
      reason: 'limit-resume',
      prompt: { protocol: 1, spec: 2, brief: 3, deps: 4 },
      account: 'ipsum',
    };
    const first = store.append(switched);
    const second = store.append(started);

    expect(store.read()).toEqual({ events: [first, second], unknown: 0 });
    expect(second).toMatchObject({ account: 'ipsum' });
  });

  it('still reads a session.started without an account', () => {
    const flat = join(dir, 'events.jsonl');
    const line = {
      v: 1,
      at: AT.toISOString(),
      runId: 'r',
      t: 'session.started',
      task: 'SR-1',
      sessionId: 's1',
      segment: 0,
      attempt: 1,
      model: 'claude-opus',
      reason: 'start',
      prompt: { protocol: 1, spec: 2, brief: 3, deps: 4 },
    };
    writeFileSync(flat, `${JSON.stringify(line)}\n`);

    const [event] = readEvents(flat).events;
    expect(event).toEqual(line);
    expect(event).not.toHaveProperty('account');
  });
});
