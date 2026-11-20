---
id: insights/stats
title: Stats, deviations and feedback
status: draft
depends_on:
  - insights/run-log
code:
  - src/stats/
  - src/cli/commands/stats.ts
  - src/cli/commands/deviations.ts
  - plugin/skills/feedback/
tests:
  - src/stats/aggregate.spec.ts
  - src/cli/commands/stats.spec.ts
  - src/archive/history.spec.ts
  - src/cli/commands/deviations.spec.ts
specs:
  - v1
  - 004-multi-account
---

# Stats, deviations and feedback

## Purpose

Shows what finished runs cost and where agents departed from their briefs, and turns that into
evidence-backed proposals to improve specs, rules and sizes. Output format: [json-output](../../json-output.md).

## Capabilities

- A user can see turns, cost and context use of finished tasks, grouped by task, model, size or spec.
- A user can get suggested size ranges calibrated from the measured tasks.
- A user can list the deviations agents reported, optionally filtered by kind (spec bug, ambiguity, constraint, test trap, scope).
- A user can see the token use of planning sessions next to run costs.
- A user can see how long verify rounds and each verify step took per spec, and what share of the task time verify took, to judge changes to the verify setup.
- A user can ask for feedback after runs and get proposals for briefs, task rules, skills, CLAUDE.md and sizes, each with its evidence.
- With several accounts a user can see segments, turns and cost per account.
- A user can read stats and deviations as machine-readable output, also during a run.

## Expectations

- Samples include only tasks that reached done.
- Verify timings count every round, also of tasks that did not reach done; specs archived before timings were kept get them from their run log in git.
- Feedback never changes anything without the user's OK, and never edits the run log or the task list.
- With very few tasks the numbers are reported but few proposals are made.

## Out of scope

- Reviewing and settling single deviations — see [insights/review](review.md).
