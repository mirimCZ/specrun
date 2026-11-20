# MA-7 — `--account` for plan and review

Phase 1 · Needs: MA-6 · Implements: MAD-1, MAD-11 (plan / review), MAD-15

`specrun plan` and `specrun review` start an interactive `claude`. With accounts configured,
they now start it on the priority account, or on the account named by `--account`.

## Decisions

- **MAD-1** — An account with a token runs its CLI processes, including the interactive `claude`
  of plan / review, with `CLAUDE_CODE_OAUTH_TOKEN=<token>` in the child env. specrun never sets
  `CLAUDE_CONFIG_DIR`, so the plan transcript lookup (`claudeConfigDir`) stays as it is.
- **MAD-11 (plan / review)** — `--account <name>`: use only this account. Unknown name →
  `SpecrunError('account-unknown', …)`. Without the flag, plan / review use the priority account.
- **MAD-15** — The token is resolved once before `claude` starts. A token error fails the command
  before anything is written. The token is never printed, including with `--print`.

## Read first

- `src/cli/commands/plan.ts` lines 100–135 (`runInteractive('claude', args, { env: deps.env })`)
  and the flags in its `register`.
- `src/cli/commands/review.ts` lines 85–110 — the same launch.
- `src/cli/commands/plan.spec.ts` and `review.spec.ts` — the `launch` override records `env`
  (pattern and guard).
- `src/accounts/prepare.ts` (from MA-2) — `prepareAccounts` with `{ kind: 'priority' }` /
  `{ kind: 'pinned', name }`.
- `src/cli/commands/run.ts` — how MA-6 calls `loadGlobalConfig` and `prepareAccounts`, and prints
  the warnings (copy that, or extract a shared helper into `src/cli/` if the code would repeat).

## Changes

- `plan.ts` and `review.ts`:
  - Add `--account <name>`.
  - When not `--print`, prepare one account (pinned or priority) before writing context files.
  - Launch with `env: account.env ?? deps.env`.
  - Print warnings to stderr as `warning: <text>`.
- If the account preparation from `run.ts` would be copied twice, move it into one helper in
  `src/cli/` (e.g. `accountsFor(repoRoot, config, selection, deps)`) and use it from all three
  commands.
- `README.md`: add `--account` to the plan and review sections.

## Done when

- `plan.spec.ts` and `review.spec.ts`, new cases:
  - with a global config of two accounts (env token) the launch env has the priority account's
    `CLAUDE_CODE_OAUTH_TOKEN`;
  - `--account` picks the other one;
  - an unknown name → `account-unknown` and no launch;
  - `--print` resolves no token.
- Existing plan / review cases pass unchanged (no global config → `env` is `deps.env`).
