import type { SpecrunEvent } from '../events/eventSchema.js';
import type { Spec } from '../spec/specSchema.js';

export type ReporterLevel = 'info' | 'warn' | 'error';

export interface ActivityUpdate {
  task: string;
  tool: string;
  /** File path, command or pattern of the tool call; empty when the input has none. */
  detail: string;
}

export interface TurnUpdate {
  task: string;
  /** Turns of the task so far, all sessions included. */
  turns: number;
  /** Context size of the latest turn. */
  context: number;
  /** Cost of the task's finished segments (the SDK reports cost only at a segment's end). */
  costUsd: number;
}

export interface WaitingUpdate {
  until: Date;
  reason: 'session-low' | 'limit-hit';
}

/** What the runner is doing between events, so a UI never looks stuck. */
export type RunPhase =
  | { kind: 'worktree'; path: string }
  | { kind: 'setup'; command: string }
  | { kind: 'usage' }
  | { kind: 'agent'; task: string }
  | { kind: 'verify'; task: string }
  | { kind: 'commit'; task: string };

export interface RunPlan {
  /** The worktree's copy of the spec. */
  spec: Spec;
  /** The log before this run; later events arrive through `event`. */
  events: readonly SpecrunEvent[];
}

/** Live updates for UIs; nothing here is persisted — the event log is the record. */
export interface RunReporter {
  /** Once per run, after the worktree exists and before the first event. */
  plan(plan: RunPlan): void;
  phase(phase: RunPhase): void;
  event(event: SpecrunEvent): void;
  activity(update: ActivityUpdate): void;
  turn(update: TurnUpdate): void;
  waiting(update: WaitingUpdate): void;
  log(level: ReporterLevel, message: string): void;
}

export const nullReporter: RunReporter = {
  plan: () => undefined,
  phase: () => undefined,
  event: () => undefined,
  activity: () => undefined,
  turn: () => undefined,
  waiting: () => undefined,
  log: () => undefined,
};
