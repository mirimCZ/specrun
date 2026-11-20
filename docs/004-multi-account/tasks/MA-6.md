# MA-6 — CLI: run flags and `specrun accounts`

Phase 1 · Needs: MA-5 · Implements: MAD-7, MAD-11 (run), MAD-14, MAD-15, MAD-17

Wires the accounts into `specrun run` (`-b` / `--burn`, `--account <name>`) and adds
`specrun accounts`, which checks every configured account before a long run.

## Decisions

- **MAD-7** — `specrun run -b` / `--burn`: an account whose 5-hour window is low is skipped in
  favour of the next account that can go. Without `--burn`, the run waits for that account's
  session reset.
- **MAD-11 (run)** — `--account <name>`: use only this account (no switching). Unknown name →
  `SpecrunError('account-unknown', …)` listing the configured names.
- **MAD-14** — `specrun accounts` lists the accounts in priority order. For each it shows the
  token source (`env VAR`, `command`, `system login`), the merged limits, and a probe result:
  5h / weekly % left with resets, `token error: …` or `probe failed`. Exit 1 when any account
  failed.
- **MAD-15** — Tokens are resolved once per command start, kept in memory only, never printed. A
  token error fails `run` before any work starts.
- **MAD-17** — Warnings about unknown `limits.accounts` names are printed, never fatal.

## Read first

- `src/cli/commands/run.ts`:
  - lines 150–230 — the flags, `allOptions`, `buildRunOptions` and `runDeps` (MA-5 left a
    single `default` account there);
  - `RunFlags`.
- `src/cli/commands/run.spec.ts` lines 60–100 — flags → options cases (pattern and guard).
- `src/accounts/prepare.ts` and `src/accounts/token.ts` (from MA-2) — `prepareAccounts`,
  `resolveToken`.
- `src/config/globalConfig.ts` (from MA-1) — `loadGlobalConfig`.
- `src/cli/cliDeps.ts` + `test/fixtures/specRepo.ts` (`captureDeps`) — add `homedir`.
- `src/cli/commands/status.ts` + `status.spec.ts` — the pattern for a small read-only command;
  `src/cli/table.ts` `table`.
- `src/cli/program.ts` — command registration.
- `README.md` lines 133–145 (Running) and the "Other commands" section.

## Changes

- `src/cli/cliDeps.ts`: `CliDeps` gains `homedir: () => string` (default `os.homedir`).
  `captureDeps` sets it to a folder inside the test's temp dir, so no test reads the real
  `~/.specrun/config.json`.
- `src/cli/commands/run.ts`:
  - Add `-b, --burn` ("with several accounts: move on when the 5-hour window is low instead of
    waiting") and `--account <name>`.
  - Unless `--dry-run`: `loadGlobalConfig`, then `prepareAccounts` with `{ kind: 'pinned', name }`
    or `{ kind: 'all' }`, using `deps.env`, `runCommand`, `process.platform` and the repo root.
  - Print each warning to stderr as `warning: <text>`.
  - Build each `RunAccount` with
    `probe: () => probeUsage({ cwd: repoRoot, ...(env === null ? {} : { env }) })`.
  - Pass `burn` into `allOptions` / `buildRunOptions`.
- New `src/cli/commands/accounts.ts` (+ `accounts.spec.ts`), registered in `program.ts`:
  `specrun accounts`. It loads the repo and global config, calls `resolveAccounts`, and resolves
  each token separately, catching `account-token` per account. It probes the accounts in parallel
  with their env and prints one `table` row per account (name, source, limits `s/w`, 5h left +
  reset, week left + reset, or the error). Probe and token resolver are injectable via
  overrides, like `run.ts`'s overrides.
- `README.md`:
  - Running: one sentence on accounts and `-b` / `--burn`.
  - Other commands: `specrun accounts`.
  - The `run` flags list: `--account`.

## Done when

- `run.spec.ts`, new cases:
  - `-b` → `burn: true` in the `runSpec` options;
  - a global config with two accounts → `runSpec` gets both in order with merged limits, and the
    env token account's env has `CLAUDE_CODE_OAUTH_TOKEN` (placeholder value);
  - `--account f` → only `f`;
  - `--account nope` → `account-unknown`, and `runSpec` is not called;
  - a missing token variable → `account-token`, and `runSpec` is not called;
  - an unknown `limits.accounts` name → a `warning:` line on stderr.
- Existing `run.spec.ts` cases pass unchanged (no global config → one `default` account,
  `burn: false`).
- `accounts.spec.ts` checks:
  - two accounts with stubbed probes → rows in priority order with the %;
  - a token error on one → its row shows `token error`, the other still probes, and exit 1;
  - no global config → one `default` row with `system login`.
  - No output contains the placeholder token.
