import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeClock } from '../../test/fakes/fakeClock.js';
import { createFakeQuery, type FakeStep } from '../../test/fakes/fakeQuery.js';
import {
  SESSION_ID,
  assistantMessage,
  initMessage,
  rateLimitEvent,
  resultError,
  resultSuccess,
  toolResultMessage,
} from '../../test/fixtures/sdkMessages.js';
import type { UsageSnapshot } from '../limits/usage.js';
import type { SegmentInput, SessionObserver, TurnUsage } from './agentSession.js';
import { createSdkSession } from './sdkSession.js';
import { BLOCK_TASK_TOOL, COMPLETE_TASK_TOOL } from './specrunTools.js';
import { readTranscript } from './transcript.js';

const PAYLOAD = { summary: 'Did it', commitMessage: 'feat: x', notes: [], deviations: [] };

const completeCall = (id = 'msg_complete'): SDKMessage =>
  assistantMessage({ id, toolUses: [{ name: COMPLETE_TASK_TOOL, input: PAYLOAD }] });
const blockCall = (id = 'msg_block'): SDKMessage =>
  assistantMessage({
    id,
    toolUses: [
      { name: BLOCK_TASK_TOOL, input: { reason: 'impossible as written', kind: 'other' } },
    ],
  });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specrun-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function segmentInput(overrides: Partial<SegmentInput> = {}): SegmentInput {
  return {
    prompt: 'Implement SR-6',
    cwd: '/work/tree',
    model: 'sonnet',
    maxTurns: 80,
    resumeSessionId: null,
    previous: null,
    transcriptFile: (sessionId) => join(dir, 'repo', 'v1', 'SR-6', `${sessionId}-1.jsonl.gz`),
    signal: new AbortController().signal,
    env: null,
    ...overrides,
  };
}

async function runScript(
  steps: FakeStep[],
  overrides: Partial<SegmentInput> = {},
  observer: SessionObserver = {},
) {
  const fake = createFakeQuery([steps]);
  const clock = createFakeClock(new Date('2026-11-09T00:00:00Z'));
  const session = createSdkSession({ query: fake.query, createTools: fake.createTools, clock });
  const result = await session.run(segmentInput(overrides), observer);
  return { fake, result, clock };
}

describe('createSdkSession options', () => {
  it('passes tools, permissions, settings, model and turns to query()', async () => {
    const { fake } = await runScript([initMessage(), resultSuccess()]);
    const call = fake.calls[0];
    expect(call?.prompt).toBe('Implement SR-6');
    const options = call?.options;
    expect(options).toMatchObject({
      cwd: '/work/tree',
      model: 'sonnet',
      maxTurns: 80,
      tools: ['Read', 'Edit', 'Write', 'Bash'],
      allowedTools: ['Read', 'Edit', 'Write', 'Bash', COMPLETE_TASK_TOOL, BLOCK_TASK_TOOL],
      permissionMode: 'dontAsk',
      settingSources: ['project'],
    });
    expect(options?.mcpServers?.['specrun']).toBeDefined();
    expect(options && 'resume' in options).toBe(false);
    expect(options && 'env' in options).toBe(false);
    expect(fake.closed).toBe(1);
  });

  it('passes a copy of the given env to query()', async () => {
    const env = { LOREM: 'ipsum', CLAUDE_CODE_OAUTH_TOKEN: 'lorem-token', UNSET: undefined };
    const { fake } = await runScript([initMessage(), resultSuccess()], { env });
    expect(fake.calls[0]?.options.env).toEqual(env);
    expect(fake.calls[0]?.options.env).not.toBe(env);
  });

  it('resumes the given session', async () => {
    const { fake } = await runScript([initMessage(), resultSuccess()], {
      resumeSessionId: 'session-0',
    });
    expect(fake.calls[0]?.options.resume).toBe('session-0');
  });

  it('links the abort signal to the SDK abort controller', async () => {
    const abort = new AbortController();
    const { fake } = await runScript([initMessage(), resultSuccess()], { signal: abort.signal });
    const sdkSignal = fake.calls[0]?.options.abortController?.signal;
    expect(sdkSignal?.aborted).toBe(false);
    // Unlinked after the segment: a later abort must not reach a finished query.
    abort.abort();
    expect(sdkSignal?.aborted).toBe(false);
  });
});

describe('createSdkSession outcomes', () => {
  it('completed: complete_task was called', async () => {
    const { result } = await runScript([
      initMessage(),
      completeCall(),
      toolResultMessage(),
      resultSuccess(),
    ]);
    expect(result).toMatchObject({
      sessionId: SESSION_ID,
      outcome: 'completed',
      toolCall: { tool: 'complete_task', payload: PAYLOAD },
      error: null,
      limitResetsAt: null,
    });
  });

  it('blocked: the last specrun tool call wins', async () => {
    const { result } = await runScript([
      initMessage(),
      completeCall(),
      blockCall(),
      resultSuccess(),
    ]);
    expect(result.outcome).toBe('blocked');
    expect(result.toolCall).toEqual({
      tool: 'block_task',
      reason: 'impossible as written',
      kind: 'other',
    });
  });

  it('an invalid tool call records nothing', async () => {
    const { result } = await runScript([
      initMessage(),
      assistantMessage({ toolUses: [{ name: COMPLETE_TASK_TOOL, input: { summary: 1 } }] }),
      resultSuccess(),
    ]);
    expect(result.outcome).toBe('no-call');
    expect(result.toolCall).toBeNull();
  });

  it('no-call: success without a specrun tool call', async () => {
    const { result } = await runScript([
      initMessage(),
      assistantMessage({ text: 'hi' }),
      resultSuccess(),
    ]);
    expect(result).toMatchObject({ outcome: 'no-call', toolCall: null, error: null });
  });

  it('max-turns: result error_max_turns', async () => {
    const { result } = await runScript([
      initMessage(),
      resultError({ subtype: 'error_max_turns' }),
    ]);
    expect(result).toMatchObject({ outcome: 'max-turns', error: null });
  });

  it('limit: a rejected rate_limit_event, reset from the exhausted window', async () => {
    const { result } = await runScript([
      initMessage(),
      rateLimitEvent({
        status: 'rejected',
        fiveHour: { utilization: 1, resetsAt: 1_762_660_800 },
        sevenDay: { utilization: 0.5, resetsAt: 1_763_000_000 },
      }),
      resultSuccess({ isError: true, result: 'API Error' }),
    ]);
    expect(result.outcome).toBe('limit');
    expect(result.limitResetsAt).toEqual(new Date(1_762_660_800 * 1000));
  });

  it('limit: an assistant rate_limit error, reset from the latest event', async () => {
    const { result } = await runScript([
      initMessage(),
      rateLimitEvent({ status: 'allowed_warning', resetsAt: 1_762_660_800 }),
      assistantMessage({ error: 'rate_limit', text: 'limit' }),
      resultSuccess({ isError: true, result: 'Rate limited' }),
    ]);
    expect(result.outcome).toBe('limit');
    expect(result.limitResetsAt).toEqual(new Date(1_762_660_800 * 1000));
  });

  it('limit: a result error mentioning the usage limit, reset from its text', async () => {
    const { result } = await runScript([
      initMessage(),
      resultSuccess({ isError: true, result: 'Claude AI usage limit reached|1762660800' }),
    ]);
    expect(result).toMatchObject({ outcome: 'limit', error: null });
    expect(result.limitResetsAt).toEqual(new Date(1_762_660_800 * 1000));
  });

  it('limit without any reset information', async () => {
    const { result } = await runScript([
      initMessage(),
      resultError({ errors: ["You've hit your limit"] }),
    ]);
    expect(result.outcome).toBe('limit');
    expect(result.limitResetsAt).toBeNull();
  });

  it('interrupted: the signal aborts a running segment', async () => {
    const abort = new AbortController();
    const { result } = await runScript(
      [initMessage(), { control: 'wait-abort' }],
      { signal: abort.signal },
      { onMessage: () => abort.abort() },
    );
    expect(result).toMatchObject({ sessionId: SESSION_ID, outcome: 'interrupted', error: null });
  });

  it('interrupted: an already aborted signal', async () => {
    const abort = new AbortController();
    abort.abort();
    const { result, fake } = await runScript([{ control: 'wait-abort' }], { signal: abort.signal });
    expect(fake.calls[0]?.options.abortController?.signal.aborted).toBe(true);
    expect(result).toMatchObject({ sessionId: null, outcome: 'interrupted' });
  });

  it('error: a result error subtype', async () => {
    const { result } = await runScript([
      initMessage(),
      resultError({ subtype: 'error_during_execution', errors: ['boom', 'bang'] }),
    ]);
    expect(result).toMatchObject({ outcome: 'error', error: 'boom; bang' });
  });

  it('error: a thrown SDK error is caught', async () => {
    const { result, fake } = await runScript([
      initMessage(),
      { control: 'throw', error: new Error('Claude Code process exited with code 1') },
    ]);
    expect(result).toMatchObject({
      sessionId: SESSION_ID,
      outcome: 'error',
      error: 'Claude Code process exited with code 1',
    });
    expect(fake.closed).toBe(1);
  });

  it('error: query() itself throws', async () => {
    const clock = createFakeClock(new Date('2026-11-09T00:00:00Z'));
    const session = createSdkSession({
      query: () => {
        throw new Error('spawn claude ENOENT');
      },
      clock,
    });
    const result = await session.run(segmentInput(), {});
    expect(result).toMatchObject({
      sessionId: null,
      outcome: 'error',
      error: 'spawn claude ENOENT',
    });
    expect(result.stats.turns).toBe(0);
  });

  it('error: the stream ends without a result', async () => {
    const { result } = await runScript([initMessage()]);
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/without a result/);
  });
});

describe('createSdkSession stats', () => {
  const models = {
    'claude-sonnet-5-5': {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 20_000,
      cacheCreationInputTokens: 4000,
    },
    'claude-haiku-5-5': {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  };

  it('computes per-segment deltas from the previous cumulative totals', async () => {
    const previous = {
      turns: 4,
      inputTokens: 600,
      outputTokens: 300,
      cacheRead: 15_000,
      cacheWrite: 4000,
      costUsd: 0.25,
    };
    const { result } = await runScript(
      [initMessage(), resultSuccess({ turns: 10, costUsd: 0.75, models })],
      { previous, resumeSessionId: SESSION_ID },
    );
    expect(result.cumulative).toEqual({
      turns: 10,
      inputTokens: 1100,
      outputTokens: 550,
      cacheRead: 20_000,
      cacheWrite: 4000,
      costUsd: 0.75,
    });
    expect(result.stats).toMatchObject({
      turns: 6,
      inputTokens: 500,
      outputTokens: 250,
      cacheRead: 5000,
      cacheWrite: 0,
      costUsd: 0.5,
    });
  });

  it('a first segment reports the totals themselves', async () => {
    const { result } = await runScript([
      initMessage(),
      resultSuccess({ turns: 3, costUsd: 0.1, models }),
    ]);
    expect(result.stats).toMatchObject({ turns: 3, inputTokens: 1100, costUsd: 0.1 });
  });

  it('peak context is the largest main-agent turn, duration from the clock', async () => {
    const clock = createFakeClock(new Date('2026-11-09T00:00:00Z'));
    const fake = createFakeQuery([
      [
        initMessage(),
        assistantMessage({ id: 'a', usage: { input: 10, cacheRead: 1000, cacheWrite: 200 } }),
        assistantMessage({ id: 'b', usage: { input: 5, cacheRead: 3000, cacheWrite: 100 } }),
        // A subagent's context is not the session's.
        assistantMessage({ id: 'c', usage: { input: 90_000 }, parentToolUseId: 'toolu_9' }),
        resultSuccess(),
      ],
    ]);
    const session = createSdkSession({ query: fake.query, createTools: fake.createTools, clock });
    const result = await session.run(segmentInput(), { onMessage: () => clock.advance(250) });
    expect(result.stats.peakContext).toBe(3105);
    expect(result.stats.durationMs).toBe(1250);
  });

  it('without a result, counts the turns seen on top of previous', async () => {
    const previous = {
      turns: 2,
      inputTokens: 10,
      outputTokens: 10,
      cacheRead: 10,
      cacheWrite: 10,
      costUsd: 0.5,
    };
    const { result } = await runScript(
      [
        initMessage(),
        assistantMessage({
          id: 'a',
          usage: { input: 1, cacheRead: 100, cacheWrite: 10, output: 0 },
        }),
        // The same API turn streamed in a second block, with its final output count.
        assistantMessage({
          id: 'a',
          usage: { input: 1, cacheRead: 100, cacheWrite: 10, output: 7 },
        }),
        { control: 'throw', error: new Error('crashed') },
      ],
      { previous },
    );
    expect(result.stats).toMatchObject({
      turns: 1,
      inputTokens: 1,
      outputTokens: 7,
      cacheRead: 100,
      cacheWrite: 10,
      costUsd: 0,
    });
    expect(result.cumulative).toEqual({
      turns: 3,
      inputTokens: 11,
      outputTokens: 17,
      cacheRead: 110,
      cacheWrite: 20,
      costUsd: 0.5,
    });
  });
});

describe('createSdkSession transcript and observer', () => {
  it('writes every message to the transcript named by the session id', async () => {
    const steps = [initMessage(), completeCall(), toolResultMessage(), resultSuccess()];
    const files: string[] = [];
    const { result } = await runScript(steps, {
      transcriptFile: (sessionId) => {
        const file = join(dir, 'repo', 'v1', 'SR-6', `${sessionId}-2.jsonl.gz`);
        files.push(file);
        return file;
      },
    });
    expect(result.outcome).toBe('completed');
    expect(files).toEqual([join(dir, 'repo', 'v1', 'SR-6', `${SESSION_ID}-2.jsonl.gz`)]);
    expect(readTranscript(files[0] ?? '')).toEqual(steps);
  });

  it('fires observer callbacks', async () => {
    const messages: SDKMessage[] = [];
    const toolUses: [string, unknown][] = [];
    const snapshots: UsageSnapshot[] = [];
    const turns: TurnUsage[] = [];
    const steps = [
      initMessage(),
      rateLimitEvent({ fiveHour: { utilization: 0.4, resetsAt: 1_762_660_800 } }),
      assistantMessage({
        id: 'a',
        usage: { input: 3, cacheRead: 100, cacheWrite: 20, output: 1 },
        toolUses: [{ name: 'Read', input: { file_path: 'a.ts' } }],
      }),
      assistantMessage({ id: 'a', usage: { input: 3, cacheRead: 100, cacheWrite: 20, output: 9 } }),
      toolResultMessage(),
      completeCall(),
      resultSuccess(),
    ];
    await runScript(
      steps,
      {},
      {
        onMessage: (m) => messages.push(m),
        onToolUse: (name, input) => toolUses.push([name, input]),
        onUsage: (s) => snapshots.push(s),
        onTurn: (t) => turns.push(t),
      },
    );
    expect(messages).toEqual(steps);
    expect(toolUses).toEqual([
      ['Read', { file_path: 'a.ts' }],
      [COMPLETE_TASK_TOOL, PAYLOAD],
    ]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.session?.leftPercent).toBeCloseTo(60);
    expect(turns).toEqual([
      { input: 3, cacheRead: 100, cacheWrite: 20, output: 1, context: 123 },
      { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, context: 0 },
    ]);
  });
});
