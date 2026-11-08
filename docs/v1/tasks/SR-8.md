# SR-8 — Session analytics

Phase 1 · Needs: SR-2, SR-6, SR-7 · Implements: SRD-13, SRD-14 (reindex logic)

Turns a session segment's transcript into the metrics that show where tokens go — the main
input for saving tokens and for the feedback skill — and stores them as `analytics.session`.

## Decisions

- **SRD-13** — per session segment an `analytics.session` event: context curve per turn, tool
  and file costs (result sizes, re-reads, most expensive Bash commands), brief adherence (Read
  first files read / unread, extra files read, files changed) and phases (orient · implement ·
  test · fix: turns and tokens). The phase split is a heuristic and labelled as an estimate.
- **SRD-14** — `analyze --reindex` recomputes analytics from the transcripts and appends new
  `analytics.session` events with a higher `analyzerVersion`; readers take the latest per
  segment.
- Context is paid again on every turn, so "tokens of a turn" = input + cache read + cache
  write + output of that assistant message; a tool result's cost is approximated by its size
  (chars / 4 ≈ tokens) and by the context growth it causes in the next turn.

## Read first

- `CLAUDE.md`, `docs/testing.md`.
- SR-6 notes below — `readTranscript`, `test/fixtures/sdkMessages.ts` builders, transcript path.
- SR-2 notes below — `analytics.session` schema (`metrics: unknown`), `SpecrunEvent`.
- SR-7 notes below — where `runSpec` appends `session.finished`, `RunReporter.log`,
  `test/fakes/fakeSession.ts`.
- `docs/v1/tasks/SR-3.md` "Read first" section — an example of the brief format to parse
  (bullets starting with a backticked path, optionally several paths joined by `+`).
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `SDKAssistantMessage`,
  `SDKUserMessage` (tool_result content), built-in tool input shapes in `sdk-tools.d.ts`
  (`FileReadInput`, `BashInput`, `FileEditInput`, `FileWriteInput`).

## Changes

- New `src/analytics/metricsSchema.ts`: `SessionMetricsSchema` (zod) + type, and
  `ANALYZER_VERSION = 1`. Shape: `turns: { n, context, cacheRead, cacheWrite, output,
tools: string[] }[]`, `peakContext`, `tools: { name, calls, resultChars }[]`,
  `files: { path, reads, edits, resultChars }[]` (top 30 by resultChars), `rereads` (reads of a
  file already read in the segment), `bash: { command, calls, outputChars }[]` (top 10,
  command truncated to 120 chars), `brief: { readFirst: string[], read: string[], unread:
string[], extraReads: string[] } | null`, `phases: { orient, implement, test, fix }` each
  `{ turns, tokens }`, `estimate: true`.
- New `src/analytics/analyzeSession.ts`: `analyzeSession(messages, { readFirst, testPatterns,
fixFromTurn })` → `SessionMetrics` (pure). Pair tool_use with its tool_result by id. Paths
  normalized relative to the worktree (strip the `cwd` from `system:init`). Phases per turn:
  before the first Edit/Write → orient; turns whose only tools are Bash commands matching
  `testPatterns` (defaults: `vitest`, `npm test`, `npm run test`, `spec-verify`, `tsc`,
  `typecheck`) → test; from `fixFromTurn` on (segment reason `verify-fix`: all turns) → fix;
  else implement.
- New `src/analytics/readFirst.ts`: `parseReadFirst(briefMarkdown)` → paths from the
  `## Read first` section (backticked tokens that look like paths; ignore `docs/testing.md`
  and `CLAUDE.md`, which every task reads).
- New `src/analytics/recordAnalytics.ts`: `recordAnalytics({ store, transcriptFile, task,
sessionId, segment, reason, briefPath })` — reads, analyzes, appends the event; used by the
  runner after each `session.finished` and by `analyze --reindex`. Wire it into
  `src/runner/runSpec.ts` (after `session.finished`, failures logged via the reporter, never
  fatal) — the only change to the runner.
- New `src/analytics/latestMetrics.ts`: `latestMetrics(events)` → `Map<"task/session/segment",
SessionMetrics>` with the highest `analyzerVersion`.

## Done when

- `analyzeSession.spec.ts` (messages built with the fixture builders): context curve and peak,
  tool/file aggregation incl. re-reads, Bash top list, brief read/unread/extra, the four phases,
  paths relativized.
- `readFirst.spec.ts`: parses `SR-3.md`-style bullets incl. `a.ts` + `b.ts` and line hints.
- `latestMetrics.spec.ts`: higher version wins.
- `runSpec.spec.ts` (existing): an `analytics.session` event follows each `session.finished`;
  a broken transcript only logs.
- `tools/spec-verify.sh` green.

## Implementation notes

<!-- Filled in by the implementing agent: files, exported names, deviations. -->
