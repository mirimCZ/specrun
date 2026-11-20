# MA-9 — Stats per account

Phase 1 · Needs: MA-4 · Implements: MAD-12 (stats)

`specrun stats` shows how much each Claude account did per spec, so the user can see how the
priority and fallback accounts share the work.

## Decisions

- **MAD-12 (stats)** — `session.finished` carries an optional `account` (missing = `default`).
  `specrun stats` adds an ACCOUNTS table (per spec and account: segments, turns, cost) and
  `--json` `accounts`.
- The table is printed only when some spec has a `session.finished` with an account other than
  `default`, so output without accounts stays as today. `--json` always has `accounts` (possibly
  `[]`). Archived specs contribute nothing (history.json is out of scope).

## Read first

- `git show 7531d9b` — the verify timings commit: the pattern for a new section across
  `aggregate.ts`, `jsonOutput.ts`, `stats.ts`, their specs and `docs/json-output.md`. Skip its
  archive / git parts.
- `src/stats/aggregate.ts` — `verifySummary` (line 164) as the closest function to copy.
- `src/stats/jsonOutput.ts` — schemas and the stats output object.
- `src/cli/commands/stats.ts` lines 95–150 — where per-spec summaries are gathered and tables
  printed.
- `src/stats/aggregate.spec.ts` and `src/cli/commands/stats.spec.ts` — patterns and guards.
- `docs/json-output.md` section `specrun stats` — documents the JSON shape.

## Changes

- `src/stats/aggregate.ts`: `accountSummary(events): AccountSummary[]` sums `session.finished`
  per account (`account ?? IMPLICIT_ACCOUNT`), giving `{ account, segments, turns, costUsd }`.
  The order is the first appearance in the log.
- `src/stats/jsonOutput.ts`: `AccountSummarySchema`, and `accounts: [{ spec, account, segments, turns, costUsd }]`
  in the stats output. `version` stays 1, as in `7531d9b`.
- `src/cli/commands/stats.ts`: the ACCOUNTS table (spec, account, segments, turns, cost), after
  the existing tables, under the rule above.
- `docs/json-output.md`: document `accounts`.

## Done when

- `aggregate.spec.ts`: mixed events → sums per account; events without `account` count as
  `default`; no `session.finished` → `[]`.
- `stats.spec.ts`: a log with two accounts prints the ACCOUNTS table and `--json` lists both. A
  log without accounts prints no table but `--json` has `accounts` with the `default` entry.
- Existing stats cases pass unchanged.
