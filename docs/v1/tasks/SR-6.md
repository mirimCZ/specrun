# SR-6 — Agent session (SDK) and transcripts

Phase 1 · Needs: SR-4, SR-5 · Implements: SRD-3, SRD-14 (writing), SRD-23, SRD-10 (detection)

The only module that talks to the Agent SDK: one session segment = one `query()` call (new or
resumed), streamed to a gzip transcript and to observers, classified into an outcome with
per-segment stats. Everything above it uses the `AgentSession` interface and a fake.

## Decisions

- **SRD-3** — sessions run through `@anthropic-ai/claude-agent-sdk` `query()` with the user's
  subscription; the SDK sits behind `AgentSession`.
- **SRD-23** — tools `Read`, `Edit`, `Write`, `Bash` plus the specrun tools;
  `permissionMode: 'dontAsk'` with exactly those in `allowedTools`;
  `settingSources: ['project']`; `cwd` = worktree; model alias per task.
- **SRD-14** — every SDK message of every segment written gzip-compressed to
  `<transcriptsDir>/<repo>/<spec>/<task>/<sessionId>-<segment>.jsonl.gz`.
- **SRD-10** (detection) — a limit hit inside a session must surface as outcome `limit` with the
  reset time, so the runner can wait and resume the same session.
- Spike facts: `result` totals (`total_cost_usd`, `modelUsage`, `num_turns`) are **cumulative**
  over a resumed session → per-segment deltas = this result minus the previous segment's
  cumulative values (the runner passes them in). Per-turn usage is on `assistant` messages.

## Read first

- `CLAUDE.md`, `docs/testing.md` (SDK fixtures, fakes).
- `docs/spikes/agent-sdk.md` + `spikes/sdk-spike.ts` — working `query()` options, message loop,
  usage probe call.
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `Options` (`resume`, `maxTurns`,
  `abortController`, `settingSources`), `SDKMessage`, `SDKResultMessage` subtypes
  (`grep -n "subtype: 'error_" `), `SDKAssistantMessageError` (`'rate_limit'`), `Query`
  (`interrupt`, `close`).
- SR-4 notes below — `fromRateLimitEvent`, `fromUsageProbe`, `UsageSnapshot`.
- SR-5 notes below — `createSpecrunTools`, `ToolCall`.

## Changes

- New `src/session/agentSession.ts`: interface
  `AgentSession = { run(input: SegmentInput, observer: SessionObserver): Promise<SegmentResult> }`;
  `SegmentInput = { prompt, cwd, model, maxTurns, resumeSessionId: string | null, previous:
CumulativeTotals | null, transcriptFile: (sessionId) => string, signal }`;
  `SessionObserver = { onMessage?(m: SDKMessage), onToolUse?(name, input), onUsage?(snapshot),
onTurn?(turnUsage) }`; `SegmentResult = { sessionId, outcome: 'completed' | 'blocked' |
'no-call' | 'limit' | 'max-turns' | 'interrupted' | 'error', toolCall: ToolCall | null,
limitResetsAt: Date | null, error: string | null, stats: SegmentStats, cumulative:
CumulativeTotals }`. `SegmentStats` matches SR-2's `session.finished` numeric fields.
- New `src/session/sdkSession.ts`: `createSdkSession({ query = sdk.query })` implementing it.
  Outcome rules: last specrun tool call wins (`completed` / `blocked`); `result` subtype
  `error_max_turns` → `max-turns`; a `rate_limit_event` with status `rejected`, or an assistant
  message with `error: 'rate_limit'`, or a result error mentioning the usage limit → `limit`
  (reset from the event); abort → `interrupted`; other errors → `error`; success without a
  tool call → `no-call`. Peak context = max over assistant turns of input + cache read + cache
  write. Thrown SDK errors are caught and classified, never escape.
- New `src/session/transcript.ts`: `createTranscriptWriter(file)` (mkdir -p, `zlib.createGzip`
  with `Z_SYNC_FLUSH` per message so a crash leaves a readable prefix) and
  `readTranscript(file)` → `SDKMessage[]` (tolerates a truncated stream).
- New `src/session/probeUsage.ts`: `probeUsage({ query, cwd })` → `UsageSnapshot | null` — a
  `query()` with an async-iterable prompt that yields nothing, call the usage probe after
  `system:init`, then `close()`; time out after 15 s → null. If you verify manually that the
  SDK needs a real message first, fall back to a one-turn `haiku` request "Reply with OK." with
  `tools: []` and read its `rate_limit_event` (you may run such a probe **once** by hand to
  check; never in tests).
- New `test/fakes/fakeQuery.ts` (scripted message sequences, records options) and
  `test/fixtures/sdkMessages.ts` (builders: init, assistant with usage + tool_use, user
  tool_result, rate_limit_event, result success/error) — later tasks reuse both.

## Done when

- `sdkSession.spec.ts` with the fake query: options passed (tools, allowedTools, permission
  mode, settingSources, resume, model, maxTurns, abort signal), every outcome rule, deltas
  computed from `previous`, transcript file written, observer callbacks fired, thrown error →
  `error` outcome.
- `transcript.spec.ts`: round trip; truncated gzip still yields the complete lines.
- `probeUsage.spec.ts` with the fake: snapshot from the probe; timeout → null.
- `tools/spec-verify.sh` green. No test touches the real SDK.

## Implementation notes

<!-- Filled in by the implementing agent: files, exported names, deviations. -->
