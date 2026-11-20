import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../test/fakes/fakeClock.js';
import type { SpecrunEvent } from '../events/eventSchema.js';
import type { Spec } from '../spec/specSchema.js';
import { createDashboardStore } from './dashboardStore.js';

const spec: Spec = {
  title: 'Traits',
  tasks: [
    { id: 'TR-1', title: 'Schema', phase: 1, needs: [], model: 'default', size: 'S' },
    { id: 'TR-2', title: 'Picker', phase: 1, needs: ['TR-1'], model: 'default', size: 'M' },
    { id: 'TR-3', title: 'Docs', phase: 2, needs: [], model: 'default', size: 'S' },
  ],
};

const at = (minute: number): string => new Date(Date.UTC(2026, 10, 13, 0, minute)).toISOString();
const asEvent = (minute: number, event: object): SpecrunEvent =>
  ({ v: 1, at: at(minute), runId: 'r', ...event }) as SpecrunEvent;

const started = (minute: number, task: string): SpecrunEvent =>
  asEvent(minute, {
    t: 'session.started',
    task,
    sessionId: null,
    segment: 0,
    attempt: 1,
    model: 'opus',
    reason: 'start',
    prompt: { protocol: 1, spec: 1, brief: 1, deps: 0 },
  });

const finished = (minute: number, task: string, turns: number, costUsd: number): SpecrunEvent =>
  asEvent(minute, {
    t: 'session.finished',
    task,
    sessionId: `s-${task}`,
    segment: 0,
    outcome: 'completed',
    turns,
    peakContext: 50_000,
    inputTokens: 1,
    outputTokens: 1,
    cacheRead: 1,
    cacheWrite: 1,
    costUsd,
    durationMs: 1,
  });

const committed = (minute: number, task: string): SpecrunEvent =>
  asEvent(minute, {
    t: 'task.committed',
    task,
    commit: 'abcdef1234',
    filesChanged: 1,
    insertions: 1,
    deletions: 0,
  });

function setup(): {
  store: ReturnType<typeof createDashboardStore>;
  clock: ReturnType<typeof createFakeClock>;
} {
  const clock = createFakeClock(new Date(at(0)));
  return { store: createDashboardStore({ now: () => clock.now() }), clock };
}

describe('createDashboardStore', () => {
  it('keeps usage per account and follows the active account', () => {
    const { store } = setup();
    store.plan({ spec, events: [] });
    const snap = (minute: number, account: string, sessionLeft: number): SpecrunEvent =>
      asEvent(minute, {
        t: 'usage.snapshot',
        account,
        sessionLeft,
        sessionResetsAt: null,
        weeklyLeft: 50,
        weeklyResetsAt: null,
        source: 'probe',
      });
    store.event(snap(0, 'default', 10));
    store.event(snap(1, 'ipsum', 80));
    store.event({ ...started(2, 'TR-1'), account: 'ipsum' } as SpecrunEvent);
    const view = store.snapshot();
    expect(view.accounts.map((a) => [a.name, a.usage.sessionLeft])).toEqual([
      ['default', 10],
      ['ipsum', 80],
    ]);
    expect(view.activeAccount).toBe('ipsum');
    expect(view.usage?.sessionLeft).toBe(80);
  });

  it('starts the rows over for the next spec of run --all and shows its position', () => {
    const clock = createFakeClock(new Date(at(0)));
    const store = createDashboardStore({ now: () => clock.now() });
    store.plan({ spec, events: [started(1, 'TR-1')], position: { index: 1, total: 2 } });
    store.event(started(2, 'TR-1'));
    const next: Spec = {
      title: 'Billing',
      tasks: [{ id: 'BI-1', title: 'Plans', phase: 1, needs: [], model: 'default', size: 'S' }],
    };
    store.plan({ spec: next, events: [], position: { index: 2, total: 2 } });

    const view = store.snapshot();
    expect(view.title).toBe('Billing (spec 2/2)');
    expect(view.running).toBeNull();
    expect(view.rows.map((row) => [row.id, row.status, row.model])).toEqual([
      ['BI-1', 'todo', null],
    ]);
  });

  it('shows the startup phases before the spec is known', () => {
    const { store, clock } = setup();
    store.phase({ kind: 'worktree', path: '.specrun/worktrees/traits' });
    clock.advance(1000);
    store.phase({ kind: 'setup', command: 'npm ci' });

    const view = store.snapshot();
    expect(view.title).toBeNull();
    expect(view.rows).toEqual([]);
    expect(view.activity).toEqual({ label: 'setup: npm ci', since: clock.now() });
    expect(view.log.map((line) => line.segments[0]?.text)).toEqual([
      'creating worktree .specrun/worktrees/traits',
      'setup: npm ci',
    ]);
  });

  it('names the verify step that runs now', () => {
    const { store } = setup();
    store.phase({ kind: 'verify', task: 'TR-1', round: 0, steps: ['typecheck', 'test'] });
    expect(store.snapshot().activity?.label).toBe('TR-1 verify: typecheck');
    const finished = { name: 'typecheck', ok: true, durationMs: 14_000 };
    store.phase({ kind: 'verify-step', task: 'TR-1', finished, next: 'test' });
    expect(store.snapshot().activity?.label).toBe('TR-1 verify: test');
    expect(store.snapshot().log.at(-1)?.segments).toEqual([
      { text: 'verify TR-1 typecheck: ' },
      { text: 'ok (14s)', tone: 'green' },
    ]);
  });

  it('builds rows from the earlier log and the live updates of the running task', () => {
    const { store } = setup();
    store.plan({ spec, events: [started(1, 'TR-1'), finished(2, 'TR-1', 10, 0.4)] });
    store.phase({ kind: 'agent', task: 'TR-1' });
    store.event(started(3, 'TR-1'));
    store.turn({ task: 'TR-1', turns: 14, context: 58_000, costUsd: 0.4 });
    store.activity({ task: 'TR-1', tool: 'Edit', detail: 'src/traits/model.ts' });

    const view = store.snapshot();
    expect(view).toMatchObject({
      title: 'Traits',
      phaseNumber: 1,
      done: 0,
      total: 3,
      activity: { label: 'TR-1 agent' },
      running: { task: 'TR-1', since: new Date(at(3)) },
      tool: 'Edit src/traits/model.ts',
    });
    expect(view.rows).toEqual([
      {
        id: 'TR-1',
        title: 'Schema',
        status: 'running',
        model: 'opus',
        turns: 14,
        context: 58_000,
        costUsd: 0.4,
        needs: [],
      },
      {
        id: 'TR-2',
        title: 'Picker',
        status: 'todo',
        model: null,
        turns: 0,
        context: null,
        costUsd: 0,
        needs: ['TR-1'],
      },
      expect.objectContaining({ id: 'TR-3', status: 'todo', needs: [] }),
    ]);
    // History is not replayed into the log; only this run's milestones are.
    expect(view.log.map((line) => line.segments[0]?.text)).toEqual(['▶ TR-1 Schema (start, opus)']);
  });

  it('marks committed and blocked tasks and clears the tool line', () => {
    const { store } = setup();
    store.plan({ spec, events: [] });
    store.event(started(1, 'TR-1'));
    store.activity({ task: 'TR-1', tool: 'Bash', detail: 'npm test' });
    store.event(finished(2, 'TR-1', 20, 0.7));
    store.event(committed(3, 'TR-1'));
    store.event(started(4, 'TR-3'));
    store.event(asEvent(5, { t: 'task.blocked', task: 'TR-3', reason: 'stuck', source: 'agent' }));

    const view = store.snapshot();
    expect(view.rows.map((row) => [row.id, row.status, row.turns, row.needs])).toEqual([
      ['TR-1', 'done', 20, []],
      ['TR-2', 'todo', 0, []],
      ['TR-3', 'blocked', 0, []],
    ]);
    expect(view.done).toBe(1);
    expect(view.running).toBeNull();
    expect(view.tool).toBeNull();
  });

  it('keeps the latest usage, shows a wait until the next phase and stops at the end', () => {
    const { store, clock } = setup();
    store.plan({
      spec,
      events: [
        asEvent(0, {
          t: 'usage.snapshot',
          sessionLeft: 12,
          sessionResetsAt: at(300),
          weeklyLeft: 63,
          weeklyResetsAt: null,
          source: 'probe',
        }),
      ],
    });
    expect(store.snapshot().usage).toEqual({
      sessionLeft: 12,
      sessionResetsAt: new Date(at(300)),
      weeklyLeft: 63,
    });

    const until = new Date(at(300));
    store.waiting({ until, reason: 'session-low' });
    clock.advance(60_000);
    store.waiting({ until, reason: 'session-low' });
    expect(store.snapshot()).toMatchObject({
      waiting: { until, reason: 'session-low' },
      activity: { label: 'waiting', since: new Date(at(0)) },
    });

    store.phase({ kind: 'usage' });
    expect(store.snapshot().waiting).toBeNull();

    store.log('warn', 'usage probe failed — running without limit data');
    store.event(asEvent(9, { t: 'run.finished', reason: 'done' }));
    const view = store.snapshot();
    expect(view.activity).toBeNull();
    expect(view.log.map((line) => line.segments)).toEqual([
      [{ text: 'usage probe failed — running without limit data', tone: 'yellow' }],
      [{ text: 'run finished: done' }],
    ]);
  });
});
