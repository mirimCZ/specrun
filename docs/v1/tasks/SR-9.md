# SR-9 — CLI: init, run (line reporter), status, set

Phase 1 · Needs: SR-7 · Implements: SRD-2 (commands), SRD-4, SRD-7 (`.specrun/` ignore), SRD-25

The first usable `specrun`: initialize a project, run a spec with plain log output, show the
state from any terminal, and override a task's status by hand.

## Decisions

- **SRD-2** — commander subcommands `init`, `run`, `status`, `set` (this task); `run` uses a
  plain line reporter when stdout is not a TTY or with `--no-ui` (the Ink dashboard comes in
  SR-11 — until then always the line reporter).
- **SRD-4** — foreground; `status` works from another terminal while a run is active (reads the
  worktree's `events.jsonl` when the worktree exists, else the checkout's; shows "running (pid
  N)" when the lock's pid is alive); macOS keep-awake during `run`.
- **SRD-5** — `specrun set` is the only other writer of `events.jsonl` (`manual.status`).
- **SRD-7** — `specrun init` adds `.specrun/` to `.gitignore`.
- **SRD-25** — exit codes 0 / 1 / 75 / 130; Ctrl-C aborts the current session via the signal.

## Read first

- `CLAUDE.md`, `docs/testing.md`.
- `src/cli/program.ts`, `src/cli/main.ts`, `src/cli/program.spec.ts` — where commands register.
- SR-7 notes below — `runSpec`, `RunReporter`, `acquireLock`.
- The modules the commands wire up (only SR-7's notes are attached): list their exports with
  `grep -n '^export' src/{config,spec,events,progress,limits,session}/*.ts` — `loadConfig`,
  `findRepoRoot`, `loadSpec`, `listSpecs`, `deriveState`, `keepAwake`, `systemClock`,
  `createSdkSession`, `probeUsage`.

## Changes

- `src/cli/program.ts`: register commands from `src/cli/commands/*.ts`; each exports
  `register(program, deps)` with `deps = { cwd, stdout, stderr, env, now }` for tests.
  `SpecrunError` → message + details on stderr, exit 1 (in `main.ts` only).
- New `src/cli/commands/init.ts`: `specrun init [--force]` — writes `specrun.config.json`
  (`verify` guessed from `package.json` scripts `typecheck` / `lint` / `test`, else one
  placeholder step `echo "configure verify steps"` that exits 1 so a run can't silently pass),
  appends `.specrun/` to `.gitignore` and `**/events.jsonl merge=union` to `.gitattributes`
  (idempotent), refuses to overwrite a config without `--force`.
- New `src/cli/commands/run.ts`: `specrun run <spec> [--task <id>] [--retry-blocked]
[--all-phases] [--base <ref>] [--model <alias>] [--no-ui]` — builds real deps, starts
  keep-awake, AbortController on SIGINT/SIGTERM, `process.exitCode = result.exitCode`.
- New `src/cli/lineReporter.ts`: `createLineReporter(write, { color })` — one timestamped line
  per persisted event (task start/finish with stats `42 turns · peak 58k · $0.50`, verify
  result, wait with the target time, block reason) and per tool use (`🔧 Edit src/x.ts`);
  `waiting` prints one line every 10 min, not every tick.
- New `src/cli/commands/status.ts`: `specrun status [spec] [--json]` — without a spec, one
  line per spec (`name  done/total  blocked  running`); with a spec, the task table (id, title,
  size, model, status, turns, cost) and the worktree/branch/lock info.
- New `src/cli/commands/set.ts`: `specrun set <spec> <task> <todo|done|blocked> --reason <text>`
  — appends `manual.status` to the active events file (worktree if present); refuses while a run
  holds the lock.

## Done when

- `init.spec.ts`: config guessed from scripts, placeholder otherwise, idempotent ignore /
  attributes lines, no overwrite without `--force`.
- `lineReporter.spec.ts`: lines for the main event types, waiting throttled.
- `status.spec.ts` / `set.spec.ts` on temp repos with hand-written events: tables, `--json`,
  worktree file preferred, lock refusal.
- `run.spec.ts`: argument parsing → `runSpec` options (inject a fake `runSpec`), exit code set.
- `npm run build && node dist/cli/main.js --help` lists the four commands.
- `tools/spec-verify.sh` green.

## Implementation notes

<!-- Filled in by the implementing agent: files, exported names, deviations. -->
