---
id: run/dashboard
title: Run dashboard and controls
status: draft
depends_on:
  - run/orchestration
code:
  - src/ui/
  - src/cli/runControls.ts
  - src/cli/afterRun.ts
  - src/cli/lineReporter.ts
tests:
  - src/ui/Dashboard.spec.tsx
  - src/ui/dashboardStore.spec.ts
  - src/cli/runControls.spec.ts
  - src/cli/afterRun.spec.ts
  - src/cli/lineReporter.spec.ts
specs:
  - v1
---

# Run dashboard and controls

## Purpose

Shows a user what a run is doing and lets them stop it safely, in a terminal or in a log.
Design: [SRD-2, SRD-25, SRD-27, SRD-33](../../v1/README.md).

## Capabilities

- In a terminal the user sees a live log of milestones above every task with its state.
- The user sees the running task's progress: turns, context size, cost and current activity.
- The user sees the usage windows, or the countdown while the run waits.
- The user can ask to stop after the current task, which is still verified and committed or blocked.
- The user can cancel a pending stop and the run goes on.
- The user can interrupt immediately; the task is resumed on the next run.
- When output is not a terminal, or the user opts out of the dashboard, the run prints plain log lines instead.
- After a fully successful run in a terminal the user is offered the deviation review and then closing the specs.

## Expectations

- A stop request never abandons a task half-way, except for an explicit interrupt.
- An interrupt leaves state in files, so the next run resumes cleanly.
- The follow-up offers appear only after a complete run on a terminal, never in pipes or with the dashboard off.
- Stopping on request and interrupting yield different exit codes.

## Pitfalls

- Stop and cancel keys exist only in the dashboard; without it the interrupt key works the same two-step way.
