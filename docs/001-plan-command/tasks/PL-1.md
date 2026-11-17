# PL-1 — plan.session event and Claude Code transcript metrics

Phase 1 · Needs: — · Implements: PLD-6, PLD-7

Adds the `plan.session` event to the run log and a reader that turns an interactive Claude Code
transcript into token metrics. The `specrun plan` command (PL-2) and the history / stats totals
(PL-3) build on both.

## Decisions

- **PLD-6** — `{ t: 'plan.session', sessionId: string, resumed: boolean, exitCode: int, metrics: PlanMetrics | null }` with `PlanMetrics = { turns, inputTokens, outputTokens, cacheRead, cacheWrite, peakContext, models: string[], subagents: { files, turns, inputTokens, outputTokens, cacheRead, cacheWrite } }` (all ints ≥ 0). Tokens only, no USD. `deriveState` ignores the event.
- **PLD-7** — Main file: first match of `<configDir>/projects/*/<sessionId>.jsonl`, `configDir` = `env.CLAUDE_CONFIG_DIR` or `~/.claude`. Subagent files: every `*.jsonl` in `<that dir>/<sessionId>/subagents/` if it exists. Unparseable lines are skipped. A turn is one distinct `message.id` of an `assistant` line with `message.usage` (the last line of an id wins). Main-file lines with `isSidechain: true` and all subagent-file turns count into `subagents`; the rest into the top-level fields. Turn context = input + cacheRead + cacheWrite; `peakContext` = max over main turns; `models` = distinct `message.model` of main turns, in first-seen order.
- Transcript format (README §2): plain JSONL, one object per line with `type`; `assistant` lines carry `message.id`, `message.model`, `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`. One API message can span several lines with the same `message.id`. These are not SDK transcripts — don't reuse `readTranscript` / `analyzeSession`.

## Read first

- `src/events/eventSchema.ts` — `DeviationsReviewedSchema`, `AnalyticsSessionSchema`, `EventSchema` union: where and how to add the event
- `src/events/taskState.ts` — `deriveState` switch, `default` branch (lines 90–155)
- `src/events/taskState.spec.ts` — pattern for a reducer test with a foreign event
- `src/events/eventStore.spec.ts` — pattern for an append / read round trip
- `src/session/transcript.ts` — `readTranscript`: tolerant line parsing to mirror (not reuse)
- `docs/testing.md` — temp dir rules

## Changes

- `src/events/eventSchema.ts`: `PlanMetricsSchema` (exported, ints via the existing `Count`), `PlanSessionSchema` (`t: 'plan.session'`), added to `EventSchema`; export `type PlanMetrics`.
- `src/events/taskState.ts`: only if needed so `plan.session` leaves task state untouched.
- New `src/plan/claudeTranscript.ts`:
  - `findClaudeTranscript(sessionId: string, configDir: string): string | null` (glob over `projects/*`, `readdirSync`, no new dependency),
  - `claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string`,
  - `readPlanMetrics(file: string): PlanMetrics` (main file plus the subagents folder, PLD-7).
- New `src/plan/claudeTranscript.spec.ts`; fixtures written into the temp dir by small helpers in the spec (never real transcripts).
- `CLAUDE.md` layout: add `plan/        interactive planning sessions (specrun plan), Claude Code transcripts`.

## Done when

- Tests in `claudeTranscript.spec.ts` assert:
  - two lines with the same `message.id` count as one turn and the last line's usage wins,
  - `isSidechain` lines and `subagents/*.jsonl` count into `subagents` (with `files`), not top-level,
  - `peakContext` = max of input + cacheRead + cacheWrite over main turns,
  - `models` is distinct and in first-seen order,
  - garbage lines and non-assistant lines are skipped,
  - `findClaudeTranscript` finds the file in any project folder and returns `null` when it's missing,
  - `claudeConfigDir` prefers `CLAUDE_CONFIG_DIR`.
- An event store round trip accepts a `plan.session` event with `metrics: null` and with metrics; `deriveState` with a `plan.session` event yields the same task state as without it.
- Existing event store and task state tests unchanged and green.
