# MA-5 — Runner: accounts, switching and burn

Phase 1 · Needs: MA-2, MA-3, MA-4 · Implements: MAD-6, MAD-7, MAD-8, MAD-9, MAD-10, MAD-12 (writing)

The runner gets a list of accounts instead of one probe. Before every segment it keeps the usage
of each account fresh, picks the account with `chooseAccount` (MA-4) and runs the segment with
that account's env. It records the account on its events. A single implicit account behaves
exactly as today.

## Decisions

- **MAD-6** — No accounts configured → one implicit account `default`. Output, events (apart from
  the `account` field) and exit codes stay as today.
- **MAD-7** — `--burn`: an account whose 5-hour window is low is skipped in favour of the next
  account that can go. Without `--burn`, the run waits for that account's session reset.
- **MAD-8** — An account below its weekly minimum is always skipped. When every account is
  weekly-low, the run stops as `paused-weekly` (exit 75).
- **MAD-9** — Every task starts by choosing an account in priority order. Within a task the
  account is sticky: later segments (verify-fix, nudge, limit-resume) keep it as long as it can
  go, and move on only when MAD-7 / MAD-8 / MAD-10 force it.
- **MAD-10** — A `limit` outcome blocks that account until its reset target (`waitTarget` /
  `limitHitTarget`). With `--burn`, the task resumes the same session on the next account that
  can go. Without `--burn`, it waits for the reset and resumes on the same account, as today. If
  no account can go, it waits for the earliest target. Waits caused by a blocked account keep the
  reason `limit-hit`.
- **MAD-12 (writing)** — The runner always writes `account` on `session.started`,
  `session.finished`, `usage.snapshot` and `limit.wait`. It appends
  `account.switched { task, from, to, reason }` when a segment runs on another account than the
  run's previous segment. The reason comes from `switchReason(from)`.

## Read first

- `src/runner/runSpec.ts`:
  - lines 46–76 — `RunSpecOptions`, `RunSpecDeps.probeUsage`;
  - lines 146–155 — `snapshotEvent`;
  - lines 240–320 — `latest`, `probeFailing`, `wait`, `pauseCheck`;
  - lines 418–545 — the segment loop and the `limit` case.
- `src/limits/policy.ts` — `chooseAccount`, `AccountUsage`, `switchReason` (from MA-4).
- `src/accounts/prepare.ts` — `PreparedAccount` (from MA-2).
- `src/runner/runSpec.spec.ts` lines 80–110 — the harness (`probeUsage` / `probes`). Guards: cases
  at lines 214, 320, 388, 421 (probe warning, limit hit resume, stop during wait, weekly stop).
- `src/runner/runAll.ts` lines 29–40 and 260–270 — `RunAllOptions` and how options reach
  `runSpec`.
- `src/cli/commands/run.ts` lines 213–222 — the `runDeps` this task must keep compiling.
- `docs/v1/README.md` line 92 (SRD-10) and line 119 (SRD-37, the latest SRD row).

## Changes

- `src/runner/runSpec.ts`:
  - Export `type RunAccount = PreparedAccount & { probe: () => Promise<UsageSnapshot | null> }`.
  - `RunSpecDeps.probeUsage` → `accounts: readonly [RunAccount, ...RunAccount[]]`, in priority
    order.
  - `RunSpecOptions` gains `burn: boolean`.
  - Per-account state: snapshot map, `blockedUntil` map, probe-failing set, plus the run's
    `lastAccount`.
  - The pause check refreshes every account's stale snapshot (`SNAPSHOT_MAX_AGE_MS`, per account),
    then calls `chooseAccount` with `current` = the task's account (null at task start). It
    returns the chosen account.
    - A wait clears that account's snapshot and block, then checks again.
    - The probe warning stays `usage probe failed — running without limit data` when there is one
      account. With several, it is `usage probe failed for <name> — running without limit data`,
      once per failure streak per account.
  - The segment runs with `env` = the chosen account's env and records the account. A session
    snapshot (`seen.snapshot`) belongs to the segment's account.
  - `limit` outcome:
    - Set `blockedUntil` for the account (same target computation as today).
    - Call `chooseAccount` at once, with the snapshots already known and no probe.
    - On wait: wait (reason from the choice), then clear that account's snapshot and block.
    - On go: continue, and the loop resumes on the chosen account.
    - On stop: end as paused-weekly.
    - Then `limit-resume` as today. A single-account run thus emits the same events in the same
      order as now.
  - `paused-weekly` message: unchanged with one account; with several it is
    `weekly usage left below the minimum on every account`.
- `src/runner/runAll.ts`: `RunAllOptions` gains `burn: boolean` and passes it to `runSpec`.
- `src/cli/commands/run.ts`: minimal wiring so it compiles. Pass one `default` account
  (`IMPLICIT_ACCOUNT`, repo `config.limits` fields, `env: null`,
  `probe: () => probeUsage({ cwd: repoRoot })`) and `burn: false`. MA-6 replaces this.
- `docs/v1/README.md`: add row **SRD-38 Accounts** (2026-11-20, spec 004-multi-account) that
  summarises MAD-1–MAD-17 in one paragraph. Append "(several accounts: SRD-38)" to SRD-10.

## Done when

- The harness builds accounts from the existing `probeUsage` / `probes` stubs as one `default`
  account. Every existing `runSpec.spec.ts` and `runAll.spec.ts` case passes unchanged.
- New `runSpec.spec.ts` cases with two accounts (`p` priority, `f` fallback; fake session records
  `env`):
  - weekly-low `p` → the task runs on `f` with `f`'s env; `account.switched` reason `weekly-low`;
  - session-low `p` without burn → `limit.wait` on `p` (account `p`), then runs on `p`;
  - session-low `p` with burn → runs on `f`, reason `session-low`;
  - limit hit on `p` with burn → `session.started` reason `limit-resume`, the same session id,
    account `f`, with no wait; without burn → `limit.wait` `limit-hit` and resume on `p`;
  - after a task on `f`, the next task runs on `p` again once `p` can go (reason `priority`);
  - both weekly-low → exit 75 with the "every account" message.
- `session.started`, `session.finished`, `usage.snapshot` and `limit.wait` carry `account` in
  these cases, and carry `default` in a single-account run.
