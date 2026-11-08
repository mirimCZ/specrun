# specrun v1 — Implementation Progress

Updated by each implementation run (see [TASK_PROMPT.md](TASK_PROMPT.md); runner:
`tools/spec-run.sh v1 1` — runs on branch `v1/phase-1`). Task briefs and their implementation
notes are in [tasks/](tasks/). Statuses: `todo` · `in progress` · `done` · `blocked`.

## Run log

- 2026-11-08 — SR-1 blocked: Bash permissions denied every command (typecheck, tests, git).

## Tasks

| Phase | Task  | Title                                             | Status | Commit | Notes |
| ----- | ----- | ------------------------------------------------- | ------ | ------ | ----- |
| 1     | SR-1  | Config and spec.json schemas + loaders            | blocked |        | Every Bash command (npm run typecheck, npx vitest, tools/spec-verify.sh, git status) was denied "requires approval" — code written but unverified and uncommitted (untracked files in src/errors.ts, src/config/, src/spec/) |
| 1     | SR-2  | Event log, state reducer, PROGRESS.md view        | todo   |        |       |
| 1     | SR-3  | Git worktree, commits, parking; verify steps      | todo   |        |       |
| 1     | SR-4  | Usage windows, pause policy, waiting              | todo   |        |       |
| 1     | SR-5  | Runner protocol, prompt, specrun tools            | todo   |        |       |
| 1     | SR-6  | Agent session (SDK) and transcripts               | todo   |        |       |
| 1     | SR-7  | Runner orchestration loop                         | todo   |        |       |
| 1     | SR-8  | Session analytics                                 | todo   |        |       |
| 1     | SR-9  | CLI: init, run (line reporter), status, set       | todo   |        |       |
| 1     | SR-10 | CLI: stats, calibrate, deviations, analyze        | todo   |        |       |
| 1     | SR-11 | Ink dashboard                                     | todo   |        |       |
| 1     | SR-12 | Plugin: marketplace, refine and write-spec skills | todo   |        |       |
| 1     | SR-13 | Feedback skill                                    | todo   |        |       |

### Dependencies

Read by `tools/spec-run.sh`: a task runs only when every task it needs is `done`, and its prompt
gets their implementation notes.

| Task  | Needs                        |
| ----- | ---------------------------- |
| SR-1  | —                            |
| SR-2  | SR-1                         |
| SR-3  | SR-1                         |
| SR-4  | SR-1                         |
| SR-5  | SR-2                         |
| SR-6  | SR-4, SR-5                   |
| SR-7  | SR-2, SR-3, SR-4, SR-5, SR-6 |
| SR-8  | SR-2, SR-6, SR-7             |
| SR-9  | SR-7                         |
| SR-10 | SR-8, SR-9                   |
| SR-11 | SR-9                         |
| SR-12 | SR-9                         |
| SR-13 | SR-10, SR-12                 |
