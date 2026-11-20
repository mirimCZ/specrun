# MA-2 — Token sources, account env and preparation

Phase 1 · Needs: MA-1 · Implements: MAD-5, MAD-11 (selection part), MAD-15, MAD-16

Turns the accounts from MA-1 into prepared accounts: a resolved token and the child env every CLI
process of that account gets. This is the one place commands call before starting work. MA-6
(run, `specrun accounts`) and MA-7 (plan / review) use it.

## Decisions

- **MAD-5** — `token` is `{ "env": "<VAR>" }` (value of that variable) or
  `{ "command": "<shell command>" }` (trimmed stdout; run through `/bin/sh -c`, or
  `cmd.exe /d /s /c` on win32, with a 10 s timeout). An account without `token` uses the system
  login (env unchanged); at most one account may omit it. A missing / empty variable, a non-zero
  exit, a timeout or empty stdout → `SpecrunError('account-token', 'account <name>: …')` whose
  details never include stdout.
- **MAD-11 (selection)** — `--account <name>`: use only this account. Unknown name →
  `SpecrunError('account-unknown', …)` listing the configured names. `plan` / `review` without
  the flag use the priority account.
- **MAD-15** — Tokens are resolved once per command start for the accounts it will use and kept
  in memory only. They never reach events, logs, transcripts, error messages or `PROGRESS.md`. A
  token error fails the command before any work starts.
- **MAD-16** — For an account with a token: a copy of the base env without
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, then
  `CLAUDE_CODE_OAUTH_TOKEN=<token>` (`accountEnv`). For the system login: no override (the child
  inherits `process.env`).

## Read first

- `src/accounts/accounts.ts` (from MA-1) — `Account`, `resolveAccounts`, `IMPLICIT_ACCOUNT`.
- `src/config/globalConfig.ts` (from MA-1) — `TokenSource`, `GlobalConfig`.
- `src/process/run.ts` — `ProcessRunner`, `RunOptions.timeoutMs`; a killed process reports
  code -1.
- `src/archive/closeSpec.spec.ts` — how a stub `ProcessRunner` is written in tests.
- `src/errors.ts` — the `account-token` / `account-unknown` codes MA-1 added.

## Changes

- New `src/accounts/token.ts`:
  - `TOKEN_COMMAND_TIMEOUT_MS = 10_000`.
  - `resolveToken(account: Account, deps: TokenDeps): Promise<string | null>`, where
    `TokenDeps = { env: NodeJS.ProcessEnv; run: ProcessRunner; platform: NodeJS.Platform; cwd: string }`.
    Returns null for the system login. Error details may quote the first stderr line, never
    stdout.
- New `src/accounts/env.ts`:
  - `type ChildEnv = Readonly<Record<string, string | undefined>>`.
  - `accountEnv(base: NodeJS.ProcessEnv, token: string | null): ChildEnv | null` per MAD-16
    (null token → null).
- New `src/accounts/prepare.ts`:
  - `type AccountSelection = { kind: 'all' } | { kind: 'priority' } | { kind: 'pinned'; name: string }`.
  - `type PreparedAccount = { name: string; limits: AccountLimits; env: ChildEnv | null }`.
    The token itself is not kept in the result; it lives only inside `env`.
  - `prepareAccounts(input: { config: Config; global: GlobalConfig; selection: AccountSelection }, deps: TokenDeps): Promise<{ accounts: PreparedAccount[]; warnings: string[] }>`.
    It calls `resolveAccounts`, selects (all in priority order / the first / the named one),
    then resolves the tokens of the selected accounts only.

## Done when

- `src/accounts/token.spec.ts` (stub runner) checks:
  - an env source returns its value; a missing or empty variable → `account-token` naming the
    account and the variable;
  - a command source runs `/bin/sh -c <cmd>` on darwin / linux and `cmd.exe /d /s /c <cmd>` on
    win32, with the timeout, and returns the trimmed stdout;
  - exit ≠ 0, code -1 (timeout) and empty stdout each → `account-token`, and the error message
    doesn't contain the stub's stdout (assert with a placeholder token string);
  - a tokenless account → null without running anything.
- `src/accounts/env.spec.ts` checks:
  - the three variables are removed and the token is set;
  - the base object is not mutated;
  - other variables are kept;
  - a null token gives null.
- `src/accounts/prepare.spec.ts` checks:
  - `all` keeps the priority order;
  - `priority` resolves only the first account (the stub runner is not called for the others);
  - `pinned` an unknown name → `account-unknown` listing the names;
  - the warnings from `resolveAccounts` pass through;
  - without global accounts → one `default` account with `env: null`.
