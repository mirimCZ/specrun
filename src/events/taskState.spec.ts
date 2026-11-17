import { describe, expect, it } from 'vitest';
import type { Spec, SpecTask } from '../spec/specSchema.js';
import type { CompleteTaskPayload, EventOf, NewEvent, SpecrunEvent } from './eventSchema.js';
import { deriveState, lowestOpenPhase, runnableTasks } from './taskState.js';

function task(id: string, phase: number, needs: string[] = []): SpecTask {
  return { id, title: id, phase, needs, model: 'default', size: 'S' };
}

const spec: Spec = {
  title: 'Demo',
  tasks: [task('A-1', 1), task('A-2', 1, ['A-1']), task('A-3', 2, ['A-2'])],
};

function log(...events: NewEvent[]): SpecrunEvent[] {
  return events.map(
    (event, i) =>
      ({
        ...event,
        v: 1,
        at: new Date(Date.UTC(2026, 10, 9, 0, i)).toISOString(),
        runId: 'r',
      }) as SpecrunEvent,
  );
}

function started(
  taskId: string,
  sessionId: string | null,
  segment: number,
  reason: EventOf<'session.started'>['reason'] = 'start',
): NewEvent {
  return {
    t: 'session.started',
    task: taskId,
    sessionId,
    segment,
    attempt: 1,
    model: 'opus',
    reason,
    prompt: { protocol: 100, spec: 200, brief: 300, deps: 0 },
  };
}

function finished(
  taskId: string,
  sessionId: string | null,
  segment: number,
  stats: { turns: number; peakContext: number; costUsd: number } = {
    turns: 10,
    peakContext: 30_000,
    costUsd: 0.5,
  },
  outcome: EventOf<'session.finished'>['outcome'] = 'completed',
): NewEvent {
  return {
    t: 'session.finished',
    task: taskId,
    sessionId,
    segment,
    outcome,
    ...stats,
    inputTokens: 100,
    outputTokens: 2_000,
    cacheRead: 100_000,
    cacheWrite: 20_000,
    durationMs: 60_000,
  };
}

function payload(summary: string): CompleteTaskPayload {
  return { summary, commitMessage: `feat: ${summary}`, notes: [], deviations: [] };
}

function completed(taskId: string, summary: string): NewEvent {
  return { t: 'task.completed', task: taskId, sessionId: 's1', payload: payload(summary) };
}

function committed(taskId: string, commit: string): NewEvent {
  return {
    t: 'task.committed',
    task: taskId,
    commit,
    filesChanged: 1,
    insertions: 1,
    deletions: 0,
  };
}

function blocked(taskId: string, reason: string): NewEvent {
  return { t: 'task.blocked', task: taskId, reason, source: 'verify' };
}

function stateOf(events: SpecrunEvent[], id = 'A-1') {
  const state = deriveState(spec, events).tasks.get(id);
  if (state === undefined) throw new Error(`no state for ${id}`);
  return state;
}

describe('deriveState', () => {
  it('starts every task as todo', () => {
    expect(stateOf([])).toMatchObject({
      status: 'todo',
      resumeSessionId: null,
      nextSegment: 0,
      attempts: 0,
      lastCompleted: null,
      commit: null,
    });
  });

  it('marks a task done on commit', () => {
    const state = stateOf(
      log(
        started('A-1', null, 0),
        finished('A-1', 's1', 0),
        completed('A-1', 'did it'),
        committed('A-1', 'c1'),
      ),
    );
    expect(state).toMatchObject({
      status: 'done',
      commit: 'c1',
      resumeSessionId: null,
      attempts: 1,
    });
    expect(state.lastCompleted?.summary).toBe('did it');
  });

  it('marks a task blocked with its reason', () => {
    const state = stateOf(
      log(started('A-1', null, 0), finished('A-1', 's1', 0), blocked('A-1', 'red')),
    );
    expect(state).toMatchObject({ status: 'blocked', blockedReason: 'red', commit: null });
  });

  it('lets a manual status override a commit', () => {
    const events = log(started('A-1', null, 0), finished('A-1', 's1', 0), committed('A-1', 'c1'), {
      t: 'manual.status',
      task: 'A-1',
      status: 'todo',
      reason: 'redo',
    });
    expect(stateOf(events)).toMatchObject({ status: 'todo', commit: null, lastCompleted: null });
  });

  it('reports a started session without a finish as interrupted', () => {
    const state = stateOf(log(started('A-1', 's1', 0, 'start')));
    expect(state).toMatchObject({ status: 'interrupted', resumeSessionId: 's1', nextSegment: 1 });
  });

  it('cannot resume a session whose id was never reported', () => {
    const state = stateOf(log(started('A-1', null, 0)));
    expect(state).toMatchObject({ status: 'interrupted', resumeSessionId: null, nextSegment: 0 });
  });

  it('keeps the same session over a verify-fix segment', () => {
    const state = stateOf(
      log(
        started('A-1', null, 0),
        finished('A-1', 's1', 0),
        completed('A-1', 'first'),
        started('A-1', 's1', 1, 'verify-fix'),
      ),
    );
    expect(state).toMatchObject({ status: 'interrupted', resumeSessionId: 's1', nextSegment: 2 });
  });

  it('reports a finished session that left the task open as interrupted', () => {
    const state = stateOf(
      log(started('A-1', null, 0), finished('A-1', 's1', 0, undefined, 'limit')),
    );
    expect(state).toMatchObject({ status: 'interrupted', resumeSessionId: 's1', nextSegment: 1 });
  });

  it('ignores sessions before the latest status event', () => {
    const state = stateOf(
      log(
        started('A-1', 's1', 0),
        blocked('A-1', 'crashed'),
        started('A-1', 's2', 0),
        blocked('A-1', 'again'),
      ),
    );
    expect(state).toMatchObject({ status: 'blocked', resumeSessionId: null, nextSegment: 0 });
  });

  it('sums totals over all segments and sessions', () => {
    const state = stateOf(
      log(
        started('A-1', null, 0),
        finished('A-1', 's1', 0, { turns: 10, peakContext: 40_000, costUsd: 0.5 }),
        started('A-1', 's1', 1, 'verify-fix'),
        finished('A-1', 's1', 1, { turns: 5, peakContext: 60_000, costUsd: 0.25 }),
        blocked('A-1', 'red'),
        started('A-1', null, 0),
        finished('A-1', 's2', 0, { turns: 3, peakContext: 20_000, costUsd: 0.1 }),
      ),
    );
    expect(state.totals).toEqual({
      sessions: 2,
      turns: 18,
      costUsd: 0.85,
      peakContext: 60_000,
      durationMs: 180_000,
    });
  });

  it('takes the last completion before the commit as lastCompleted', () => {
    const state = stateOf(
      log(
        completed('A-1', 'first'),
        completed('A-1', 'after verify fix'),
        committed('A-1', 'c1'),
        completed('A-1', 'stray'),
      ),
    );
    // The stray completion has no session after the commit, so the task stays done.
    expect(state.status).toBe('done');
    expect(state.lastCompleted?.summary).toBe('after verify fix');
  });

  it('flags budget overruns and joins session stats with their start', () => {
    const events = log(started('A-1', null, 0), finished('A-1', 's1', 0), {
      t: 'budget.exceeded',
      task: 'A-1',
      size: 'S',
      turns: 99,
      costUsd: 9,
      limit: { turns: 40, usd: 2 },
    });
    const derived = deriveState(spec, events);
    expect(derived.tasks.get('A-1')?.budgetExceeded).toBe(true);
    expect(derived.sessions).toEqual([
      expect.objectContaining({
        task: 'A-1',
        sessionId: 's1',
        model: 'opus',
        reason: 'start',
        attempt: 1,
      }),
    ]);
  });
});

describe('deriveState with plan.session', () => {
  it('leaves task state untouched', () => {
    const base: NewEvent[] = [
      started('A-1', null, 0),
      finished('A-1', 's1', 0),
      completed('A-1', 'did it'),
      committed('A-1', 'c1'),
      started('A-2', 's2', 0),
    ];
    const plan: NewEvent = {
      t: 'plan.session',
      sessionId: 'p1',
      resumed: false,
      exitCode: 0,
      metrics: null,
    };
    const without = deriveState(spec, log(...base));
    const withPlan = deriveState(spec, log(plan, ...base.slice(0, 2), plan, ...base.slice(2)));
    expect(withPlan.tasks).toEqual(without.tasks);
    expect(withPlan.sessions.map(({ at: _at, ...rest }) => rest)).toEqual(
      without.sessions.map(({ at: _at, ...rest }) => rest),
    );
  });
});

describe('runnableTasks', () => {
  const ids = (events: SpecrunEvent[], retryBlocked = false): string[] =>
    runnableTasks(spec, deriveState(spec, events), { retryBlocked }).map((t) => t.id);

  it('only offers tasks whose needs are done', () => {
    expect(ids([])).toEqual(['A-1']);
    expect(ids(log(committed('A-1', 'c1')))).toEqual(['A-2']);
  });

  it('offers interrupted tasks', () => {
    expect(ids(log(started('A-1', 's1', 0)))).toEqual(['A-1']);
  });

  it('offers blocked tasks only with retryBlocked', () => {
    const events = log(blocked('A-1', 'red'));
    expect(ids(events)).toEqual([]);
    expect(ids(events, true)).toEqual(['A-1']);
  });
});

describe('lowestOpenPhase', () => {
  it('skips phases whose tasks are all done or blocked', () => {
    const phase = (events: SpecrunEvent[]): number | null =>
      lowestOpenPhase(spec, deriveState(spec, events));
    expect(phase([])).toBe(1);
    expect(phase(log(committed('A-1', 'c1'), blocked('A-2', 'red')))).toBe(2);
    expect(
      phase(log(committed('A-1', 'c1'), committed('A-2', 'c2'), committed('A-3', 'c3'))),
    ).toBeNull();
  });
});
