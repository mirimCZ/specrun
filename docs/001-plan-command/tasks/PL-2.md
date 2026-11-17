# PL-2 — specrun plan command

Phase 1 · Needs: PL-1 · Implements: PLD-1, PLD-2, PLD-3, PLD-4, PLD-5

`specrun plan -n <name>` resolves or creates the spec folder, writes a minimal context file,
hands the terminal to Claude Code with a known session id and records a `plan.session` event
afterwards. PL-1's notes name the transcript reader and the event schema.

## Decisions

- **PLD-1** — `specrun plan -n, --name <name> [-f, --file <request.md>] [--resume] [--print]`. `--name` is required and must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`; a name starting with digits followed by `-` (e.g. `005-foo`) is rejected with the hint to pass the name without the number.
- **PLD-2** — Active folder `<specsDir>/<digits>-<name>` exists → continue it (no new number). Archived folder `<specsDir>/archive/<digits>-<name>` exists → `SpecrunError('spec-invalid')`, hint "choose another name". Otherwise `NNN` = highest leading number of any folder name in `<specsDir>` and `<specsDir>/archive` + 1, zero-padded to 3 digits (`001` when none), and the folder is created before launching. A spec with a worktree (`specWorkspace(...).kind !== 'checkout'`) is refused: "edit the spec in its worktree".
- **PLD-3** — New session: `claude --session-id <uuid> -n "plan <spec>" --append-system-prompt-file <repo>/.specrun/plan/<spec>.md "/specrun:plan <spec>"`. `--resume`: the session id of the spec's latest `plan.session` event → `claude --resume <id> --append-system-prompt-file <file> "Continue planning <spec>."`; no earlier session → `SpecrunError('spec-invalid')`. No terminal → `SpecrunError('terminal-required')` (hint: `--print`). `--print` writes the context and the first message to stdout and creates no folder, file or event. `claude` failing to start → `SpecrunError('claude-missing')` like review.
- **PLD-4** — Only facts the model can't get cheaply, nothing gathered from other specs: the spec name and its folder (repo-relative); `new` or the list of files already in it; `specsDir`; the request from `--file` verbatim inside `<request>` tags, or the line "No request file — ask the user for the request."; and the instruction "Write the spec into exactly this folder; don't compute a new number." No deviations or other specs' content. Rendered by a pure function; written to `.specrun/plan/<spec>.md` (`.specrun/` is git-ignored).
- **PLD-5** — Whatever the exit code: find the transcript (PLD-7), compute metrics, append one `plan.session` event to `activeSpecFiles(repoRoot, config, spec).eventsFile` with `runId` `plan-<sessionId>`. Transcript not found or unreadable → `metrics: null` and a warning on stderr. Then print one summary line (turns, tokens in / out, cache read, peak context, or "no transcript found"). If `tasks.yaml` exists: "Next: specrun status <spec> — commit the spec folder (incl. events.jsonl) before specrun run". If not: "No tasks.yaml yet — specrun plan -n <name> continues". The command's exit code is claude's.
- Side effect (README §2): a folder whose session ended without `tasks.yaml` stays; `listSpecs` skips it.

## Read first

- `src/cli/commands/review.ts` — `runReview` / `register`: context file, `runInteractive`, errors, overrides, exit code (whole file)
- `src/cli/commands/review.spec.ts` — pattern for the command test (temp repo, fake launcher, `captureDeps`)
- `src/review/markReviewed.ts` — appending an event from the CLI (`createEventStore`, lines 35–50)
- `src/cli/cliDeps.ts` — `CliDeps`, `activeSpecFiles`
- `src/git/workspace.ts` — `specWorkspace` (worktree detection)
- `src/spec/loadSpec.ts` — `specDir`, `listSpecs`, `SPEC_FILE`
- `src/archive/history.ts` — `archiveRoot`
- `src/progress/renderProgress.ts` — `formatTokens` for the summary line
- `src/cli/program.ts` — registering the command

## Changes

- New `src/plan/specFolder.ts` + `specFolder.spec.ts`: `resolvePlanFolder(repoRoot, config, name)` → `{ spec: string; dir: string; created: boolean }` or throws (PLD-1, PLD-2). Split out `nextSpecNumber(names: readonly string[]): string` as a pure function. Creating the folder is a separate step, so `--print` creates nothing.
- New `src/plan/planContext.ts` + `planContext.spec.ts`: `renderPlanContext({ spec, dir, files, specsDir, request }): string` (PLD-4) and `planLaunchArgs(...)` building the PLD-3 argument lists.
- New `src/cli/commands/plan.ts` + `plan.spec.ts`: `register(program, deps, overrides)` with overrides `{ launch?, setExitCode?, newSessionId?, claudeConfigDir? }`. Context file to `.specrun/plan/<spec>.md`, launch, then PLD-5 using PL-1's reader and event.
- `src/cli/program.ts`: register `plan`.

## Done when

- `specFolder.spec.ts`:
  - numbering over active + archived folders (gaps, none → `001`, non-numbered folders ignored),
  - continue an existing `NNN-name`,
  - archived name and a numeric-prefixed name are refused,
  - a spec with a worktree is refused.
- `planContext.spec.ts`: new vs. existing files listed; request in `<request>` tags vs. the "ask the user" line; the exact launch args for new and resumed sessions.
- `plan.spec.ts` with a fake launcher and a transcript written into a temp `CLAUDE_CONFIG_DIR`:
  - a new spec gets the folder, the context file, one `plan.session` event with metrics and claude's exit code,
  - a missing transcript records `metrics: null` and warns,
  - `--resume` uses the latest session id, and without one it errors,
  - `--print` creates nothing,
  - non-interactive deps error,
  - the summary line differs with and without `tasks.yaml`.
- Existing review tests unchanged and green.
