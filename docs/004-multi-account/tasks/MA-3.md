# MA-3 — Account env for task sessions and the probe

Phase 1 · Needs: — · Implements: MAD-1, MAD-16 (session side)

Lets the caller choose the child env of a task session and of a usage probe, so a session can
run on another Claude account. The runner keeps passing no override until MA-5.

## Decisions

- **MAD-1** — An account with a token runs its CLI processes (task sessions, usage probes) with
  `CLAUDE_CODE_OAUTH_TOKEN=<token>` in the child env. specrun never sets `CLAUDE_CONFIG_DIR`;
  `~/.claude` stays shared.
- **MAD-16 (session side)** — For the system login there is no override: the SDK's child
  inherits `process.env`, so `options.env` is left out entirely. The env passed in already
  contains everything (built by MA-2's `accountEnv`). The session layer passes it through and
  never merges it.

## Read first

- `src/session/agentSession.ts` — `SegmentInput`: add the field here.
- `src/session/sdkSession.ts` lines 141–235 — where `options` for `query()` is built.
- `src/session/sdkSession.spec.ts` — test "passes tools, permissions, settings, model and turns to
  query()" (line 70) is the pattern and the guard.
- `src/session/probeUsage.ts` — `ProbeUsageDeps` and the `query()` options at line 33.
- `src/session/probeUsage.spec.ts` — fake query pattern.
- `src/runner/runSpec.ts` lines 480–492 — the `deps.session.run({...})` call that must pass the
  new field.

## Changes

- `src/session/agentSession.ts`: `SegmentInput` gains
  `env: Readonly<Record<string, string | undefined>> | null`. Its doc comment says that null
  means inherit `process.env`.
- `src/session/sdkSession.ts`: when `input.env !== null`, set `options.env` to a plain copy of
  it; otherwise leave `env` out of `options`.
- `src/session/probeUsage.ts`: `ProbeUsageDeps` gains `env?: Readonly<Record<string, string | undefined>>`.
  When it is set, add `env` to the probe's `query()` options.
- `src/runner/runSpec.ts`: pass `env: null` in the `deps.session.run` input (MA-5 replaces it).
- Update `test/fakes/fakeSession.ts` only if its types require it. It records inputs, so tests
  can assert `env` later.

## Done when

- `sdkSession.spec.ts`: a new case asserts that `options.env` equals the given env. The existing
  case asserts that `env` is absent when `input.env` is null (extend its expectation, don't
  rewrite the case).
- `probeUsage.spec.ts`: one case with `env` (passed to `query()`) and one without it (absent).
- All existing session, probe and runner tests pass unchanged.
