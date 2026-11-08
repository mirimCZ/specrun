import type {
  ModelUsage,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKMessage,
  SDKRateLimitEvent,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

// Minimal SDK messages: only the fields specrun reads, cast where the SDK type requires more.

export const SESSION_ID = 'session-1';

let counter = 0;
function uuid(): `${string}-${string}-${string}-${string}-${string}` {
  counter += 1;
  return `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`;
}

export function initMessage(
  opts: { sessionId?: string; model?: string; tools?: string[] } = {},
): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'none',
    claude_code_version: '2.1.311',
    cwd: '/work',
    tools: opts.tools ?? ['Read', 'Edit', 'Write', 'Bash'],
    mcp_servers: [{ name: 'specrun', status: 'connected' }],
    model: opts.model ?? 'claude-sonnet-5-5',
    permissionMode: 'dontAsk',
    uuid: uuid(),
    session_id: opts.sessionId ?? SESSION_ID,
  } as unknown as SDKSystemMessage;
}

export type TurnUsageInput = {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
};

export type ToolUseInput = { name: string; input: unknown; id?: string };

export function assistantMessage(
  opts: {
    sessionId?: string;
    /** API message id; streamed blocks of one turn share it. */
    id?: string;
    usage?: TurnUsageInput;
    text?: string;
    toolUses?: ToolUseInput[];
    error?: SDKAssistantMessageError;
    parentToolUseId?: string | null;
  } = {},
): SDKMessage {
  const usage = opts.usage ?? {};
  const content = [
    ...(opts.text === undefined ? [] : [{ type: 'text', text: opts.text }]),
    ...(opts.toolUses ?? []).map((t, i) => ({
      type: 'tool_use',
      id: t.id ?? `toolu_${i}`,
      name: t.name,
      input: t.input,
    })),
  ];
  return {
    type: 'assistant',
    message: {
      id: opts.id ?? `msg_${uuid()}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content,
      stop_reason: null,
      usage: {
        input_tokens: usage.input ?? 0,
        cache_read_input_tokens: usage.cacheRead ?? 0,
        cache_creation_input_tokens: usage.cacheWrite ?? 0,
        output_tokens: usage.output ?? 0,
      },
    },
    parent_tool_use_id: opts.parentToolUseId ?? null,
    ...(opts.error === undefined ? {} : { error: opts.error }),
    uuid: uuid(),
    session_id: opts.sessionId ?? SESSION_ID,
  } as unknown as SDKAssistantMessage;
}

export function toolResultMessage(
  opts: { toolUseId?: string; text?: string; isError?: boolean; sessionId?: string } = {},
): SDKMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: opts.toolUseId ?? 'toolu_0',
          content: opts.text ?? 'ok',
          ...(opts.isError === undefined ? {} : { is_error: opts.isError }),
        },
      ],
    },
    parent_tool_use_id: null,
    uuid: uuid(),
    session_id: opts.sessionId ?? SESSION_ID,
  } as unknown as SDKUserMessage;
}

export type EventWindowInput = { utilization: number; resetsAt: number };

/** `utilization` 0–1 and `resetsAt` epoch seconds, as the SDK reports them. */
export function rateLimitEvent(
  opts: {
    status?: 'allowed' | 'allowed_warning' | 'rejected';
    resetsAt?: number;
    fiveHour?: EventWindowInput;
    sevenDay?: EventWindowInput;
    sessionId?: string;
  } = {},
): SDKMessage {
  return {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: opts.status ?? 'allowed',
      ...(opts.resetsAt === undefined ? {} : { resetsAt: opts.resetsAt }),
      unifiedWindows: {
        ...(opts.fiveHour === undefined ? {} : { five_hour: opts.fiveHour }),
        ...(opts.sevenDay === undefined ? {} : { seven_day: opts.sevenDay }),
      },
    },
    uuid: uuid(),
    session_id: opts.sessionId ?? SESSION_ID,
  } as unknown as SDKRateLimitEvent;
}

export type TotalsInput = {
  turns?: number;
  costUsd?: number;
  /** Per model; defaults to one model with zero tokens. */
  models?: Record<string, Partial<ModelUsage>>;
};

function modelUsage(models: TotalsInput['models']): Record<string, ModelUsage> {
  const entries = Object.entries(models ?? { 'claude-sonnet-5-5': {} });
  return Object.fromEntries(
    entries.map(([model, u]) => [
      model,
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0,
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
        ...u,
      },
    ]),
  );
}

export function resultSuccess(
  opts: TotalsInput & { result?: string; isError?: boolean; sessionId?: string } = {},
): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1000,
    duration_api_ms: 900,
    is_error: opts.isError ?? false,
    num_turns: opts.turns ?? 1,
    result: opts.result ?? 'Done.',
    stop_reason: 'end_turn',
    total_cost_usd: opts.costUsd ?? 0,
    usage: {},
    modelUsage: modelUsage(opts.models),
    permission_denials: [],
    uuid: uuid(),
    session_id: opts.sessionId ?? SESSION_ID,
  } as unknown as SDKResultMessage;
}

export function resultError(
  opts: TotalsInput & {
    subtype?:
      | 'error_during_execution'
      | 'error_max_turns'
      | 'error_max_budget_usd'
      | 'error_max_structured_output_retries';
    errors?: string[];
    sessionId?: string;
  } = {},
): SDKMessage {
  return {
    type: 'result',
    subtype: opts.subtype ?? 'error_during_execution',
    duration_ms: 1000,
    duration_api_ms: 900,
    is_error: true,
    num_turns: opts.turns ?? 1,
    stop_reason: null,
    total_cost_usd: opts.costUsd ?? 0,
    usage: {},
    modelUsage: modelUsage(opts.models),
    permission_denials: [],
    errors: opts.errors ?? [],
    uuid: uuid(),
    session_id: opts.sessionId ?? SESSION_ID,
  } as unknown as SDKResultMessage;
}
