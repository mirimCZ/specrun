# specrun v1 — Implementation Progress

Updated by each implementation run (see [TASK_PROMPT.md](TASK_PROMPT.md); runner:
`tools/spec-run.sh v1 1` — runs on branch `v1/phase-1`). Task briefs and their implementation
notes are in [tasks/](tasks/). Statuses: `todo` · `in progress` · `done` · `blocked`.

## Run log

- 2026-11-08 — SR-1 blocked: Bash permissions denied every command (typecheck, tests, git).
- 2026-11-09 — SR-1 done.
- 2026-11-09 — SR-2 done.
- 2026-11-09 — SR-3 done.
- 2026-11-09 — SR-4 done.
- 2026-11-09 — SR-5 done.
- 2026-11-09 — SR-6 done.
- 2026-11-09 — SR-7 done.
- 2026-11-09 — SR-8 done.
- 2026-11-09 — SR-9 done.
- 2026-11-09 — SR-10 done.
- 2026-11-09 — SR-12 done.
- 2026-11-09 — SR-13 done.

## Tasks

| Phase | Task  | Title                                             | Status  | Commit | Notes                                                                                                                                      |
| ----- | ----- | ------------------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | SR-1  | Config and spec.json schemas + loaders            | done    |        | Schemas, loaders, topologicalOrder                                                                                                         |
| 1     | SR-2  | Event log, state reducer, PROGRESS.md view        | done    |        | Event schema/store, deriveState, renderProgress                                                                                            |
| 1     | SR-3  | Git worktree, commits, parking; verify steps      | done    |        | Git API, worktree, commit message, runVerify                                                                                               |
| 1     | SR-4  | Usage windows, pause policy, waiting              | done    |        | Usage snapshots, decide/waitTarget, waitUntil                                                                                              |
| 1     | SR-5  | Runner protocol, prompt, specrun tools            | done    |        | protocol.md, specrun MCP tools, buildPrompt                                                                                                |
| 1     | SR-6  | Agent session (SDK) and transcripts               | done    |        | sdkSession, transcripts, probeUsage, fakeQuery                                                                                             |
| 1     | SR-7  | Runner orchestration loop                         | done    |        | runSpec, reporter, lock, fakeSession                                                                                                       |
| 1     | SR-8  | Session analytics                                 | done    |        | analyzeSession, recordAnalytics, latestMetrics                                                                                             |
| 1     | SR-9  | CLI: init, run (line reporter), status, set       | done    |        | init/run/status/set, lineReporter, cliDeps                                                                                                 |
| 1     | SR-10 | CLI: stats, calibrate, deviations, analyze        | done    |        | stats/deviations/analyze, json-output.md                                                                                                   |
| 1     | SR-11 | Ink dashboard                                     | blocked |        | `npm install` of ink, react, @types/react, ink-testing-library needs approval and was denied unattended; packages absent from node_modules |
| 1     | SR-12 | Plugin: marketplace, refine and write-spec skills | done    |        | marketplace + plugin, refine/write-spec skills; `claude plugin validate` needed approval, not run                                          |
| 1     | SR-13 | Feedback skill                                    | done    |        | feedback skill: stats/deviations/analyze signals → numbered proposals                                                                      |

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

## Run stats

Appended by `tools/spec-run.sh` after every finished task session (`Attempt` counts usage-limit
restarts; stats of interrupted attempts are only in the log dir's `stats.tsv`).

| Task  | Date       | Model  | Result  | Attempt | Turns | Peak context | Cache read | Cache write | Output | Cost  |
| ----- | ---------- | ------ | ------- | ------- | ----- | ------------ | ---------- | ----------- | ------ | ----- |
| SR-1  | 2026-11-08 | opus   | done    | 1       | 15    | 33k          | 0.3M       | 30k         | 4k     | $0.38 |
| SR-2  | 2026-11-08 | opus   | done    | 1       | 31    | 68k          | 1.0M       | 63k         | 37k    | $1.44 |
| SR-3  | 2026-11-08 | sonnet | done    | 1       | 21    | 38k          | 0.3M       | 35k         | 20k    | $0.36 |
| SR-4  | 2026-11-08 | sonnet | done    | 1       | 25    | 38k          | 0.3M       | 33k         | 19k    | $0.35 |
| SR-5  | 2026-11-08 | opus   | done    | 1       | 35    | 62k          | 1.0M       | 57k         | 24k    | $1.13 |
| SR-6  | 2026-11-08 | opus   | done    | 1       | 38    | 83k          | 1.8M       | 78k         | 42k    | $1.82 |
| SR-7  | 2026-11-09 | opus   | done    | 1       | 35    | 120k         | 2.3M       | 115k        | 55k    | $2.49 |
| SR-8  | 2026-11-09 | sonnet | done    | 1       | 40    | 70k          | 0.9M       | 65k         | 32k    | $0.67 |
| SR-9  | 2026-11-09 | sonnet | done    | 1       | 35    | 71k          | 1.0M       | 65k         | 28k    | $0.63 |
| SR-10 | 2026-11-09 | sonnet | done    | 1       | 35    | 77k          | 1.1M       | 71k         | 35k    | $0.75 |
| SR-11 | 2026-11-09 | sonnet | blocked | 1       | 14    | 23k          | 0.2M       | 20k         | 2k     | $0.13 |
| SR-12 | 2026-11-09 | opus   | done    | 1       | 46    | 62k          | 1.3M       | 59k         | 25k    | $1.23 |
| SR-13 | 2026-11-09 | sonnet | done    | 1       | 6     | 22k          | 0.1M       | 17k         | 4k     | $0.11 |
