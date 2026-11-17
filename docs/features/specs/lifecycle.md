---
id: specs/lifecycle
title: 'Spec lifecycle: archive, close, shelve'
status: draft
depends_on:
  - specs/format
  - run/workspace
  - run/verify-commit
  - insights/run-log
code:
  - src/archive/
  - src/cli/commands/archive.ts
  - src/cli/commands/close.ts
  - src/cli/commands/shelve.ts
  - src/cli/commands/unshelve.ts
tests:
  - src/archive/archiveSpec.spec.ts
  - src/archive/closeSpec.spec.ts
  - src/archive/closeAll.spec.ts
  - src/archive/shelveSpec.spec.ts
  - src/archive/unshelveSpec.spec.ts
specs:
  - v1
---

# Spec lifecycle: archive, close, shelve

## Purpose

Ends a spec's life cleanly: merge and archive finished work, or set aside unfinished work without
losing it. Design: [SRD-26, SRD-30, SRD-32, SRD-35, SRD-36](../../v1/README.md).

## Capabilities

- A user can archive a finished spec; its folder moves to an archive with a note and its run history is kept.
- A user can close a spec: its branch is merged into the current branch and the spec is archived.
- A user can close all specs of an all-specs run with one merge.
- A user can shelve a spec with a reason: its branch is pushed (or kept local) and the spec archived unmerged.
- A user can unshelve a spec, which restores, merges and archives it as merged, or only restores it to continue.
- Shelved specs are listed separately in status and marked in stats and deviations.

## Expectations

- Close refuses unfinished tasks (unless forced), a live run, or a dirty checkout or worktree before touching anything.
- A fast-forward is used when possible; otherwise a merge commit is followed by the configured check, and a red check stops before archiving.
- A merge conflict aborts the merge.
- Nothing is pushed except by shelve.
- Archiving keeps run history so stats still cover the spec.

## Pitfalls

- A spec that ran in the shared all-specs worktree cannot be closed on its own.
