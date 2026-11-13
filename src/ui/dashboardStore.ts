import { createEventFormatter, type Segment } from '../cli/eventLines.js';
import type { SpecrunEvent } from '../events/eventSchema.js';
import { deriveState, lowestOpenPhase, type SpecState } from '../events/taskState.js';
import type { RunPhase, RunReporter, WaitingUpdate } from '../runner/reporter.js';
import type { Spec } from '../spec/specSchema.js';

export type RowStatus = 'done' | 'running' | 'todo' | 'blocked' | 'interrupted';

export interface TaskRowView {
  id: string;
  title: string;
  status: RowStatus;
  /** Model of the task's latest session; null before its first one. */
  model: string | null;
  turns: number;
  /** Context of the latest turn, only while the task runs. */
  context: number | null;
  costUsd: number;
  /** Dependencies not done yet, for `todo` rows. */
  needs: string[];
}

export interface LogLine {
  id: number;
  at: Date;
  segments: Segment[];
}

export interface UsageView {
  sessionLeft: number | null;
  sessionResetsAt: Date | null;
  weeklyLeft: number | null;
}

export interface DashboardView {
  /** Null until the runner has loaded the spec from the worktree. */
  title: string | null;
  phaseNumber: number | null;
  done: number;
  total: number;
  /** What the runner does right now; null once the run finished. */
  activity: { label: string; since: Date } | null;
  running: { task: string; since: Date } | null;
  rows: TaskRowView[];
  /** Latest tool call of the running task. */
  tool: string | null;
  usage: UsageView | null;
  waiting: WaitingUpdate | null;
  /** Milestone lines in order; append-only so Ink's `<Static>` prints each once. */
  log: LogLine[];
}

export interface DashboardStore extends RunReporter {
  snapshot(): DashboardView;
}

function phaseLabel(phase: RunPhase): string {
  switch (phase.kind) {
    case 'worktree':
      return 'creating worktree';
    case 'setup':
      return `setup: ${phase.command}`;
    case 'usage':
      return 'checking usage';
    case 'agent':
      return `${phase.task} agent`;
    case 'verify':
      return `${phase.task} verify`;
    case 'commit':
      return `${phase.task} commit`;
  }
}

function usageOf(event: SpecrunEvent): UsageView | null {
  if (event.t !== 'usage.snapshot') return null;
  return {
    sessionLeft: event.sessionLeft,
    sessionResetsAt: event.sessionResetsAt === null ? null : new Date(event.sessionResetsAt),
    weeklyLeft: event.weeklyLeft,
  };
}

/** Pure view model of a run: folds `RunReporter` updates; the clock only stamps phases and logs. */
export function createDashboardStore(options: { now: () => Date }): DashboardStore {
  const { now } = options;
  const formatter = createEventFormatter();
  let spec: Spec | null = null;
  const events: SpecrunEvent[] = [];
  let state: SpecState | null = null;
  let activity: DashboardView['activity'] = { label: 'starting', since: now() };
  let running: DashboardView['running'] = null;
  let tool: string | null = null;
  let usage: UsageView | null = null;
  let waiting: WaitingUpdate | null = null;
  const live = new Map<string, { turns: number; context: number }>();
  const models = new Map<string, string>();
  const log: LogLine[] = [];

  const push = (at: Date, segments: Segment[] | null): void => {
    if (segments !== null) log.push({ id: log.length, at, segments });
  };
  const record = (event: SpecrunEvent): void => {
    events.push(event);
    state = null;
    if (event.t === 'session.started') models.set(event.task, event.model);
    usage = usageOf(event) ?? usage;
  };

  const rowOf = (task: Spec['tasks'][number], current: SpecState): TaskRowView => {
    const taskState = current.tasks.get(task.id);
    const isRunning = running?.task === task.id;
    const turnUpdate = isRunning ? live.get(task.id) : undefined;
    return {
      id: task.id,
      title: task.title,
      status: isRunning ? 'running' : (taskState?.status ?? 'todo'),
      model: models.get(task.id) ?? null,
      turns: turnUpdate?.turns ?? taskState?.totals.turns ?? 0,
      context: turnUpdate?.context ?? null,
      costUsd: taskState?.totals.costUsd ?? 0,
      needs: task.needs.filter((need) => current.tasks.get(need)?.status !== 'done'),
    };
  };

  return {
    plan(plan) {
      spec = plan.spec;
      formatter.plan(plan.spec);
      for (const event of plan.events) record(event);
    },
    phase(phase) {
      activity = { label: phaseLabel(phase), since: now() };
      waiting = null;
      if (phase.kind !== 'agent') tool = null;
      push(now(), formatter.phase(phase));
    },
    event(event) {
      record(event);
      switch (event.t) {
        case 'session.started':
          if (running?.task !== event.task) {
            running = { task: event.task, since: new Date(event.at) };
            live.delete(event.task);
          }
          waiting = null;
          break;
        case 'task.committed':
        case 'task.blocked':
          if (running?.task === event.task) running = null;
          tool = null;
          break;
        case 'run.finished':
          running = null;
          activity = null;
          tool = null;
          waiting = null;
          break;
        default:
          break;
      }
      push(new Date(event.at), formatter.event(event));
    },
    activity(update) {
      tool = `${update.tool}${update.detail === '' ? '' : ` ${update.detail}`}`;
    },
    turn(update) {
      live.set(update.task, { turns: update.turns, context: update.context });
    },
    waiting(update) {
      waiting = update;
      activity = {
        label: 'waiting',
        since: activity?.label === 'waiting' ? activity.since : now(),
      };
    },
    log(level, message) {
      push(now(), [
        { text: message, tone: level === 'error' ? 'red' : level === 'warn' ? 'yellow' : 'dim' },
      ]);
    },
    snapshot() {
      if (spec === null) {
        return {
          title: null,
          phaseNumber: null,
          done: 0,
          total: 0,
          activity,
          running,
          rows: [],
          tool,
          usage,
          waiting,
          log: [...log],
        };
      }
      const current = state ?? deriveState(spec, events);
      state = current;
      const rows = spec.tasks.map((task) => rowOf(task, current));
      return {
        title: spec.title,
        phaseNumber: lowestOpenPhase(spec, current),
        done: rows.filter((row) => row.status === 'done').length,
        total: rows.length,
        activity,
        running,
        rows,
        tool,
        usage,
        waiting,
        log: [...log],
      };
    },
  };
}
