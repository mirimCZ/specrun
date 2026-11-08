import {
  query as sdkQuery,
  type Options,
  type Query,
  type SDKMessage,
  type SDKRateLimitInfo,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { systemClock, type Clock } from '../limits/clock.js';
import { fromRateLimitEvent, type UsageSnapshot } from '../limits/usage.js';
import type {
  AgentSession,
  CumulativeTotals,
  SegmentInput,
  SegmentOutcome,
  SegmentResult,
  SegmentStats,
  SessionObserver,
  TurnUsage,
} from './agentSession.js';
import { SPECRUN_SERVER, createSpecrunTools, type ToolCall } from './specrunTools.js';
import { createTranscriptWriter, type TranscriptWriter } from './transcript.js';

/** Built-in tools of a task session (SRD-23); the specrun tools are added to `allowedTools`. */
export const SESSION_TOOLS = ['Read', 'Edit', 'Write', 'Bash'] as const;

// Wording of Claude Code's limit errors ("Claude AI usage limit reached|<epoch>",
// "You've hit your limit · resets …"); only used when no rate_limit_event said `rejected`.
const LIMIT_TEXT = /usage limit|hit your limit|limit reached/i;
const LIMIT_EPOCH = /\|(\d{10})\b/;

export type SdkSessionDeps = {
  query?: typeof sdkQuery;
  createTools?: typeof createSpecrunTools;
  clock?: Clock;
};

const ZERO_TOTALS: CumulativeTotals = {
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 0,
};

function totalsOf(result: SDKResultMessage): CumulativeTotals {
  const totals = { ...ZERO_TOTALS, turns: result.num_turns, costUsd: result.total_cost_usd };
  for (const usage of Object.values(result.modelUsage)) {
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cacheRead += usage.cacheReadInputTokens;
    totals.cacheWrite += usage.cacheCreationInputTokens;
  }
  return totals;
}

function addTotals(a: CumulativeTotals, b: CumulativeTotals): CumulativeTotals {
  return {
    turns: a.turns + b.turns,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUsd: a.costUsd + b.costUsd,
  };
}

// Clamped: a session whose saved totals were lost would otherwise report negative usage.
function deltaTotals(current: CumulativeTotals, previous: CumulativeTotals): CumulativeTotals {
  const delta = (a: number, b: number): number => Math.max(0, a - b);
  return {
    turns: delta(current.turns, previous.turns),
    inputTokens: delta(current.inputTokens, previous.inputTokens),
    outputTokens: delta(current.outputTokens, previous.outputTokens),
    cacheRead: delta(current.cacheRead, previous.cacheRead),
    cacheWrite: delta(current.cacheWrite, previous.cacheWrite),
    costUsd: delta(current.costUsd, previous.costUsd),
  };
}

/** The exhausted window's reset (the later one if both are), else the event's own reset. */
function resetOf(info: SDKRateLimitInfo, snapshot: UsageSnapshot | null): Date | null {
  const windows = [snapshot?.session, snapshot?.weekly].filter((w) => w != null);
  const exhausted = windows
    .flatMap((w) => (w.leftPercent <= 0 && w.resetsAt ? [w.resetsAt] : []))
    .sort((a, b) => b.getTime() - a.getTime());
  if (exhausted[0]) return exhausted[0];
  if (typeof info.resetsAt === 'number') return new Date(info.resetsAt * 1000);
  return windows.find((w) => w.resetsAt !== null)?.resetsAt ?? null;
}

function resultErrorText(result: SDKResultMessage): string {
  if (result.subtype === 'success') return result.result;
  return result.errors.length > 0 ? result.errors.join('; ') : result.subtype;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Collects what one segment's message stream says; classification happens at the end. */
type SegmentState = {
  sessionId: string | null;
  result: SDKResultMessage | null;
  thrown: { error: unknown } | null;
  limitHit: boolean;
  lastReset: Date | null;
  peakContext: number;
  /** Last usage per main-agent API message id: the fallback when no `result` arrives. */
  turns: Map<string, TurnUsage>;
};

function classify(
  state: SegmentState,
  toolCall: ToolCall | null,
  aborted: boolean,
): { outcome: SegmentOutcome; error: string | null } {
  // The agent's own verdict counts even if the stream ended badly afterwards: its work is done.
  if (toolCall)
    return { outcome: toolCall.tool === 'complete_task' ? 'completed' : 'blocked', error: null };
  if (aborted) return { outcome: 'interrupted', error: null };
  const { result, thrown } = state;
  const text = thrown
    ? errorMessage(thrown.error)
    : result && (result.subtype !== 'success' || result.is_error)
      ? resultErrorText(result)
      : null;
  if (state.limitHit || (text !== null && LIMIT_TEXT.test(text))) {
    return { outcome: 'limit', error: null };
  }
  if (text !== null) {
    if (!thrown && result?.subtype === 'error_max_turns')
      return { outcome: 'max-turns', error: null };
    return { outcome: 'error', error: text };
  }
  if (!result) return { outcome: 'error', error: 'The session ended without a result.' };
  return { outcome: 'no-call', error: null };
}

/** The `AgentSession` backed by the Agent SDK's `query()` (SRD-3, SRD-23). */
export function createSdkSession(deps: SdkSessionDeps = {}): AgentSession {
  const query = deps.query ?? sdkQuery;
  const createTools = deps.createTools ?? createSpecrunTools;
  const clock = deps.clock ?? systemClock;

  async function run(input: SegmentInput, observer: SessionObserver): Promise<SegmentResult> {
    const started = clock.now().getTime();
    // Last call wins: the agent may correct itself after an earlier call.
    const recorded: { call: ToolCall | null } = { call: null };
    const tools = createTools((call) => (recorded.call = call));

    // The SDK takes a controller, the runner hands out a signal: link them.
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (input.signal.aborted) controller.abort();
    else input.signal.addEventListener('abort', onAbort, { once: true });

    const options: Options = {
      cwd: input.cwd,
      model: input.model,
      maxTurns: input.maxTurns,
      tools: [...SESSION_TOOLS],
      allowedTools: [...SESSION_TOOLS, ...tools.allowedTools],
      permissionMode: 'dontAsk',
      settingSources: ['project'],
      mcpServers: { [SPECRUN_SERVER]: tools.server },
      abortController: controller,
      ...(input.resumeSessionId === null ? {} : { resume: input.resumeSessionId }),
    };

    const state: SegmentState = {
      sessionId: input.resumeSessionId,
      result: null,
      thrown: null,
      limitHit: false,
      lastReset: null,
      peakContext: 0,
      turns: new Map(),
    };
    const sink: { transcript: TranscriptWriter | null } = { transcript: null };
    // Messages before the first one carrying a session id wait for the transcript path.
    const pending: SDKMessage[] = [];

    function record(message: SDKMessage): void {
      if (!sink.transcript && 'session_id' in message && typeof message.session_id === 'string') {
        state.sessionId ??= message.session_id;
        sink.transcript = createTranscriptWriter(input.transcriptFile(state.sessionId));
        for (const earlier of pending.splice(0)) sink.transcript.write(earlier);
      }
      if (sink.transcript) sink.transcript.write(message);
      else pending.push(message);
    }

    function handle(message: SDKMessage): void {
      record(message);
      observer.onMessage?.(message);
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') observer.onToolUse?.(block.name, block.input);
        }
        if (message.error === 'rate_limit') state.limitHit = true;
        // Subagent turns have their own context; the curve is the main agent's.
        if (message.parent_tool_use_id !== null) return;
        const u = message.message.usage;
        const input = u.input_tokens;
        const cacheRead = u.cache_read_input_tokens ?? 0;
        const cacheWrite = u.cache_creation_input_tokens ?? 0;
        const turn: TurnUsage = {
          input,
          cacheRead,
          cacheWrite,
          output: u.output_tokens,
          context: input + cacheRead + cacheWrite,
        };
        state.peakContext = Math.max(state.peakContext, turn.context);
        // Streamed blocks of one API turn share the message id: report the turn once.
        const isNew = !state.turns.has(message.message.id);
        state.turns.set(message.message.id, turn);
        if (isNew) observer.onTurn?.(turn);
      } else if (message.type === 'rate_limit_event') {
        const snapshot = fromRateLimitEvent(message.rate_limit_info, clock.now());
        if (snapshot) observer.onUsage?.(snapshot);
        state.lastReset = resetOf(message.rate_limit_info, snapshot) ?? state.lastReset;
        if (message.rate_limit_info.status === 'rejected') state.limitHit = true;
      } else if (message.type === 'result') {
        state.result = message;
      }
    }

    let q: Query | null = null;
    try {
      q = query({ prompt: input.prompt, options });
      for await (const message of q) handle(message);
    } catch (error) {
      state.thrown = { error };
    } finally {
      input.signal.removeEventListener('abort', onAbort);
      try {
        q?.close();
      } catch {
        // Already closed: nothing left to release.
      }
    }
    // A failed transcript costs analytics, not the task: the outcome stands.
    await sink.transcript?.close().catch(() => undefined);

    const { outcome, error } = classify(state, recorded.call, controller.signal.aborted);
    const previous = input.previous ?? ZERO_TOTALS;
    let delta: CumulativeTotals;
    let cumulative: CumulativeTotals;
    if (state.result) {
      cumulative = totalsOf(state.result);
      delta = deltaTotals(cumulative, previous);
    } else {
      // No totals from the SDK (crash, abort): count the turns seen, cost unknown.
      delta = { ...ZERO_TOTALS, turns: state.turns.size };
      for (const turn of state.turns.values()) {
        delta.inputTokens += turn.input;
        delta.outputTokens += turn.output;
        delta.cacheRead += turn.cacheRead;
        delta.cacheWrite += turn.cacheWrite;
      }
      cumulative = addTotals(previous, delta);
    }
    const stats: SegmentStats = {
      ...delta,
      peakContext: state.peakContext,
      durationMs: Math.max(0, clock.now().getTime() - started),
    };
    let limitResetsAt: Date | null = null;
    if (outcome === 'limit') {
      const text = state.thrown
        ? errorMessage(state.thrown.error)
        : state.result
          ? resultErrorText(state.result)
          : '';
      const epoch = LIMIT_EPOCH.exec(text)?.[1];
      limitResetsAt = state.lastReset ?? (epoch ? new Date(Number(epoch) * 1000) : null);
    }
    return {
      sessionId: state.sessionId,
      outcome,
      toolCall: recorded.call,
      limitResetsAt,
      error,
      stats,
      cumulative,
    };
  }

  return { run };
}
