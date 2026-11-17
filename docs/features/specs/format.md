---
id: specs/format
title: Spec format and status
status: draft
depends_on:
  - insights/run-log
code:
  - src/spec/
  - src/cli/commands/status.ts
  - src/cli/commands/set.ts
tests:
  - src/spec/loadSpec.spec.ts
  - src/spec/taskOrder.spec.ts
  - src/cli/commands/status.spec.ts
  - src/cli/commands/set.spec.ts
specs:
  - v1
---

# Spec format and status

## Purpose

Defines what a spec is on disk (a task list plus one brief per task) and lets a user see and
correct where it stands. Design: [SRD-5, SRD-20](../../v1/README.md).

## Capabilities

- A user can describe a spec as a task list with ids, titles, phases, dependencies, model and size, plus one brief per task.
- A task can depend on named tasks or on all others; dependencies on later phases are rejected.
- A spec can add its own rules to every task's prompt.
- A user can validate a spec and gets every problem named (ids, needs, cycles, missing briefs).
- A user can see all specs at a glance, or one spec's task table, branch, worktree and lock.
- A user can get the same status as JSON for scripts.
- A user can override a task's status by hand, with a required reason that is recorded.

## Expectations

- The task list is authored by humans and never written by specrun.
- A task's status comes from the run log; a manual override is an event in it, not an edit.
- Task ids are unique and match the required pattern; dependency cycles are an error.
- Briefs are self-contained; a missing brief fails validation.

## Out of scope

- Writing the spec; that is `specs/authoring`.
