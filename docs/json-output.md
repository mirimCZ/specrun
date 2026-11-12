# JSON output (SRD-16)

`specrun stats --json`, `specrun deviations --json` and `specrun analyze --json` are read by the
feedback skill, so their shapes are a contract. The zod schemas live in
[`src/stats/jsonOutput.ts`](../src/stats/jsonOutput.ts) (`StatsJsonSchema`, `DeviationsJsonSchema`,
`AnalyzeJsonSchema`) and are used to build and test the outputs. Every document starts with
`version` (currently `1`; bumped on breaking changes) and `generatedAt` (ISO timestamp).

## `specrun stats [spec...] [--by task|model|size|spec] [--calibrate] --json`

One sample per task that reached `done` (totals over all its segments). `by` defaults to `model`;
`calibration` is `null` without `--calibrate`, and `suggestion` is `null` below 3 samples.

```json
{
  "version": 1,
  "generatedAt": "2026-01-01T10:00:00.000Z",
  "specs": ["demo"],
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
  ]
}
```

## `specrun deviations [spec...] [--kind <kind>] --json`

Deviations from the `task.completed` payload of done tasks and of blocked tasks. `question` is
the question the agent would have asked a human, the options it weighed and the one it
implemented (`null` when the deviation has none; agents must give one for `ambiguity`).

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
      "question": null
    },
    {
      "spec": "demo",
      "task": "D-2",
      "kind": "ambiguity",
      "decision": null,
      "what": "kept the alias",
      "why": "simplest",
      "question": { "text": "Keep the alias?", "options": ["keep", "drop"], "chosen": "keep" }
    }
  ],
  "counts": { "spec-bug": 1, "ambiguity": 1 }
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
