# JSON output (SRD-16)

`specrun stats --json`, `specrun deviations --json` and `specrun analyze --json` are read by the
feedback skill, so their shapes are a contract. The zod schemas live in
[`src/stats/jsonOutput.ts`](../src/stats/jsonOutput.ts) (`StatsJsonSchema`, `DeviationsJsonSchema`,
`AnalyzeJsonSchema`) and are used to build and test the outputs. Every document starts with
`version` (currently `1`; bumped on breaking changes) and `generatedAt` (ISO timestamp).

## `specrun stats [spec...] [--by task|model|size|spec] [--calibrate] --json`

One sample per task that reached `done` (totals over all its segments), archived specs included
(their `history.json`, see `specrun archive`). `shelved` names those of `specs` shelved without a
merge (`specrun shelve`); their samples are included. `by` defaults to `model`;
`calibration` is `null` without `--calibrate`, and `suggestion` is `null` below 3 samples.
`verify` has one entry per spec with verify rounds (`verify.finished`): wall time of the rounds
(`runs`, `failed`, `sumMs`, nearest-rank `p50Ms` / `p90Ms`, `maxMs`) and of each step in the
order steps first ran (a step skipped after an earlier failure has fewer `runs`), plus `sessionMs`,
the agent session time, so `sumMs / (sumMs + sessionMs)` is verify's share of the task time.
Archived specs take it from `history.json`, or from their run log in git at `history.commit` when
the archive predates it.
`accounts` has one entry per spec and Claude account (`account`, `segments`, `turns`, `costUsd`),
summed over the `session.finished` events of the run log in the order accounts first appear; events
without `account` count as `default` (MAD-12). Archived specs contribute nothing.

```json
{
  "version": 1,
  "generatedAt": "2026-01-01T10:00:00.000Z",
  "specs": ["demo"],
  "shelved": [],
  "by": "model",
  "samples": [
    {
      "spec": "demo",
      "task": "D-1",
      "model": "default",
      "size": "S",
      "turns": 12,
      "costUsd": 0.4,
      "peakContext": 80000,
      "sessions": 1,
      "verifyRounds": 1,
      "deviations": 0,
      "budgetExceeded": false
    }
  ],
  "groups": [
    {
      "key": "default",
      "count": 1,
      "turns": { "sum": 12, "p50": 12, "p90": 12 },
      "costUsd": { "sum": 0.4, "p50": 0.4, "p90": 0.4 },
      "peakContext": { "sum": 80000, "p50": 80000, "p90": 80000 },
      "budgetExceeded": 0
    }
  ],
  "calibration": [
    {
      "model": "default",
      "size": "S",
      "n": 1,
      "current": { "turns": [10, 25], "usd": 0.6 },
      "suggestion": null
    }
  ],
  "planning": [],
  "accounts": [
    { "spec": "demo", "account": "default", "segments": 1, "turns": 12, "costUsd": 0.4 }
  ],
  "verify": [
    {
      "spec": "demo",
      "runs": 2,
      "failed": 1,
      "sumMs": 9000,
      "p50Ms": 1000,
      "p90Ms": 8000,
      "maxMs": 8000,
      "sessionMs": 60000,
      "steps": [
        {
          "name": "typecheck",
          "runs": 2,
          "failed": 1,
          "sumMs": 4000,
          "p50Ms": 1000,
          "p90Ms": 3000,
          "maxMs": 3000
        },
        {
          "name": "test",
          "runs": 1,
          "failed": 0,
          "sumMs": 5000,
          "p50Ms": 5000,
          "p90Ms": 5000,
          "maxMs": 5000
        }
      ]
    }
  ]
}
```

## `specrun deviations [spec...] [--kind <kind>] --json`

Deviations from the `task.completed` payload of done tasks and of blocked tasks, archived specs
included. `question` is
the question the agent would have asked a human, the options it weighed and the one it
implemented (`null` when the deviation has none; agents must give one for `ambiguity`).
`reviewed` is true once `specrun review` marked it (SRD-34); all are listed either way. `shelved`
names the specs of `deviations` that were shelved without a merge (SRD-35).

```json
{
  "version": 1,
  "generatedAt": "2026-01-01T10:00:00.000Z",
  "deviations": [
    {
      "spec": "demo",
      "task": "D-1",
      "kind": "spec-bug",
      "decision": "use X",
      "what": "brief wrong",
      "why": "code differs",
      "question": null,
      "reviewed": true
    },
    {
      "spec": "demo",
      "task": "D-2",
      "kind": "ambiguity",
      "decision": null,
      "what": "kept the alias",
      "why": "simplest",
      "question": { "text": "Keep the alias?", "options": ["keep", "drop"], "chosen": "keep" },
      "reviewed": false
    }
  ],
  "counts": { "spec-bug": 1, "ambiguity": 1 },
  "shelved": []
}
```

## `specrun analyze [spec] [--task <id>] [--reindex] --json`

Latest metrics (highest `analyzerVersion`) per task, merged over its segments. `reindexed` is the
number of appended events (`null` without `--reindex`); `unreadFirst` is `null` when no segment
had a brief. The phase split is always an estimate.

```json
{
  "version": 1,
  "generatedAt": "2026-01-01T10:00:00.000Z",
  "specs": [
    {
      "spec": "demo",
      "tasks": [
        {
          "task": "D-1",
          "segments": 1,
          "peakContext": 80000,
          "topFiles": [{ "path": "src/b.ts", "resultChars": 500 }],
          "rereads": 0,
          "unreadFirst": ["src/a.ts"],
          "phases": {
            "orient": { "turns": 1, "tokens": 100 },
            "implement": { "turns": 0, "tokens": 0 },
            "test": { "turns": 0, "tokens": 0 },
            "fix": { "turns": 0, "tokens": 0 }
          },
          "estimate": true
        }
      ]
    }
  ],
  "reindexed": null,
  "warnings": []
}
```
