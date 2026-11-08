# SR-2 — Event log, state reducer, PROGRESS.md view

Phase 1 · Needs: SR-1 · Implements: SRD-5, SRD-21, SRD-24 (PROGRESS part)

The single source of run state: a typed, append-only `docs/<spec>/events.jsonl`, a pure reducer
that derives every task's status, notes and stats from it, and the generated `PROGRESS.md`.

## Decisions

- **SRD-5** — `spec.json` is authored and never written by the runner. `events.jsonl` is an
  append-only log written only by the runner (and `specrun set`). Task status is derived from
  events. `PROGRESS.md` is a generated view, regenerated with every runner commit.
- **SRD-21** — one JSON object per line `{ v: 1, t, at (ISO), runId, … }`. Status per task: the
  latest of `task.committed` → `done`, `task.blocked` → `blocked`, `manual.status` → its status;
  none → `todo`. A `session.started` after the latest status event without a later
  `session.finished` for that session+segment, or whose outcome left the task open → `interrupted`
  (resumable, `resumeSessionId`). Unknown event types are kept and ignored.
- **SRD-9** (payload) — `complete_task`: `summary`, `commitMessage`, `notes` (≤ 15),
  `deviations` ({ `kind`: `spec-bug` · `ambiguity` · `constraint` · `test-trap` · `scope`,
  `decision?`, `what`, `why` }[]).
- Side effect: a crash can leave a half-written last line — the reader skips an unparsable
  **last** line (reported via `onWarning`), an unparsable line elsewhere is an error.

## Event types (`src/events/eventSchema.ts`, all with `v`, `t`, `at`, `runId`)

- `run.started` `{ spec, branch, base, version, options: Record<string, unknown> }`
- `run.finished` `{ reason: 'done' | 'checkpoint' | 'paused-weekly' | 'failed' | 'interrupted', message? }`
- `usage.snapshot` `{ sessionLeft, sessionResetsAt, weeklyLeft, weeklyResetsAt, source: 'event' | 'probe' }` (percent left 0–100, ISO or null)
- `limit.wait` `{ task?, reason: 'session-low' | 'limit-hit', until (ISO) }`
- `session.started` `{ task, sessionId: string | null, segment (int ≥ 0), attempt (int ≥ 1), model, reason: 'start' | 'verify-fix' | 'limit-resume' | 'nudge' | 'crash-resume', prompt: { protocol, spec, brief, deps } (chars) }`
- `session.finished` `{ task, sessionId, segment, outcome: 'completed' | 'blocked' | 'no-call' | 'limit' | 'max-turns' | 'interrupted' | 'error', error?, turns, peakContext, inputTokens, outputTokens, cacheRead, cacheWrite, costUsd, durationMs }` — per-segment **deltas**
- `task.completed` `{ task, sessionId, payload: CompleteTaskPayload }`
- `verify.finished` `{ task, round (int ≥ 0), ok, durationMs, steps: { name, ok, durationMs }[], log }`
- `task.committed` `{ task, commit, filesChanged, insertions, deletions }`
- `task.blocked` `{ task, reason, source: 'agent' | 'verify' | 'max-turns' | 'protocol' | 'error', kind?, parkedRef? }`
- `budget.exceeded` `{ task, size, turns, costUsd, limit: { turns, usd } }`
- `protocol.violation` `{ task, kind: 'agent-commit', detail }`
- `manual.status` `{ task, status: 'todo' | 'done' | 'blocked', reason }`
- `analytics.session` `{ task, sessionId, segment, analyzerVersion (int), metrics: unknown }` — `metrics` is typed by SR-7; here only `z.unknown()`.

## Read first

- `CLAUDE.md`, `docs/testing.md`.
- SR-1 notes below — `Spec`, `SpecTask`, `topologicalOrder`, `SpecrunError`.
- `tools/spec-run.sh` `record_stats` / `task_stats` — which stats the old PROGRESS.md showed.

## Changes

- New `src/events/eventSchema.ts`: one zod schema per type, `EventSchema` =
  `z.discriminatedUnion('t', …)`, `type SpecrunEvent`, `type EventOf<T>`, `CompleteTaskPayloadSchema`
  (+ `DeviationSchema`, `DEVIATION_KINDS`), `type NewEvent` (event without `v`/`at`/`runId`).
- New `src/events/eventStore.ts`: `createEventStore({ file, runId, clock })` →
  `{ append(event: NewEvent): SpecrunEvent, read(): ReadResult }`. `append` stamps `v/at/runId`,
  validates, writes one line with `appendFileSync` + `fsyncSync`. `readEvents(file, { onWarning })`
  → `{ events: SpecrunEvent[], unknown: number }`: missing file = empty; unknown `t` counted and
  skipped; invalid known event = `SpecrunError('events-invalid')` with line number.
- New `src/events/taskState.ts`: `deriveState(spec, events): SpecState` (pure).
  `SpecState = { tasks: Map<id, TaskState>, sessions: SessionStats[] }`;
  `TaskState = { status: 'todo' | 'done' | 'blocked' | 'interrupted', resumeSessionId: string | null,
nextSegment, attempts, lastCompleted: CompleteTaskPayload | null, commit: string | null,
blockedReason: string | null, totals: { sessions, turns, costUsd, peakContext, durationMs },
budgetExceeded: boolean }`. `lastCompleted` = the latest `task.completed` before the status
  event that made it `done` (dependents read notes/deviations from it). Totals sum all
  `session.finished` of the task. Helpers: `runnableTasks(spec, state, { retryBlocked })`
  (deps `done`, status `todo` / `interrupted` / optionally `blocked`, in `topologicalOrder`),
  `lowestOpenPhase(spec, state)`.
- New `src/progress/renderProgress.ts`: `renderProgress(spec, state): string` — markdown with a
  first line `<!-- Generated by specrun from events.jsonl — do not edit. -->`, title, a task table
  (Phase, Task, Title, Size, Model, Status, Sessions, Turns, Peak ctx, Cost, Commit short sha,
  Summary), a deviations list (`- **<task>** [kind] decision: what — why`) and totals. Numbers
  formatted like the old stats (`58k`, `$0.50`). Deterministic output (snapshot-friendly).
- `.gitattributes` in the repo root: `**/events.jsonl merge=union` (and add the same line to
  the `init` template later — SR-8 notes it).

## Done when

- `eventStore.spec.ts`: append+read round trip, fsync'ed lines, truncated last line skipped
  with a warning, corrupt middle line throws, unknown type skipped and counted.
- `taskState.spec.ts`: todo → done via commit; blocked; manual override back to todo; started
  without finished → `interrupted` with `resumeSessionId` and `nextSegment`; a later
  verify-fix segment keeps the same session; totals summed over segments; `lastCompleted` picks
  the payload before the commit; `runnableTasks` respects deps and `retryBlocked`.
- `renderProgress.spec.ts`: inline snapshot of a small spec in mixed states.
- `tools/spec-verify.sh` green.

## Implementation notes

<!-- Filled in by the implementing agent: files, exported names, deviations. -->

- `src/events/eventSchema.ts`: `EventSchema`, `SpecrunEvent`, `EventType`, `EventOf<T>`, `NewEvent`,
  `EVENT_TYPES`, `CompleteTaskPayloadSchema`, `DeviationSchema`, `DEVIATION_KINDS`, `SESSION_REASONS`,
  `SESSION_OUTCOMES`, one `<Type>Schema` per event. Non-strict objects (extra fields stripped).
- `src/events/eventStore.ts`: `EVENTS_FILE`, `createEventStore({ file, runId, clock: { now() },
onWarning?, fsync? })` → `{ append, read }`; `readEvents(file, { onWarning? })` → `{ events, unknown }`.
  Bad events → `SpecrunError('events-invalid')` (new code in `src/errors.ts`).
- `src/events/taskState.ts`: `deriveState`, `runnableTasks`, `lowestOpenPhase(spec, state): number |
null` (lowest phase with a task neither done nor blocked); types `TaskState`, `TaskStatus`,
  `SpecState`, `SessionStats` (finished segment + `attempt`/`model`/`reason` of its start).
- `src/progress/renderProgress.ts`: `renderProgress`, `PROGRESS_FILE`, `GENERATED_MARKER`,
  `formatTokens`/`formatUsd`/`formatDuration`. Output is Prettier-stable (tested).
- Decision: `append` repairs a torn tail first (half-written last line truncated with a warning,
  complete line missing `\n` terminated) — else the next append makes a corrupt middle line.
- Decision: any `session.started` after the latest status event → `interrupted`; `resumeSessionId` =
  start's id or its finished segment's; unknown id → null, `nextSegment` 0. `lastCompleted`/`commit` only when `done`.
- Deviation: `sessionId` of `session.finished`/`task.completed` and `usage.snapshot` `*Left` nullable
  (SDK may fail before an id; SR-4 windows can be null). `.gitattributes` added; SR-8 adds it to `init`.
