# PL-3 — Planning totals in history.json and stats

Phase 1 · Needs: PL-1 · Implements: PLD-8

Planning sessions recorded as `plan.session` events (PL-1) become per-spec totals: `specrun
archive` keeps them in `history.json`, and `specrun stats` shows them as text and JSON. That makes
planning cost comparable across specs after they are archived.

## Decisions

- **PLD-8** — `History` gets `planning: { sessions, turns, inputTokens, outputTokens, cacheRead, cacheWrite, peakContext, subagentTokens } | null` (defaulted to `null`; `version` stays 1, the field is additive). It is computed from the latest `plan.session` event per `sessionId` with non-null metrics; `peakContext` = max, `subagentTokens` = sum of subagent input + output + cacheRead + cacheWrite, the rest are sums. A spec with planning data keeps its `history.json` even without samples. `specrun stats` prints a "Planning" table (SPEC, SESSIONS, TURNS, IN, OUT, CACHE READ, PEAK CTX) under the existing output when any selected spec has planning data; `--json` gets `planning: [{ spec, ...same fields }]` (additive, version stays 1).
- **PLD-6** (shape of the input) — `metrics: PlanMetrics | null` with `{ turns, inputTokens, outputTokens, cacheRead, cacheWrite, peakContext, models, subagents: { files, turns, inputTokens, outputTokens, cacheRead, cacheWrite } }`.
- Side effect (README §2): a resumed session appends to the same transcript, so its later event covers the whole session. Never sum events of one session id.

## Read first

- `src/stats/aggregate.ts` — `taskSamples`, `SpecInput`: where a `planningSummary` belongs
- `src/stats/aggregate.spec.ts` — pattern for the aggregation test
- `src/stats/jsonOutput.ts` — `TaskSampleSchema`, `StatsJsonSchema` (SRD-16 comment)
- `src/archive/history.ts` — `HistorySchema` (`outcome` shows a defaulted field)
- `src/archive/archiveSpec.ts` — `readArchiveSource` (lines 143–180), `writeArchive` `keepHistory` (lines 215–245)
- `src/archive/archiveSpec.spec.ts` + `test/fixtures/archive.ts` — archive test pattern
- `src/cli/commands/stats.ts` + `stats.spec.ts` — text and JSON output, `table`, `formatTokens`
- `src/cli/specInputs.ts` — `loadRunHistory` (active inputs + archived histories)

## Changes

- `src/stats/jsonOutput.ts`: `PlanningSummarySchema` (fields of PLD-8) and `StatsJsonSchema.planning: z.array(PlanningSummarySchema.extend({ spec }))`.
- `src/stats/aggregate.ts`: `planningSummary(events): PlanningSummary | null` (latest per `sessionId`, sums / max per PLD-8).
- `src/archive/history.ts`: `planning: PlanningSummarySchema.nullable().default(null)`.
- `src/archive/archiveSpec.ts`: `ArchiveSource.planning`, written into the history. `keepHistory` is also true when `planning !== null`.
- `src/cli/commands/stats.ts`: "Planning" table and the JSON field, from active specs' events and archived histories.

## Done when

- `aggregate.spec.ts`:
  - two events of one session id count once (the later one),
  - two sessions are summed and `peakContext` is the max,
  - events with `metrics: null` are skipped,
  - no events → `null`.
- `archiveSpec.spec.ts`: a spec with only planning events (no samples) archives with a `history.json` holding `planning`; a history file without `planning` still parses (`null`).
- `stats.spec.ts`: the Planning table appears only when there is data; `--json` validates against `StatsJsonSchema` and carries `planning`.
- Existing archive and stats tests unchanged and green.
