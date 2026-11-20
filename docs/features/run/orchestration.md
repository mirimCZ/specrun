---
id: run/orchestration
title: Run orchestration
status: draft
depends_on:
  - run/workspace
  - run/verify-commit
  - run/limits
  - run/dashboard
  - run/accounts
  - specs/format
  - insights/run-log
code:
  - src/runner/
  - src/session/
  - src/cli/commands/run.ts
tests:
  - src/runner/runSpec.spec.ts
  - src/runner/runAll.spec.ts
  - src/runner/lock.spec.ts
  - src/session/buildPrompt.spec.ts
  - src/session/specrunTools.spec.ts
  - src/session/followUps.spec.ts
specs:
  - v1
  - 004-multi-account
---

# Run orchestration

## Purpose

Works through a spec's tasks unattended, one agent session per task, so a user can start a run
and come back to committed work. Design: [SRD-3, SRD-4, SRD-8, SRD-9](../../v1/README.md).

## Capabilities

- A user can run a spec and every task whose dependencies are done is worked on, the lowest open phase first.
- A user can run a single task of a spec instead of the whole list.
- Each task gets its own agent session, which sees the runner protocol, the spec's task rules, the task brief and the notes that its finished dependencies left.
- An agent ends its task by reporting it complete (summary, commit message, notes, deviations) or blocked (reason); the runner takes it from there.
- A user can run again after any interruption and the run continues where it stopped; an interrupted session is resumed with its context.
- A user can retry blocked tasks; tasks that need a blocked one wait instead of failing.
- A user can run every spec of the repository in one go, one after another in a shared workspace, and gets a summary row per spec.
- A user can preview that all-specs run (order, state, reasons it would refuse) without changing anything.
- A user can run with several Claude accounts; each session uses the account the run chose, see [run/accounts](accounts.md).
- A task that ends a session without a result gets a follow-up prompt asking for one before it is blocked.

## Expectations

- Only one run works on a spec at a time; a live lock refuses a second run.
- The agent only edits files; the runner owns git and `tasks.yaml` is never written by it.
- Task status is derived from the run log, never stored separately.
- A later phase may run while an earlier one waits for a blocked task; phases only order work.
- The all-specs run refuses to start while a spec has its own worktree or branch.
- A failing, stopped or interrupted spec ends the all-specs run with that spec's exit code.
- Without a global configuration the run uses one implicit account and behaves as before.
- Exit codes are stable: 0 done or stopped on request, 1 failure, 75 weekly limit, 130 interrupted.

## Pitfalls

- A session that reaches the turn limit blocks the task; the limit applies per session, not per task.

## Out of scope

- Running tasks of one spec in parallel.
