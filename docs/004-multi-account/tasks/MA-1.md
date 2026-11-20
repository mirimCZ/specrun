# MA-1 — Global config, accounts and merged limits

Phase 1 · Needs: — · Implements: MAD-2, MAD-3, MAD-4, MAD-6, MAD-17

Adds the global config `~/.specrun/config.json` with a list of Claude accounts, the repo-side
per-account limit overrides, and one pure function that turns both into the run's accounts with
merged limits. Nothing uses the accounts yet; later tasks resolve tokens (MA-2) and choose
accounts (MA-4, MA-5).

## Decisions

- **MAD-2** — Global config `~/.specrun/config.json` (`GLOBAL_CONFIG_FILE`), strict zod schema:
  `{ "accounts": [{ "name", "token"?, "limits"? }] }`, `accounts` defaults to `[]`. `name`
  matches `^[a-z0-9][a-z0-9-]*$` and is unique. `limits` is a partial
  `{ sessionMinLeft?, weeklyMinLeft? }` (0–100). A missing file is an empty config; invalid JSON
  or schema → `SpecrunError('config-invalid', '~/.specrun/config.json is invalid', issues)`. The
  repo config gets `limits.accounts`: a record `name → partial limits`, default `{}`.
- **MAD-3** — Per field: repo `limits.accounts.<name>` > global `accounts[].limits` > repo
  `limits.sessionMinLeft / weeklyMinLeft` > defaults (15 / 5).
- **MAD-4** — The order of `accounts` is the priority; the first account is the priority account.
- **MAD-5 (schema part only)** — `token` is `{ "env": "<VAR>" }` or `{ "command": "<shell command>" }`
  (both strings non-empty, strict objects). An account without `token` uses the system login;
  at most one account may omit it. Resolving the token is MA-2.
- **MAD-6** — No accounts configured → one implicit account `default` (`IMPLICIT_ACCOUNT`),
  system login, limits from the repo config.
- **MAD-17** — A name in repo `limits.accounts` that the global config doesn't define yields a
  warning `limits.accounts.<name>: no such account in ~/.specrun/config.json`, never an error.
  The warning appears only when the global config defines accounts.

## Read first

- `src/config/configSchema.ts` — `LimitsSchema`, `ConfigSchema` and the `prefault({})` comment.
  This is where `limits.accounts` goes.
- `src/config/loadConfig.ts` — `loadConfig`, `readJsonFile`, `formatIssues`, `LoadConfigDeps`:
  the pattern for `loadGlobalConfig`.
- `src/config/loadConfig.spec.ts` — temp-dir test pattern for the new loader test.
- `src/config/configSchema.spec.ts` — where the `limits.accounts` schema cases go.
- `src/errors.ts` — `SpecrunErrorCode`.
- `README.md` lines 223–245 — Configuration table to extend.

## Changes

- `src/config/configSchema.ts`:
  - Export `AccountLimitsSchema`: a strict partial of the two limit fields with the same bounds.
  - Export type `AccountLimits = { sessionMinLeft: number; weeklyMinLeft: number }`.
  - `LimitsSchema` gains `accounts: z.record(z.string(), AccountLimitsSchema).default({})`.
- New `src/config/globalConfig.ts`:
  - `GLOBAL_CONFIG_FILE = '.specrun/config.json'`, relative to the home dir.
  - `TokenSourceSchema` (union of the two strict objects) and `type TokenSource`.
  - `GlobalConfigSchema` with the unique-name and at-most-one-tokenless checks (`superRefine`,
    issue on the offending `accounts.<i>.name` / `accounts.<i>`). Type `GlobalConfig`.
  - `loadGlobalConfig(deps: { homedir: () => string }): GlobalConfig`.
- New `src/accounts/accounts.ts`:
  - `IMPLICIT_ACCOUNT = 'default'`.
  - `type Account = { name: string; token: TokenSource | null; limits: AccountLimits }`.
  - `resolveAccounts(config: Config, global: GlobalConfig): { accounts: Account[]; warnings: string[] }`:
    returns the accounts in priority order with limits merged per MAD-3, or the implicit
    account (MAD-6), plus the MAD-17 warnings. Pure.
- `src/errors.ts`: add the codes `account-unknown` and `account-token` (used by MA-2 / MA-6).
- `CLAUDE.md` Layout: add `accounts/    Claude accounts: global config, tokens, child env`.
- `README.md` Configuration: add a row for `limits.accounts`. Add a short "Global config"
  paragraph with the `~/.specrun/config.json` example (a priority account with
  `{ "env": "SPECRUN_PRO2_TOKEN" }` and limits 10 / 5, then a tokenless fallback with 30 / 20)
  and the precedence of MAD-3. Use placeholder names, never real ones.

## Done when

- `src/config/globalConfig.spec.ts` (temp home dir) checks:
  - a missing file → `{ accounts: [] }`;
  - a valid file parses with both token kinds;
  - broken JSON, a duplicate name, two tokenless accounts, a bad name and an unknown key each
    → `config-invalid` with one detail per issue.
- `src/accounts/accounts.spec.ts` checks:
  - no global accounts → only `default` with the repo limits;
  - the order is kept;
  - each precedence level of MAD-3 wins over the next one, per field;
  - an unknown override name → one warning when accounts exist, none without them.
- `configSchema.spec.ts`: `limits.accounts` defaults to `{}`, a partial override parses, and an
  unknown key inside an override fails.
- Existing `loadConfig.spec.ts` and `configSchema.spec.ts` cases pass unchanged.
