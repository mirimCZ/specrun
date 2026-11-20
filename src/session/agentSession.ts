import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UsageSnapshot } from '../limits/usage.js';
import type { ToolCall } from './specrunTools.js';

/** Running totals of a (possibly resumed) session as the SDK reports them on `result`. */
export type CumulativeTotals = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
};

/** The numeric fields of `session.finished`, for one segment only. */
export type SegmentStats = CumulativeTotals & {
  peakContext: number;
  durationMs: number;
};

/** Usage of one main-agent API turn (from the first `assistant` message of that turn). */
export type TurnUsage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** input + cache read + cache write: the size of the context sent with this turn. */
  context: number;
};

export type SegmentOutcome =
  'completed' | 'blocked' | 'no-call' | 'limit' | 'max-turns' | 'interrupted' | 'error';

export type SegmentInput = {
  prompt: string;
  cwd: string;
  model: string;
  maxTurns: number;
  resumeSessionId: string | null;
  /** Cumulative totals after the previous segment of the same session; null for a new one. */
  previous: CumulativeTotals | null;
  /** Transcript path for this segment; called once the session id is known. */
  transcriptFile: (sessionId: string) => string;
  signal: AbortSignal;
  /** Complete child env for the SDK process (never merged here); null inherits `process.env`. */
  env: Readonly<Record<string, string | undefined>> | null;
};

export type SessionObserver = {
  onMessage?(message: SDKMessage): void;
  onToolUse?(name: string, input: unknown): void;
  onUsage?(snapshot: UsageSnapshot): void;
  onTurn?(turn: TurnUsage): void;
};

export type SegmentResult = {
  /** null when the SDK failed before reporting a session id. */
  sessionId: string | null;
  outcome: SegmentOutcome;
  toolCall: ToolCall | null;
  limitResetsAt: Date | null;
  error: string | null;
  stats: SegmentStats;
  cumulative: CumulativeTotals;
};

/** One segment = one `query()` call, new or resumed. Never rejects: failures are outcomes. */
export type AgentSession = {
  run(input: SegmentInput, observer: SessionObserver): Promise<SegmentResult>;
};
