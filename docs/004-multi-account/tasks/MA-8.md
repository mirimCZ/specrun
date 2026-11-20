# MA-8 — Dashboard and log lines per account

Phase 1 · Needs: MA-5 · Implements: MAD-12 (reading), MAD-13

The dashboard and the plain log lines show which account a task runs on, the latest usage of
each account, and a line for every switch. With only the implicit account, the output is
unchanged.

## Decisions

- **MAD-13** — The dashboard and log lines show the active account and the latest known 5h /
  weekly % of each account, plus a line on each `account.switched`. With only the implicit
  account, the output is unchanged.
- **MAD-12 (reading)** — `session.started`, `session.finished`, `usage.snapshot` and `limit.wait`
  carry an optional `account` (missing = `default`). `account.switched { task, from, to, reason }`
  marks a switch.
- Rendering rule (from MAD-6 / MAD-13): an event without `account` or with `account: 'default'`
  renders exactly as today. Account labels appear only for other names.

## Read first

- `src/cli/eventLines.ts`:
  - lines 30–45 — `usageText`;
  - lines 95–165 — `createEventFormatter` cases `session.started`, `limit.wait`,
    `usage.snapshot`.
- `src/ui/dashboardStore.ts`:
  - lines 25–50 — `UsageView`, `DashboardView`;
  - lines 78–115 — `usageOf`, `record`.
- `src/ui/Dashboard.tsx` lines 50–65 — the status line (wait, else usage).
- `src/runner/reporter.ts` — `WaitingUpdate`.
- `src/runner/runSpec.ts` — the `wait` helper's `reporter.waiting({ until, reason })` calls.
- `src/ui/dashboardStore.spec.ts` (case at line 182), `src/ui/Dashboard.spec.tsx` and
  `src/cli/lineReporter.spec.ts` — patterns and guards.

## Changes

- `src/cli/eventLines.ts`:
  - `usage.snapshot` with a non-default account → `usage <account>: …`.
  - `limit.wait` → `⏳ <account> waiting until …`.
  - `session.started` → append ` on <account>` to its existing line.
  - New case `account.switched` → `⇄ <task> account <from> → <to> (<reason>)`, in yellow.
- `src/runner/reporter.ts`: `WaitingUpdate` gains an optional `account?: string`.
  `src/runner/runSpec.ts` passes the waited account in both `reporter.waiting` calls (the only
  change in the runner).
- `src/ui/dashboardStore.ts`:
  - `DashboardView.usage` becomes `accounts: AccountUsageView[]` (name, `UsageView`), in order of
    first appearance.
  - Add `activeAccount: string | null`, taken from the latest `session.started`.
  - Keep a `usage: UsageView | null` getter-equivalent (the active or only account's usage) if
    that keeps the existing assertions unchanged.
- `src/ui/Dashboard.tsx`:
  - The status line shows each known account as `<name> <usageText>`, separated by `|`, with
    the active one marked `▸`. With only `default` it shows `usageText` as today.
  - The waiting line includes the account when it isn't `default`.

## Done when

- `eventLines` cases (in `lineReporter.spec.ts` or a new `src/cli/eventLines.spec.ts`):
  - each changed line, with a non-default account;
  - `account.switched`;
  - the same events without `account` or with `default` produce today's text.
- `dashboardStore.spec.ts`: two accounts' snapshots → two entries in order; the active account
  follows `session.started`.
- `Dashboard.spec.tsx`: the multi-account status line shows both names and the `▸` marker.
- Existing dashboard and line reporter cases pass unchanged.
