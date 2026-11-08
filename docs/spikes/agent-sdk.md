# Spike: Claude Agent SDK

2026-11-08 · `@anthropic-ai/claude-agent-sdk` 0.3.319, Claude Code 2.1.311 · script
[`spikes/sdk-spike.ts`](../../spikes/sdk-spike.ts) (`npm run spike`, raw messages in `spikes/out/`).

Question: can specrun run task sessions through the Agent SDK instead of piping `claude -p`
stream-json? **Yes — every requirement passed.**

| Requirement                   | Result                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscription auth, no API key | ✅ `ANTHROPIC_API_KEY` unset → `system:init` reports `apiKeySource: "none"`, the usage probe `subscription_type: "pro"`. The SDK uses the logged-in Claude Code credentials.                                                                                           |
| Custom in-process tool        | ✅ `createSdkMcpServer` + `tool(name, description, zodShape, handler)`. Exposed as `mcp__<server>__<tool>`; the handler gets the parsed, typed payload (nested arrays/objects/enums worked first time).                                                                |
| Rate limit info               | ✅ `rate_limit_event` messages carry `rate_limit_info.unifiedWindows.{five_hour,seven_day}` (`utilization` 0–1, `resetsAt` epoch s, `status`) — the same data `tools/spec-run.sh` parses today.                                                                        |
| Usage probe without a request | ✅ `query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })` right after `system:init` returns `rate_limits.five_hour/seven_day` (`utilization` 0–100, ISO `resets_at`) at $0 — replaces the haiku probe call. Experimental: wrap it. |
| Per-turn usage                | ✅ every `assistant` message has `message.usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`) → context curve per turn.                                                                                                 |
| Totals                        | ✅ `result` has `num_turns`, `total_cost_usd`, `modelUsage[model]` (tokens incl. `thinkingTokens`, `costUSD`, `contextWindow`, 5m/1h cache-write split).                                                                                                               |
| Resume                        | ✅ `query({ options: { resume: sessionId } })` keeps the session id and its context (answered from the first run's tool call); cache read 8.2k of 8.8k on resume.                                                                                                      |
| Tool restriction              | ✅ `tools: ['Read','Write','Bash']` + `allowedTools` + `permissionMode: 'dontAsk'` + `settingSources: []` → init lists exactly those tools plus the MCP tool.                                                                                                          |

## Consequences for the design

- **Schemas: zod v4, not typebox.** `tool()` takes a zod raw shape (zod is a peer dependency of
  the SDK). specrun uses zod for every schema (spec.json, events, config, tools) — one library.
- **Costs are cumulative across a resumed session.** `total_cost_usd` and `modelUsage` on a
  resumed query include the earlier turns (run 2 reported $0.00233 vs $0.00213 after run 1).
  Per-session-segment cost = difference to the previous result of the same session.
- **Cache writes are 1h (`cacheCreationEphemeral1hInputTokens`).** A resume within an hour reads
  the cache; after a 5h limit wait the context is written again — measure it, don't assume.
- **Project settings are opt-in.** `settingSources: []` loads no CLAUDE.md; task sessions will
  pass `['project']` so the project's CLAUDE.md applies (and nothing from user settings).
- Usage windows come from two sources with different scales (`rate_limit_event` 0–1 epoch,
  usage probe 0–100 ISO) — normalize in one module.

## Not verified yet (cover in the runner's tests / first real runs)

- What a session does when the 5h limit is hit mid-turn (`status: "rejected"` event, result
  subtype, whether `resume` continues cleanly after the reset).
- `dontAsk` denying a tool outside `allowedTools` (expected: `permission_denials` on the result).
- Aborting a session (`abortController` option) and resuming it afterwards.
