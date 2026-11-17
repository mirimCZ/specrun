---
id: run/workspace
title: Run workspace
status: draft
depends_on:
  - setup/config
code:
  - src/git/worktree.ts
  - src/git/workspace.ts
  - src/git/ensureLine.ts
tests:
  - src/git/worktree.spec.ts
  - src/git/workspace.spec.ts
specs:
  - v1
---

# Run workspace

## Purpose

Gives each spec run a place to work that does not disturb the user's checkout, so the user can keep
editing and run several specs at once. Design: [SRD-7, SRD-8, SRD-28](../../v1/README.md).

## Capabilities

- A user's first run of a spec creates an isolated git worktree on the spec branch, from a base ref of their choice (default: the current commit).
- The spec branch is `specrun/<spec>` unless the spec names its own branch.
- A user can list ignored files the new worktree needs (e.g. an env file) and they are copied in from the checkout.
- A user can configure a setup command that runs once in a new worktree, e.g. to install dependencies.
- A user can turn the worktree off, and the spec then runs in the main checkout on the spec branch.
- A user's later runs reuse the existing worktree and its branch.
- All-specs runs share one worktree and branch.

## Expectations

- The main checkout is never touched in worktree mode.
- Worktree-less mode refuses a checkout with uncommitted changes and runs no setup.
- Only one worktree-less run per checkout; blocking a task there resets and cleans the checkout.
- Worktrees live under `.specrun/worktrees/` and that folder is kept out of git.

## Pitfalls

- A new worktree contains tracked files only; anything ignored must be listed or set up, or the verify step fails there first.
- In worktree-less mode the user must not edit files while a run is active.
