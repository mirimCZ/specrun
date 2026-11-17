---
id: setup/config
title: Configuration and init
status: draft
depends_on: []
code:
  - src/config/
  - src/cli/commands/init.ts
  - src/cli/configWizard.ts
tests:
  - src/config/configSchema.spec.ts
  - src/config/loadConfig.spec.ts
  - src/cli/commands/init.spec.ts
specs:
  - v1
---

# Configuration and init

## Purpose

Lets a user set up a repository for specrun and tune how runs behave from one file. Design:
[SRD-19, SRD-28](../../v1/README.md).

## Capabilities

- A user can create the configuration interactively; answers are prefilled from the existing file and unknown keys are kept.
- A user can create the configuration with detected defaults and no questions.
- init can try the configured check right away.
- A user can define the check steps, a setup command, files to copy into worktrees and whether to use worktrees.
- A user can tune usage thresholds, models per task class, turn limit, fix rounds, size ranges, spec folder and commit trailers.
- An invalid configuration fails with a message naming the key.

## Expectations

- Only the check steps are required; every other key has a default.
- init never overwrites an existing file without being forced.
- Task-size ranges only record overruns; they are never enforced.

## Pitfalls

- A new config defaults the spec folder to a different name than an existing one without the key.
