import type { SpecrunEvent } from '../events/eventSchema.js';

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

/** Live updates for UIs; nothing here is persisted — the event log is the record. */
export interface RunReporter {
  event(event: SpecrunEvent): void;
  activity(update: ActivityUpdate): void;
  turn(update: TurnUpdate): void;
  waiting(update: WaitingUpdate): void;
  log(level: ReporterLevel, message: string): void;
}

export const nullReporter: RunReporter = {
  event: () => undefined,
  activity: () => undefined,
  turn: () => undefined,
  waiting: () => undefined,
  log: () => undefined,
};
