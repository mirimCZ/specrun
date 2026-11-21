---
id: insights/review
title: Deviation review
status: draft
depends_on:
  - insights/run-log
  - insights/stats
code:
  - src/review/
  - src/cli/commands/review.ts
tests:
  - src/review/buildReview.spec.ts
  - src/review/reviewContext.spec.ts
  - src/cli/commands/review.spec.ts
specs:
  - v1
  - 004-multi-account
---

# Deviation review

## Purpose

Lets a user settle the deviations agents reported together with Claude Code, with everything
needed already gathered, so decisions are quick and end up in the right place.

## Capabilities

- A user can start a review of one or more specs' deviations, optionally of one kind, in Claude Code on the same terminal.
- The session starts with gathered context: config, spec location, relevant decision rows, task rules, and per task the deviations, commit and brief.
- A user can pick the Claude account a review session runs on.
- A user can see the context and instructions without starting a session.
- Each deviation is judged as confirm, overturn, rule fix or noise, and the user decides what is recorded or changed.
- The review opens with an overview of every deviation and its proposed verdict, then asks until each one is decided.
- Every option of a question shows a preview of what it changes, what it costs and what it rules out.
- Lessons tied to one feature go into that feature's doc when the repo has a feature map.
- Reviewed deviations are marked and left out of later reviews unless asked for.

## Expectations

- Nothing is changed without the user's OK.
- No deviation is settled without the user: the clear cases get one question of their own.
- An answer is final; a later question never undoes a decision made earlier.
- Without a feature map the review behaves as it does with one, minus the feature-doc step.

## Pitfalls

- Already reviewed deviations only reappear with the include-reviewed option.
