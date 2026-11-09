import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CompleteTaskPayload } from '../../src/events/eventSchema.js';
import type { UsageSnapshot } from '../../src/limits/usage.js';
import type {
  AgentSession,
  CumulativeTotals,
  SegmentInput,
  SegmentOutcome,
  SegmentStats,
} from '../../src/session/agentSession.js';
import type { ToolCall } from '../../src/session/specrunTools.js';

/** What one `run()` call does, in script order. */
export type FakeSegment = {
  /** Default `completed`. */
  outcome?: SegmentOutcome;
  /** Default: `complete_task` with `payload` for `completed`, a `block_task` for `blocked`, else none. */
  toolCall?: ToolCall | null;
  payload?: Partial<CompleteTaskPayload>;
  /** Default: the resumed id, else `session-<n>` (n counts new sessions from 1). */
  sessionId?: string | null;
  stats?: Partial<SegmentStats>;
  /** Files written relative to the worktree, simulating the agent's edits. */
  edits?: Record<string, string>;
  /** `git add -A && git commit -m <message>` in the worktree: an agent breaking the protocol. */
  commit?: string;
  /** Reported through `onUsage`, as a `rate_limit_event` would be. */
  usage?: UsageSnapshot;
  /** Each reported through `onToolUse` and `onTurn`. */
  tools?: { name: string; input: unknown }[];
  limitResetsAt?: Date | null;
  error?: string | null;
};

export type FakeSession = AgentSession & {
  /** Inputs of every `run()` call, in order. */
  inputs: SegmentInput[];
};

export const DEFAULT_PAYLOAD: CompleteTaskPayload = {
  summary: 'Implemented the task.',
  commitMessage: 'feat: implement',
  notes: [],
  deviations: [],
};

const DEFAULT_STATS: SegmentStats = {
  turns: 5,
  inputTokens: 1000,
  outputTokens: 500,
  cacheRead: 20_000,
  cacheWrite: 4000,
  costUsd: 0.1,
  peakContext: 25_000,
  durationMs: 60_000,
};

function defaultToolCall(step: FakeSegment): ToolCall | null {
  const outcome = step.outcome ?? 'completed';
  if (outcome === 'completed') {
    return { tool: 'complete_task', payload: { ...DEFAULT_PAYLOAD, ...step.payload } };
  }
  if (outcome === 'blocked') return { tool: 'block_task', reason: 'cannot do it', kind: 'other' };
  return null;
}

function add(previous: CumulativeTotals | null, stats: SegmentStats): CumulativeTotals {
  const p = previous ?? {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: 0,
  };
  return {
    turns: p.turns + stats.turns,
    inputTokens: p.inputTokens + stats.inputTokens,
    outputTokens: p.outputTokens + stats.outputTokens,
    cacheRead: p.cacheRead + stats.cacheRead,
    cacheWrite: p.cacheWrite + stats.cacheWrite,
    costUsd: p.costUsd + stats.costUsd,
  };
}

/**
 * Plays `script[i]` for the i-th `run()` call; calls beyond the script end with outcome `error`.
 * `gitEnv` is used for the simulated agent commit (identity without the user's config).
 */
export function createFakeSession(
  script: FakeSegment[],
  opts: { gitEnv?: NodeJS.ProcessEnv } = {},
): FakeSession {
  let sessions = 0;
  const inputs: SegmentInput[] = [];
  return {
    inputs,
    async run(input, observer) {
      const step = script[inputs.length];
      inputs.push(input);
      if (step === undefined) {
        return {
          sessionId: input.resumeSessionId,
          outcome: 'error',
          toolCall: null,
          limitResetsAt: null,
          error: 'fake session: no scripted segment left',
          stats: { ...DEFAULT_STATS, turns: 0, costUsd: 0 },
          cumulative: add(input.previous, { ...DEFAULT_STATS, turns: 0, costUsd: 0 }),
        };
      }
      for (const [path, content] of Object.entries(step.edits ?? {})) {
        const file = join(input.cwd, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
      if (step.commit !== undefined) {
        const env = opts.gitEnv ?? process.env;
        execFileSync('git', ['add', '-A'], { cwd: input.cwd, env });
        execFileSync('git', ['commit', '-q', '-m', step.commit], { cwd: input.cwd, env });
      }
      for (const use of step.tools ?? []) {
        observer.onToolUse?.(use.name, use.input);
        observer.onTurn?.({ input: 10, cacheRead: 0, cacheWrite: 0, output: 5, context: 10 });
      }
      if (step.usage !== undefined) observer.onUsage?.(step.usage);
      const sessionId =
        step.sessionId !== undefined
          ? step.sessionId
          : (input.resumeSessionId ?? `session-${(sessions += 1)}`);
      const stats = { ...DEFAULT_STATS, ...step.stats };
      return {
        sessionId,
        outcome: step.outcome ?? 'completed',
        toolCall: step.toolCall !== undefined ? step.toolCall : defaultToolCall(step),
        limitResetsAt: step.limitResetsAt ?? null,
        error: step.error ?? null,
        stats,
        cumulative: add(input.previous, stats),
      };
    },
  };
}
