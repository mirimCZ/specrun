---
id: insights/run-log
title: Run log and analytics
status: draft
depends_on: []
code:
  - src/events/
  - src/progress/
  - src/analytics/
  - src/cli/commands/analyze.ts
tests:
  - src/events/eventStore.spec.ts
  - src/events/taskState.spec.ts
  - src/progress/renderProgress.spec.ts
  - src/analytics/analyzeSession.spec.ts
  - src/analytics/bashFiles.spec.ts
  - src/analytics/latestMetrics.spec.ts
  - src/analytics/readFirst.spec.ts
  - src/cli/commands/analyze.spec.ts
specs:
  - v1
---

# Run log and analytics

## Purpose

Records everything a run does in one append-only log per spec and derives status, a progress
table and per-session analytics from it. Design: [SRD-2, SRD-5](../../v1/README.md).

## Capabilities

- A user can see every task's status, derived from the spec's run log, from another terminal while a run is going.
- A user gets a generated progress table in the spec folder that is refreshed with every commit.
- A user can see per task the sessions, turns, tokens, cost and the agent's reported deviations.
- A user can run an analysis of the session transcripts: files read and edited (through the file tools or shell commands), rereads, tool and shell calls.
- A user can rebuild the analytics of earlier runs from the transcripts.
- A user can see which files an agent read first, to judge whether a brief's reading list was enough.
- A user can read the status and analytics as machine-readable output.

## Expectations

- The run log is append-only and written only by specrun; nothing rewrites it.
- Task status is always derived from the log, never stored elsewhere.
- Events written by a newer specrun version do not break reading by an older one.
- Analytics come from transcripts kept outside the repository; a missing transcript lowers detail, not correctness of status.

## Pitfalls

- Phase numbers in the analysis are estimates.
- Files read or edited through shell commands are recognized from the command text; Python scripts and commands with unknown paths count as edits without a file, searches (`grep`) not as reads.
