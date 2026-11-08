import type { Spec, SpecTask } from '../spec/specSchema.js';
import { topologicalOrder } from '../spec/taskOrder.js';
import type { CompleteTaskPayload, EventOf, SpecrunEvent } from './eventSchema.js';

export type TaskStatus = 'todo' | 'done' | 'blocked' | 'interrupted';

export interface TaskTotals {
  /** Distinct sessions (a session spans several segments). */
  sessions: number;
  turns: number;
  costUsd: number;
  /** Maximum over all segments, not a sum. */
  peakContext: number;
  durationMs: number;
}

export interface TaskState {
  status: TaskStatus;
  /** Session to resume when `interrupted`; null otherwise or when its id was never reported. */
  resumeSessionId: string | null;
  /** Segment number of the next `session.started`: continues the resumed session, else 0. */
  nextSegment: number;
  /** Highest `attempt` of any `session.started` of the task; 0 before the first session. */
  attempts: number;
  /** Payload of the latest `task.completed` before the event that made the task `done`. */
  lastCompleted: CompleteTaskPayload | null;
  commit: string | null;
  blockedReason: string | null;
  totals: TaskTotals;
  budgetExceeded: boolean;
}

type SessionFinished = EventOf<'session.finished'>;
type SessionStarted = EventOf<'session.started'>;

/** One finished segment, joined with the `session.started` that opened it. */
export type SessionStats = Omit<SessionFinished, 'v' | 't' | 'runId'> & {
  attempt: number | null;
  model: string | null;
  reason: SessionStarted['reason'] | null;
};

export interface SpecState {
  tasks: Map<string, TaskState>;
  sessions: SessionStats[];
}

interface Accumulator {
  state: TaskState;
  latestCompleted: CompleteTaskPayload | null;
  latestCommit: string | null;
  /** Latest `session.started` after the latest status event, with the id learned since. */
  open: { sessionId: string | null; segment: number } | null;
  started: SessionStarted | null;
  sessionIds: Set<string>;
  anonymousSessions: number;
}

function emptyState(): TaskState {
  return {
    status: 'todo',
    resumeSessionId: null,
    nextSegment: 0,
    attempts: 0,
    lastCompleted: null,
    commit: null,
    blockedReason: null,
    totals: { sessions: 0, turns: 0, costUsd: 0, peakContext: 0, durationMs: 0 },
    budgetExceeded: false,
  };
}

/** Pure: replays the log in order. Events of tasks not in the spec are ignored for `tasks`. */
export function deriveState(spec: Spec, events: readonly SpecrunEvent[]): SpecState {
  const acc = new Map<string, Accumulator>();
  for (const task of spec.tasks) {
    acc.set(task.id, {
      state: emptyState(),
      latestCompleted: null,
      latestCommit: null,
      open: null,
      started: null,
      sessionIds: new Set(),
      anonymousSessions: 0,
    });
  }
  const sessions: SessionStats[] = [];

  for (const event of events) {
    if (!('task' in event) || event.task === undefined) continue;
    const entry = acc.get(event.task);
    if (entry === undefined) continue;
    const { state } = entry;

    switch (event.t) {
      case 'session.started':
        entry.started = event;
        entry.open = { sessionId: event.sessionId, segment: event.segment };
        state.attempts = Math.max(state.attempts, event.attempt);
        break;
      case 'session.finished': {
        const started = entry.started?.segment === event.segment ? entry.started : null;
        sessions.push({
          at: event.at,
          task: event.task,
          sessionId: event.sessionId,
          segment: event.segment,
          outcome: event.outcome,
          ...(event.error === undefined ? {} : { error: event.error }),
          turns: event.turns,
          peakContext: event.peakContext,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheRead: event.cacheRead,
          cacheWrite: event.cacheWrite,
          costUsd: event.costUsd,
          durationMs: event.durationMs,
          attempt: started?.attempt ?? null,
          model: started?.model ?? null,
          reason: started?.reason ?? null,
        });
        if (event.sessionId === null) entry.anonymousSessions += 1;
        else entry.sessionIds.add(event.sessionId);
        state.totals.turns += event.turns;
        state.totals.costUsd += event.costUsd;
        state.totals.durationMs += event.durationMs;
        state.totals.peakContext = Math.max(state.totals.peakContext, event.peakContext);
        // A new session learns its id only when the first segment finishes.
        if (entry.open !== null && entry.open.segment === event.segment) {
          entry.open.sessionId ??= event.sessionId;
        }
        break;
      }
      case 'task.completed':
        entry.latestCompleted = event.payload;
        break;
      case 'task.committed':
        entry.latestCommit = event.commit;
        setStatus(entry, 'done', null);
        break;
      case 'task.blocked':
        setStatus(entry, 'blocked', event.reason);
        break;
      case 'manual.status':
        setStatus(entry, event.status, event.status === 'blocked' ? event.reason : null);
        break;
      case 'budget.exceeded':
        state.budgetExceeded = true;
        break;
      default:
        break;
    }
  }

  const tasks = new Map<string, TaskState>();
  for (const [id, entry] of acc) {
    const { state, open } = entry;
    state.totals.sessions = entry.sessionIds.size + entry.anonymousSessions;
    // Any session after the latest status event left the task open: the runner records the
    // outcome (commit / block) right after the session, so only a crash or Ctrl-C ends up here.
    if (open !== null) {
      state.status = 'interrupted';
      state.resumeSessionId = open.sessionId;
      state.nextSegment = open.sessionId === null ? 0 : open.segment + 1;
    }
    tasks.set(id, state);
  }
  return { tasks, sessions };
}

function setStatus(entry: Accumulator, status: TaskStatus, blockedReason: string | null): void {
  const { state } = entry;
  state.status = status;
  state.blockedReason = blockedReason;
  state.lastCompleted = status === 'done' ? entry.latestCompleted : null;
  state.commit = status === 'done' ? entry.latestCommit : null;
  entry.open = null;
}

export interface RunnableOptions {
  retryBlocked: boolean;
}

/** Tasks whose needs are all `done` and that still have work, in execution order. */
export function runnableTasks(spec: Spec, state: SpecState, options: RunnableOptions): SpecTask[] {
  const statusOf = (id: string): TaskStatus | undefined => state.tasks.get(id)?.status;
  return topologicalOrder(spec).filter((task) => {
    const status = statusOf(task.id);
    const open =
      status === 'todo' ||
      status === 'interrupted' ||
      (status === 'blocked' && options.retryBlocked);
    return open && task.needs.every((need) => statusOf(need) === 'done');
  });
}

/** Lowest phase with a task that is neither `done` nor `blocked`; null when none is left. */
export function lowestOpenPhase(spec: Spec, state: SpecState): number | null {
  let lowest: number | null = null;
  for (const task of spec.tasks) {
    const status = state.tasks.get(task.id)?.status;
    if (status === 'done' || status === 'blocked') continue;
    if (lowest === null || task.phase < lowest) lowest = task.phase;
  }
  return lowest;
}
