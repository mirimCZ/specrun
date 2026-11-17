---
id: run/verify-commit
title: Verify, fix and commit
status: draft
depends_on:
  - run/orchestration
  - run/workspace
  - setup/config
code:
  - src/verify/
  - src/git/git.ts
  - src/git/commitMessage.ts
tests:
  - src/verify/verify.spec.ts
  - src/git/git.spec.ts
  - src/git/commitMessage.spec.ts
specs:
  - v1
---

# Verify, fix and commit

## Purpose

Turns a finished agent session into a trustworthy commit, or keeps the failed work for a human,
so only checked work lands on the spec branch. Design: [SRD-6, SRD-22, SRD-24](../../v1/README.md).

## Capabilities

- After a task is reported complete, the user's configured check steps run in order; the first red step stops them.
- A red check gives the same agent session the failure summary so it can fix its work, up to a configured number of rounds.
- A green check produces one commit on the spec branch, with the agent's message and summary.
- Every commit carries the task and session as trailers, plus any extra trailers the user configured.
- A task that stays red, or that the agent blocks, is blocked and its changes are parked under a git ref the user can inspect.
- After parking, the next task starts from a clean tree.

## Expectations

- Nothing is committed unless every verify step passed.
- The agent never runs git; commits, parking and cleaning are the runner's.
- Parked work includes untracked files but not ignored ones, and is never lost by a later run.
- The commit subject names the task, even if the agent's message left it out.
- The failure summary the agent gets is short enough to act on, not the full output.

## Out of scope

- Pushing or merging; that is `specs/lifecycle`.
