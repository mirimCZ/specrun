# SR-7 — Runner orchestration loop

Phase 1 · Needs: SR-2, SR-3, SR-4, SR-5, SR-6 · Implements: SRD-4 (lock), SRD-6, SRD-8 (checkpoints), SRD-10, SRD-12, SRD-24, SRD-25

Wires everything into `runSpec()`: pick the next task, run its session segments through
verification and limit waits, commit or block, append events, regenerate PROGRESS.md, stop at
phase checkpoints. Tested only with fakes — this is the logic that must never surprise.

## Decisions

- **SRD-6** — after `complete_task` run verify; red → resume the same session with the failure
  summary, ≤ `verifyFixRounds` times, then block (`source: verify`); green → commit. HEAD moved
  during a session → `git reset --soft` to the pre-session commit, keep changes, record
  `protocol.violation`.
- **SRD-8** — stop once every task of the lowest unfinished phase is `done` or `blocked`,
  unless `allPhases`.
- **SRD-10** — before each task and each resume check usage (session low → wait for reset +
  60 s; weekly low → stop, exit 75). Limit hit in a session → wait, resume the same session.
  An `interrupted` task (crash / Ctrl-C) is resumed by the next run (`crash-resume`).
- **SRD-12** — on commit or block, append `budget.exceeded` when total turns or cost exceed the
  task size's upper bound. Only `maxTurns` per session stops anything.
- **SRD-22** — blocked → park changes under `refs/specrun/parked/<spec>/<task>`, reset + clean.
- **SRD-24** — commit includes `events.jsonl` + regenerated `PROGRESS.md`; leftover events
  after the last task commit → `chore(specrun): <spec> run log` commit at the end of the run.
- **SRD-4** — lock `.specrun/locks/<spec>.lock` (pid); a stale lock (dead pid) is taken over.
- **SRD-25** — exit codes 0 done/checkpoint, 1 failure, 75 weekly stop, 130 interrupted.

## Algorithm (per task, in `runnableTasks` order)

1. `pause check` (SR-4 `decide` on the latest snapshot; probe if older than 10 min) → wait
   (`limit.wait`) / stop (`run.finished paused-weekly`).
2. Segment loop with `reason` start | crash-resume (task `interrupted`): append
   `session.started` (prompt parts), run `AgentSession`, append `session.finished` (+
   `usage.snapshot` from the observer's last snapshot). Check HEAD (violation handling).
3. Outcome `completed` → `task.completed`, verify (`verify.finished`); green → commit
   (`task.committed`) and next task; red with rounds left → segment with `verify-fix` and
   `verifyFailedPrompt`; red without rounds → block (verify).
4. `limit` → `limit.wait` until `limitHitTarget`, then segment `limit-resume`.
5. `no-call` → one `nudge` segment; again no call → block (protocol). `blocked` → block
   (agent, with `kind`). `max-turns` → block (max-turns). `error` → block (error).
   `interrupted` (abort signal) → append `run.finished interrupted`, release lock, exit 130.
6. After commit/block: `budget.exceeded` check; regenerate PROGRESS.md before committing.
7. After each task: if the lowest open phase changed and not `allPhases` → checkpoint stop.

## Read first

- `CLAUDE.md`, `docs/testing.md`.
- Notes below of SR-2 (`createEventStore`, `deriveState`, `runnableTasks`, `lowestOpenPhase`,
  `renderProgress`), SR-3 (`createGit`, `ensureWorktree`, `runVerify`, `buildCommitMessage`),
  SR-4 (`decide`, `limitHitTarget`, `waitUntil`, fake clock), SR-5 (`buildPrompt`,
  `followUps`, `loadProtocol`), SR-6 (`AgentSession`, fakes). Config / spec loading (SR-1):
  `grep -n '^export' src/config/*.ts src/spec/*.ts`.
- `tools/spec-run.sh` main loop + `tools/spec-autorun.sh` `run_phase` — the old behaviour this
  replaces (for comparison, not to copy).

## Changes

- New `src/runner/runSpec.ts`: `runSpec(options, deps): Promise<RunResult>`;
  `options = { spec: string, base, taskFilter?: string, retryBlocked, allPhases, modelOverride? }`;
  `deps = { repoRoot, config, session: AgentSession, run: ProcessRunner, clock, probeUsage,
reporter: RunReporter, signal, version }`. `RunResult = { exitCode: 0 | 1 | 75 | 130,
reason }`. Errors from deps are caught: append `run.finished failed`, release lock, exit 1.
- New `src/runner/reporter.ts`: `RunReporter` — typed live updates for UIs, not persisted:
  `{ event(e: SpecrunEvent), activity({ task, tool, detail }), turn({ task, turns, context,
costUsd }), waiting({ until, reason }), log(level, message) }`; `nullReporter`.
- New `src/runner/lock.ts`: `acquireLock(file, pid, isAlive)` → `{ release() }`;
  `SpecrunError('locked')` with the holder's pid.
- New `test/fakes/fakeSession.ts`: scripted `AgentSession` (per call: outcome, tool call,
  stats, optional file edits applied to the worktree to simulate the agent, optional
  `git commit` to simulate a violation).

## Done when

`runSpec.spec.ts` on a real temp repo + worktree with fake session / clock / probe and real git
and verify (`sh -c` steps that pass or fail per round via a counter file):

- happy path: two dependent tasks → two commits with trailers, events + PROGRESS.md in them,
  exit 0; second task's prompt contains the first task's notes;
- verify red then green → `verify-fix` segment on the same session, one commit;
- verify red beyond `verifyFixRounds` → blocked (verify), work parked, worktree clean, next
  independent task still runs; dependent task skipped;
- limit outcome → `limit.wait` + `limit-resume` with the same session id; session low before a
  task → wait; weekly low → exit 75;
- no-call → nudge → block (protocol); agent commit → soft reset + `protocol.violation`;
- crash: an `interrupted` task from a previous run resumes with `crash-resume`;
- checkpoint: phase 1 done → stops before phase 2 unless `allPhases`;
- `budget.exceeded` appended; lock held by a live pid → `locked`, stale lock taken over;
- `tools/spec-verify.sh` green.

## Implementation notes

- `src/runner/runSpec.ts`: `runSpec(options: RunSpecOptions, deps: RunSpecDeps)` → `RunResult` `{ exitCode,
reason, message? }`; deps as briefed + optional `pid`/`isAlive`; `probeUsage: () => Promise<UsageSnapshot | null>`.
  `session.finished` is appended right after `deps.session.run` in `runTask` (SR-8 hooks in there).
- `src/runner/reporter.ts`: `RunReporter`, `nullReporter`, `ActivityUpdate`, `TurnUpdate` (`costUsd` = the
  task's finished segments; the SDK reports cost only at a segment end), `WaitingUpdate`, `ReporterLevel`.
- `src/runner/lock.ts`: `acquireLock`, `lockFile(repoRoot, spec)`, `readLockPid`, `isProcessAlive`; new
  `SpecrunError` code `locked`. `test/fakes/fakeSession.ts`: `createFakeSession(segments, { gitEnv })` →
  `AgentSession & { inputs }`, ids `session-<n>`, `DEFAULT_PAYLOAD`; unscripted calls → outcome `error`.
- Paths: spec, events, PROGRESS.md from the **worktree** (`spec.branch` from the checkout's copy); verify logs
  `<repoRoot>/.specrun/logs/<spec>/<task>-verify-<round>.log`.
- Added `Git.commitPaths(message, paths)`: run-log commits stage only events + PROGRESS.md (never agent work).
- Decision: `task.committed` can't be in its own commit → lands in the next one; the task commit's PROGRESS.md
  previews the task `done`. Every run ends with a `run log` commit (also on 130). Block: `task.blocked` →
  run-log commit → park (parking resets the worktree, which would drop uncommitted events).
- Decision: setup failures (lock, spec, worktree) throw — no log yet. Follow-up segments record prompt parts
  as 0. Pause check before every segment. `taskFilter` ignores phases (not runnable → `failed`); phase stuck
  on blocked deps → `done` + message; a task blocked in this run isn't retried in the same run.
