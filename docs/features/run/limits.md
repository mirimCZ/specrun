---
id: run/limits
title: Usage limits
status: draft
depends_on:
  - setup/config
code:
  - src/limits/
  - src/session/probeUsage.ts
tests:
  - src/limits/policy.spec.ts
  - src/limits/usage.spec.ts
  - src/limits/clock.spec.ts
  - src/limits/keepAwake.spec.ts
  - src/session/probeUsage.spec.ts
specs:
  - v1
---

# Usage limits

## Purpose

Lets a long unattended run live within a Claude plan's usage windows: it waits out the short one
and stops cleanly on the weekly one. Design: [SRD-10, SRD-25](../../v1/README.md).

## Capabilities

- Before each task the run checks how much of the 5-hour window is left and waits for its reset if too little remains.
- The user can set the percentage left (5-hour and weekly) below which a run waits or stops.
- A run that finds the weekly window nearly used up stops with a distinct exit code instead of waiting days.
- A session that hits a usage limit mid-task waits for the reset and then resumes the same session.
- The user can see the waiting countdown and the current usage windows while a run waits.
- On macOS the machine is kept awake while a run is active.

## Expectations

- A wait ends only after the reset time plus a safety margin.
- A stop request during a wait ends the run at once.
- Waiting never loses a session; the task resumes with its context.
- Usage readings that cannot be obtained never fail the task.

## Pitfalls

- Waiting for the 5-hour window can take hours; the run looks idle but is not stuck.
