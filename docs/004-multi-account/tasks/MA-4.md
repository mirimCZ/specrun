# MA-4 — Account choice policy and account events

Phase 1 · Needs: MA-1 · Implements: MAD-7, MAD-8, MAD-9, MAD-10 (policy part), MAD-12 (event shapes)

Pure policy that picks the account for the next segment from the usage of every account, plus the
event fields that record which account did what. The runner (MA-5) calls the policy, and the UI
(MA-8) and stats (MA-9) read the events.

## Decisions

- **MAD-7** — With `--burn` (`burn: true`), an account whose 5-hour window is low is skipped in
  favour of the next account that can go. Without it, the run waits for that account's session
  reset, even if a later account could go.
- **MAD-8** — An account below its weekly minimum is always skipped, with or without `--burn`.
  When every account is weekly-low, the run stops as `paused-weekly`.
- **MAD-9** — Every task starts by choosing an account in priority order. Within a task the
  account is sticky: later segments keep it as long as it can go, and move on (in priority order)
  only when MAD-7 / MAD-8 / MAD-10 force it.
- **MAD-10 (policy)** — A `limit` outcome blocks that account until its reset target. With
  `--burn`, the task resumes on the next account that can go; without it, it waits for the reset
  on the same account. If no account can go, it waits for the earliest target. Waits caused by a
  blocked account keep the reason `limit-hit`.
- **MAD-12 (shapes)** — `session.started`, `session.finished`, `usage.snapshot` and `limit.wait`
  get an optional `account: string` (missing = `default`). New event
  `account.switched { task, from, to, reason: 'weekly-low' | 'session-low' | 'limit-hit' | 'priority' }`.

## Read first

- `src/limits/policy.ts` — `decide`, `waitTarget`, `PauseDecision`; the new code builds on
  `decide`.
- `src/limits/policy.spec.ts` — pattern and guard (`decide` cases stay unchanged).
- `src/limits/usage.ts` lines 1–12 — `UsageSnapshot`, `UsageWindow`.
- `src/config/configSchema.ts` — `AccountLimits` (from MA-1).
- `src/events/eventSchema.ts` lines 73–135 and 255–290 — the four schemas, the `EventSchema`
  union and `NewEvent`.
- `src/events/eventStore.spec.ts` — how event round-trips are tested.

## Changes

- `src/limits/policy.ts`:
  - `decide(snapshot, limits: AccountLimits, now)`. Only the parameter type changes; its
    behaviour stays the same.
  - `type AccountUsage = { name: string; limits: AccountLimits; snapshot: UsageSnapshot | null; blockedUntil: Date | null }`.
  - `type AccountChoice = { action: 'go'; account: string } | { action: 'wait'; account: string; until: Date; reason: 'session-low' | 'limit-hit' } | { action: 'stop'; reason: 'weekly-low'; resetsAt: Date | null }`.
  - `chooseAccount(accounts: readonly AccountUsage[], options: { burn: boolean; current: string | null }, now: Date): AccountChoice`.
    It throws a plain `Error` on an empty list (a programmer error). Per account, check in this
    order: weekly-low (by `decide`) → skip; `blockedUntil > now` →
    wait `limit-hit` until `blockedUntil`; `decide` wait → wait `session-low`; else go.
    Candidate order: `current` first (when present in the list), then the rest in list order.
    - Without burn, the first candidate that isn't weekly-low decides (go or its wait).
    - With burn, the first go wins. Otherwise wait on the earliest `until`, ties to the earlier
      candidate.
    - When every candidate is weekly-low → stop, with `resetsAt` = the earliest non-null
      weekly reset.
  - `switchReason(from: AccountUsage, now: Date): 'weekly-low' | 'session-low' | 'limit-hit' | 'priority'`:
    returns `limit-hit` when blocked, `weekly-low` / `session-low` by `decide`, else `priority`.
    This is the reason for leaving `from`.
- `src/events/eventSchema.ts`: `account: z.string().optional()` on the four schemas, and a new
  `AccountSwitchedSchema` (`t: 'account.switched'`, `task`, `from`, `to`, `reason`) in
  `EventSchema`. Its reducer in `src/events/taskState.ts` ignores it (default branch). Check that
  no change is needed there.

## Done when

- `policy.spec.ts`, new `describe('chooseAccount')` with cases:
  - a single account gives the same decision as `decide` for go / session-low / weekly-low;
  - the priority account goes when it can;
  - weekly-low priority → fallback without burn;
  - session-low priority without burn → waits on it although the fallback could go;
  - session-low priority with burn → fallback;
  - `current` is preferred over a higher-priority account and left only when forced;
  - `blockedUntil` in the future → `limit-hit` wait (without burn) or the next account (with
    burn); a past `blockedUntil` is ignored;
  - with burn and all accounts session-low → the earliest `until`;
  - all weekly-low → stop with the earliest weekly reset.
- `switchReason` has one case per result.
- `eventStore.spec.ts` (or `eventSchema` cases next to it): an `account.switched` event and a
  `session.started` with `account` round-trip, and a `session.started` without `account` still
  parses.
- Existing `decide` cases pass unchanged.
