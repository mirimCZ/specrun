# SR-1 — Config and spec.json schemas + loaders

Phase 1 · Needs: — · Implements: SRD-1, SRD-19, SRD-20, SRD-11 (size ranges)

The two authored inputs of specrun get zod schemas and loaders that fail with every problem
listed: the project config `specrun.config.json` and a spec's `docs/<spec>/spec.json`. Also the
shared error type every later module throws.

## Decisions

- **SRD-1** — Node ≥ 22, ESM, TypeScript strict, vitest, Prettier. All schemas use **zod v4**
  (required by the SDK's `tool()`; one validation library).
- **SRD-19** — `specrun.config.json` in the repo root, all keys optional except `verify`:
  `specsDir` (`"docs"`), `verify` (`{ name, command }[]`, ≥ 1, run with `sh -c` in the
  worktree), `setup` (string | null, default null), `models` (`{ default: "sonnet", strong:
"opus" }`), `maxTurns` (150), `verifyFixRounds` (2), `limits` (`{ sessionMinLeft: 15,
weeklyMinLeft: 5 }`), `sizes` (SRD-11), `transcriptsDir` (`"~/.specrun/runs"`),
  `commitTrailers` (string[], default []). Unknown keys are an error.
- **SRD-11** (this part) — sizes `S` · `M` · `L`; defaults S `{ turns: [10, 25], usd: 0.6 }`,
  M `{ turns: [20, 45], usd: 1.2 }`, L `{ turns: [40, 70], usd: 2.5 }`.
- **SRD-20** — `spec.json`: `{ title: string, branch?: string, tasks: { id, title, phase (int ≥ 1),
needs (id[]), model ("default" | "strong"), size ("S" | "M" | "L") }[] }`. Task ids match
  `^[A-Z][A-Z0-9]*-[0-9]+$` and are unique; `needs` reference existing ids, no cycles, a task
  never needs a task of a later phase; every task has `tasks/<id>.md`. The spec name is the
  folder name. Invalid specs fail on load with every problem listed.

## Read first

- `CLAUDE.md` — conventions (zod, injected deps, `SpecrunError`, explicit return types).
- `docs/testing.md` — temp dirs, no `vi.mock`.
- `src/cli/program.ts` + `program.spec.ts` — module and spec style to follow.
- `tsconfig.json` — `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` are on.

## Changes

- New `src/errors.ts`: `class SpecrunError extends Error` with `readonly code: SpecrunErrorCode`
  (string union, start with `'config-invalid' | 'config-missing' | 'spec-invalid' |
'spec-missing'`; later tasks extend it) and optional `details: string[]` (one line per
  problem). Message = summary line + details.
- New `src/config/configSchema.ts`: `ConfigSchema` (strict object, defaults applied by zod),
  `SizeSchema` (`turns: [min, max]` with min ≤ max, `usd` > 0), `type Config`, `type Size`,
  `type SizeName = 'S' | 'M' | 'L'`, `DEFAULT_SIZES`.
- New `src/config/loadConfig.ts`: `findRepoRoot(cwd): string` (walks up to the directory holding
  `.git` — file or folder, worktrees have a `.git` file) and
  `loadConfig(repoRoot): Config` — reads `specrun.config.json`, `config-missing` when absent,
  `config-invalid` with one detail per zod issue (`path: message`). Expands a leading `~/` in
  `transcriptsDir` to the home directory (`os.homedir()`, injectable for tests).
- New `src/spec/specSchema.ts`: `SpecSchema`, `TaskSchema`, `type Spec`, `type SpecTask`,
  `TASK_ID_PATTERN`.
- New `src/spec/loadSpec.ts`: `specDir(repoRoot, config, name)`,
  `loadSpec(repoRoot, config, name): LoadedSpec` where
  `LoadedSpec = { name, dir, spec, briefPath(id): string, taskPromptPath: string | null }`
  (`TASK_PROMPT.md` in the spec dir, null when absent). Validation after the schema, all problems
  collected: duplicate ids, unknown `needs`, self-dependency, cycles (report one cycle path
  `A-1 → A-2 → A-1`), a dependency on a later phase, missing brief files.
  `listSpecs(repoRoot, config): string[]` — folders under `specsDir` that contain `spec.json`.
- New `src/spec/taskOrder.ts`: `topologicalOrder(spec): SpecTask[]` — phase first, then
  dependency order, ties by the order in `spec.json` (used by the runner and PROGRESS.md).

## Done when

- `configSchema.spec.ts` / `loadConfig.spec.ts`: defaults filled for a minimal config
  (`{ verify: [...] }`), unknown key rejected, empty `verify` rejected, `turns` min > max
  rejected, missing file → `config-missing`, `~/` expanded, `findRepoRoot` from a nested dir and
  from a dir with a `.git` file.
- `loadSpec.spec.ts`: a valid spec loads; each validation problem is reported, and several at
  once are all listed in `details`; `listSpecs` ignores folders without `spec.json`.
- `taskOrder.spec.ts`: phase ordering, dependency ordering, stable ties.
- `tools/spec-verify.sh` green.

## Implementation notes

<!-- Filled in by the implementing agent: files, exported names, deviations. -->
