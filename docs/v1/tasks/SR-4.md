# SR-4 — Usage windows, pause policy, waiting

Phase 1 · Needs: SR-1 · Implements: SRD-10 (policy part), SRD-4 (keep-awake)

Plan usage comes from two SDK sources with different scales; this task normalizes them into one
snapshot, decides whether the runner may start or resume a session, and implements waiting
(clock-injected) plus macOS keep-awake.

## Decisions

- **SRD-10** — before each task and each resume: session left < `limits.sessionMinLeft`
  (default 15 %) → wait until the 5h reset + 60 s; weekly left < `limits.weeklyMinLeft`
  (default 5 %) → stop the run (exit 75). A limit hit inside a session → wait for the reset,
  then resume the same session.
- **SRD-4** (this part) — macOS: `caffeinate -i -w <pid>` while running when the binary exists.
- Spike facts: `rate_limit_event.rate_limit_info.unifiedWindows.{five_hour,seven_day}` has
  `utilization` 0–1 and `resetsAt` epoch **seconds** (also top-level `status`, `rateLimitType`,
  `resetsAt`); the usage probe returns `rate_limits.{five_hour,seven_day}` with `utilization`
  0–100 and ISO `resets_at`. Either window may be missing or null.

## Read first

- `CLAUDE.md`, `docs/testing.md` (injected clock).
- `docs/spikes/agent-sdk.md` — both sources; raw shapes in the spike's summary section.
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `SDKRateLimitInfo`
  (`grep -n "export declare type SDKRateLimitInfo" -A30`) and `SDKControlGetUsageResponse`
  (`grep -n "SDKControlGetUsageResponse = " -A45`). `unifiedWindows` is not in the SDK type —
  read it defensively from `unknown`.
- `tools/spec-autorun.sh` `handle_pause` / `wait_until` — the old waiting rules (reset + 60 s,
  30 min when the reset is unknown, 5 min when it has passed).
- SR-1 notes below — `Config['limits']`.

## Changes

- New `src/limits/usage.ts`: `type UsageWindow = { leftPercent: number; resetsAt: Date | null }`,
  `type UsageSnapshot = { session: UsageWindow | null; weekly: UsageWindow | null; source:
'event' | 'probe'; at: Date; rejected: boolean }`. `fromRateLimitEvent(info: unknown, at)` and
  `fromUsageProbe(response: unknown, at)` → `UsageSnapshot | null` (zod-parsed, lenient: unknown
  extra fields ignored, missing windows null). `rejected` = top-level `status === 'rejected'`.
- New `src/limits/policy.ts`: `decide(snapshot: UsageSnapshot | null, limits, now)` →
  `{ action: 'go' } | { action: 'wait', until: Date, reason: 'session-low' } |
{ action: 'stop', reason: 'weekly-low', resetsAt: Date | null }` — no snapshot → go;
  `waitTarget(resetsAt, now)` implements the old rules (reset + 60 s; unknown → now + 30 min;
  already passed → now + 5 min); `limitHitTarget(snapshot, now)` for a limit hit inside a session.
- New `src/limits/clock.ts`: `type Clock = { now(): Date; sleep(ms, signal?): Promise<void> }`,
  `systemClock`; `waitUntil(target, { clock, signal, onTick, tickMs = 1000 })` — recomputes the
  remaining time from `clock.now()` on every tick (correct after the Mac sleeps), resolves early
  and rejects with `AbortError` on `signal`.
- New `test/fakes/fakeClock.ts`: `createFakeClock(start)` — `now`, `sleep` that advances time
  immediately and records the calls, `advance(ms)`.
- New `src/limits/keepAwake.ts`: `keepAwake({ pid, platform, spawn })` → `{ stop() }` — spawns
  `caffeinate -i -w <pid>` on `darwin` when found, no-op elsewhere or when spawning fails.

## Done when

- `usage.spec.ts`: both sources normalize to the same snapshot (0–1 vs 0–100, epoch s vs ISO),
  missing/null windows, `rejected`, garbage input → null.
- `policy.spec.ts`: go / session wait / weekly stop (weekly wins over session), threshold
  boundaries, `waitTarget` three cases, `limitHitTarget`.
- `clock.spec.ts`: `waitUntil` with the fake clock ticks and resolves; abort rejects.
- `keepAwake.spec.ts`: spawns on darwin with the right args (injected spawn), no-op on linux.
- `tools/spec-verify.sh` green.

## Implementation notes

- `src/limits/usage.ts`: `UsageWindow`, `UsageSnapshot`, `fromRateLimitEvent(info, at)`,
  `fromUsageProbe(response, at)`. `leftPercent` = 100 − utilization%, clamped 0–100. An event
  object without windows still yields a snapshot (windows null); non-objects → null. A probe
  without `rate_limits` → null. Unparseable dates → `resetsAt: null`.
- `src/limits/policy.ts`: `PauseDecision`, `decide(snapshot, limits, now)`, `waitTarget(resetsAt, now)`,
  `limitHitTarget(snapshot, now)` (uses the session window's reset). Thresholds are exclusive
  (`left < min`); weekly wins over session.
- `src/limits/clock.ts`: `Clock`, `systemClock`, `waitUntil(target, { clock, signal?, onTick?, tickMs? })`;
  `onTick(remainingMs)` is called before each sleep; abort → `AbortError` (name set).
- `src/limits/keepAwake.ts`: `keepAwake({ pid, platform, spawn })` → `{ stop() }`; `spawn` is a
  minimal `(cmd, args, { stdio: 'ignore' }) => KeepAwakeChild` (Node's `spawn` fits). A missing
  binary is tolerated via the child's `error` event, not a pre-check.
- `test/fakes/fakeClock.ts`: `createFakeClock(start)` → `Clock` + `sleeps: number[]`, `advance(ms)`.
- No deviations; no other docs needed a "superseded" note.
