# SR-3 — Git worktree, commits, parking; verify steps

Phase 1 · Needs: SR-1 · Implements: SRD-6 (git + verify parts), SRD-7, SRD-8 (branch), SRD-22, SRD-24

Everything that spawns processes in the worktree: creating it, committing, parking blocked
work, detecting agent commits, and running the configured verify steps with a short failure
summary the runner hands back to the agent.

## Decisions

- **SRD-6** (this part) — the runner owns git; if HEAD moved during a session the runner
  `git reset --soft`s back to the pre-session commit, keeps the changes and records
  `protocol.violation`. Verify red → the failure summary goes back to the agent.
- **SRD-7** — worktree at `<main checkout>/.specrun/worktrees/<spec>`, created on the first run
  from `--base` (default `HEAD`) on the spec branch; the config's `setup` command runs once
  after creation.
- **SRD-8** (this part) — branch `specrun/<spec>` unless `spec.json` sets `branch`.
- **SRD-22** — blocked task: changes (tracked + untracked, not ignored) stored as a commit
  object under `refs/specrun/parked/<spec>/<task>` (`git add -A`, `write-tree`,
  `commit-tree -p HEAD`), then the worktree is reset to HEAD and cleaned.
- **SRD-24** — subject = agent's `commitMessage` with ` (<TASK>)` appended when it lacks the task
  id; body = `summary`; trailers `Specrun-Task: <id>`, `Specrun-Session: <sessionId>` and
  `commitTrailers`; stages everything (`git add -A`). Run-log commits:
  `chore(specrun): <spec> run log`.
- **SRD-19** — `verify` is `{ name, command }[]`, each run with `sh -c` in the worktree.

## Read first

- `CLAUDE.md`, `docs/testing.md` (git in tests).
- SR-1 notes below — `Config`, `LoadedSpec`, `SpecrunError`.
- `tools/spec-verify.sh` `report_failure` — which error lines are worth showing (tsc, vitest).
- `tools/spec-run.sh` `prepare_branch` — the old branch logic this replaces.

## Changes

- New `src/process/run.ts`: `runCommand(cmd, args, { cwd, env?, input?, timeoutMs? })` →
  `Promise<{ code, stdout, stderr, durationMs }>` via `node:child_process` `spawn` (no shell);
  `runShell(command, opts)` = `sh -c`. `type ProcessRunner` = the signature, injected everywhere.
- New `src/git/git.ts`: `createGit(cwd, run: ProcessRunner)` → small typed API: `head()`,
  `isClean()`, `branchExists(name)`, `addAll()`, `commit({ subject, body, trailers })` (message via
  stdin `-F -`, returns sha), `resetSoft(sha)`, `resetHardClean()` (`reset --hard` +
  `clean -fd`), `diffStat(from, to)` → `{ filesChanged, insertions, deletions }`,
  `changedFiles(from)` (incl. untracked), `parkChanges(ref, message)` (SRD-22, returns sha or
  null when clean), `updateRef`, `worktreeList()`. Errors → `SpecrunError('git-failed')` with
  the stderr.
- New `src/git/worktree.ts`: `ensureWorktree({ repoRoot, spec, branch, base, setup, run })` →
  `{ path, created }` — reuses an existing worktree for the branch, otherwise
  `git worktree add <path> <branch>` (or `-b <branch> <base>` when the branch doesn't exist),
  then runs `setup` with `runShell` (failure → `SpecrunError('setup-failed')`, worktree kept).
  Refuses a protected branch (`main`, `master`).
- New `src/git/commitMessage.ts`: `buildCommitMessage({ task, sessionId, payload, trailers })`
  (pure, SRD-24).
- New `src/verify/verify.ts`: `runVerify({ steps, cwd, logFile, run })` →
  `{ ok, durationMs, steps: { name, ok, durationMs }[], summary }` — stops at the first red
  step, writes each step's output under a `===== <name> =====` header to `logFile`;
  `summary` = failed step name + its error lines (TS errors, vitest FAIL/×/Assertion/
  Expected/Received/`❯ file:line`, otherwise the last 40 lines), capped at 80 lines, + the log
  path. Pure helper `summarizeFailure(stepName, output)` exported for tests.

## Done when

- `git.spec.ts` (real temp repos): commit with trailers and parsed sha, `isClean`,
  `changedFiles` includes untracked, `parkChanges` stores tracked + untracked changes in the
  ref and the worktree is clean afterwards (and `git show <ref>:<file>` has them),
  `resetSoft` keeps changes.
- `worktree.spec.ts`: creates branch + worktree from base, reuses it on the second call, runs
  `setup` once, refuses `main`.
- `commitMessage.spec.ts`: appends the task id only when missing; trailers order.
- `verify.spec.ts`: green steps, stop at the first red, summary extracts TS / vitest lines,
  falls back to the tail; log file written. Use `sh -c 'echo …; exit 1'` style commands.
- `tools/spec-verify.sh` green.

## Implementation notes

- Files: `src/process/run.ts` (`ProcessRunner`, `runCommand`, `runShell(command, opts, run = runCommand)`, `RunOptions`, `RunResult`; code -1 on spawn error/kill),
  `src/git/git.ts` (`createGit(cwd, run)` → `Git`, `DiffStat`, `WorktreeEntry`), `src/git/worktree.ts`
  (`ensureWorktree`, `worktreePath`, `PROTECTED_BRANCHES`), `src/git/commitMessage.ts` (`buildCommitMessage` →
  `{ subject, body, trailers }` = `CommitMessageParts`, which `git.commit` takes), `src/verify/verify.ts`
  (`runVerify`, `summarizeFailure`, `VerifyResult`).
- `SpecrunError` codes added: `git-failed`, `setup-failed`, `branch-protected` (protected branch; not in the brief).
- `commit` uses `--allow-empty` (a task may legitimately change nothing) and returns `HEAD` after committing.
- `ensureWorktree` reuses any worktree already checked out on the branch (found via `worktree list`), wherever it is.
  It takes `spec` only for the path; `branch`/`base` must be resolved by the caller (`spec.branch ?? specrun/<spec>`).
- `summarizeFailure` returns header + lines (≤ 79 lines); `runVerify` appends `Full log: <path>`. `durationMs` = sum of steps.
- `parkChanges` message goes via stdin; the caller builds `refs/specrun/parked/<spec>/<task>`.
- Nothing in other docs needed a "superseded by SR-3" note.
