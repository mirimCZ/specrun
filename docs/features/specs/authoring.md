---
id: specs/authoring
title: Planning and writing specs
status: draft
depends_on:
  - specs/format
  - insights/run-log
  - insights/stats
  - knowledge/feature-map
code:
  - src/plan/
  - src/cli/commands/plan.ts
  - plugin/skills/refine/
  - plugin/skills/write-spec/
  - plugin/skills/plan/
tests:
  - src/plan/planContext.spec.ts
  - src/plan/specFolder.spec.ts
  - src/plan/claudeTranscript.spec.ts
  - src/plan/planCommit.spec.ts
  - src/cli/commands/plan.spec.ts
  - src/plugin/templates.spec.ts
specs:
  - v1
  - 001-plan-command
---

# Planning and writing specs

## Purpose

Takes a user from a request to a validated spec in one interactive workflow, so specs come out
consistent and the cost of planning is visible. Decisions: PLD-1 to PLD-11 in
[001-plan-command](../../001-plan-command/README.md).

## Capabilities

- A user can start planning by name and gets the next numbered spec folder, or continues an existing one.
- A user can hand over a request file, resume the latest planning session, or only print what Claude would get.
- Planning runs fixed phases: context, refine with a checklist and questions, a gate before writing, writing, validation.
- The refine skill turns a vague request into decisions by asking the user focused questions.
- The write-spec skill writes the README, task list, briefs and task rules into the prepared folder.
- The finished spec is validated with the status command before the session ends.
- The session proposes a commit message describing the spec, used when the spec is committed.
- Each planning session's turns and tokens are logged in the spec and show up in stats.

## Expectations

- After the session a spec that loads is committed on the checked-out HEAD: only its folder,
  including the planning log; the Claude session itself never commits.
- An invalid spec or a failing commit is reported and left uncommitted; the exit code stays Claude's.
- Without a proposed message the commit gets a generic one; a proposal never outlives its session.
- Context handed to the session is minimal: the folder, its files and the request, not other specs' history.
- A prepared folder is used as is; no new number or renaming.
- Planning needs a terminal.
- Only tokens are recorded for planning, no prices.

## Pitfalls

- An uncommitted spec folder can collide with a later merge — after an invalid spec or a failed
  commit, commit it by hand before running.
