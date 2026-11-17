# PL-5 — Resolve absolute --file paths

Phase 1 · Needs: PL-2 · Implements: PLD-12

Fix from the deviation review of PL-2: `specrun plan --file` reads the request with
`join(cwd, file)`, which turns an absolute path such as `/tmp/req.md` into `<cwd>/tmp/req.md`
and fails as unreadable. Relative paths keep resolving against the cwd.

## Decisions

- **PLD-12** — `--file` is resolved against the cwd with `resolve` (absolute paths as given); an unreadable file throws `SpecrunError('spec-invalid')` naming the file.

## Read first

- `src/cli/commands/plan.ts` — `readRequest` (around line 144)
- `src/cli/commands/plan.spec.ts` — the existing command tests (temp repo, fake launcher)
- `docs/testing.md` — temp dir rules

## Changes

- `src/cli/commands/plan.ts`: `readRequest` uses `resolve(cwd, file)` from `node:path` instead of `join`.
- `src/cli/commands/plan.spec.ts`: new cases.

## Done when

- `plan.spec.ts` (with `--print`, so nothing is launched):
  - an absolute `--file` path (a file in the temp dir) puts its content inside `<request>` tags,
  - a relative `--file` path resolves against `deps.cwd`,
  - a missing file throws `spec-invalid` naming the file.
- Existing plan tests unchanged and green.
