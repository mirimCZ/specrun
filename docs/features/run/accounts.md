---
id: run/accounts
title: Multiple Claude accounts
status: draft
depends_on:
  - setup/config
  - run/limits
code:
  - src/accounts/
  - src/config/globalConfig.ts
  - src/limits/policy.ts
  - src/cli/accountsFor.ts
  - src/cli/commands/accounts.ts
tests:
  - src/accounts/accounts.spec.ts
  - src/accounts/token.spec.ts
  - src/accounts/env.spec.ts
  - src/accounts/prepare.spec.ts
  - src/config/globalConfig.spec.ts
  - src/limits/policy.spec.ts
  - src/runner/runSpec.spec.ts
  - src/cli/commands/accounts.spec.ts
specs:
  - 004-multi-account
---

# Multiple Claude accounts

## Purpose

Lets a user spread long unattended runs over several Claude accounts, so a usage limit on one
account does not stop the work while another has capacity. Design:
[004-multi-account](../../004-multi-account/README.md).

## Capabilities

- A user can define accounts in a global configuration in the home folder, each with a token source (environment variable or command) and optional thresholds.
- The order of the accounts is their priority; a run uses the first one with capacity and falls back to the next when it is low or hits a limit.
- A user can pass the burn option to use whichever account has capacity first instead of strictly by priority.
- A user can pin a run, a planning session or a review to one account by name.
- A user can list the accounts with their token source, thresholds and current usage windows.
- A run waits only when no account can work and stops on the weekly limit only when every account is below its minimum.
- Every switch between accounts is recorded in the run log with its reason.

## Expectations

- Without a global configuration there is one implicit account and runs behave as before.
- A token never appears in the run log, output, transcripts or progress file.
- The user's Claude login files are never read or written.
- An unknown pinned account or a failing token source is reported by name before work starts.

## Pitfalls

- The first task of a run on a fallback account records a switch from the priority account.
- Reset times in the account listing are relative durations.
