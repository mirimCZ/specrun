# CLAUDE.md — specrun

specrun runs implementation specs (`docs/<spec>/tasks.yaml` + one brief per task) task by task
with the Claude Agent SDK, unattended: dependencies first, waiting out plan usage limits,
verifying and committing on green, recording run analytics and deviations for feedback.
The design is the spec in [docs/v1/README.md](docs/v1/README.md) (decision log `SRD-*`).

## Layout

```
src/
  cli/        commander program + one file per subcommand (commands/<name>.ts)
  config/     specrun.config.json schema + loader
  spec/       tasks.yaml schema + loader (validation: ids, needs, cycles, briefs)
  events/     event schema, append-only JSONL store, state reducer
  progress/   generated PROGRESS.md
  git/        worktree, commit, parking of blocked work
  verify/     verify steps runner + failure summary
  limits/     plan usage windows, pause policy, waiting
  session/    Agent SDK session (AgentSession), specrun MCP tools, prompt, transcripts
  runner/     orchestration loop
  analytics/  per-session metrics from transcripts
  archive/    archiving finished specs (README + run history)
  review/     instructions + first message for the interactive deviation review
  ui/         Ink dashboard
plugin/       Claude Code plugin: skills refine, write-spec, feedback (.claude/skills links to them)
spikes/       throwaway experiments — don't import from src/
```

## Conventions

- TypeScript strict (see tsconfig: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
  ESM with `.js` import suffixes, Node ≥ 22. No `any` — `unknown` + narrowing (zod `parse`).
- **zod v4 for every schema** (config, tasks.yaml, events, tool inputs); types via `z.infer`.
- Explicit return types on exported functions. Discriminated unions over optional flags.
- Dependencies are injected: modules take a `deps` object (fs paths, clock, `spawn`, git runner,
  `AgentSession` factory) instead of importing side effects; no classes unless they hold state.
- No global state, no `process.exit` outside `src/cli/`. Errors: throw `SpecrunError` (code +
  message, `src/errors.ts`) for user-facing failures.
- Naming: `camelCase.ts` modules, `PascalCase.tsx` Ink components, `SCREAMING_CASE` constants.
- All code, comments and docs in English. Comments explain why, not what.
- Commits: Conventional Commits, scope = `src/` folder (`events`, `runner`, …) or `plugin`.

## Commands

`npm run typecheck` · `npm test` (vitest) · `npx vitest run <path>` · `npm run format` ·
`npm run check` (`verify:typecheck` → `verify:test` → `verify:format`, compact output; the gate
before every commit).
Prettier (`.prettierrc`, 100 columns) is the source of truth for formatting.

## Never

- Call the real Agent SDK, the network or `claude` from tests — use the fakes (docs/testing.md).
- Write `tasks.yaml` from the runner (authored file), or rewrite `events.jsonl` (append-only).
- Run git commands from the agent protocol side: the runner owns git (SRD-6).
- Add dependencies beyond the ones a task brief names.
