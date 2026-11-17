---
name: feedback
description: Turn specrun run data into concrete, evidence-backed proposals to improve briefs, TASK_PROMPT.md, the write-spec skill, test docs, CLAUDE.md and size ranges. Use after specrun runs, when the user asks for feedback on runs, why tasks were expensive, how to improve specs or sizing — e.g. "feedback on the runs", "why was SR-5 so costly", "improve the specs from the stats", "zhodnoť běhy".
---

# Feedback

Read what specrun recorded about finished runs and propose edits that make the next specs
cheaper and less error-prone. Every proposal carries its evidence; **nothing is applied without
the user's OK**. This is a first version — thresholds are starting points, say so when a signal
is borderline.

Never edit `events.jsonl` or `tasks.yaml`, and never rerun tasks.

## 1. Scope and data

- Specs: the ones the user names; otherwise those with runs since the last feedback (check
  `git log` for the last `docs(...)` feedback commit, or ask when unclear).
- Collect, per scope (all commands accept spec names):

```
specrun stats [spec...] --by size --calibrate --json
specrun deviations [spec...] --json
specrun analyze [spec] --json        # add --reindex if metrics look missing or stale
```

Shapes: `docs/json-output.md` in the specrun repository. `analyze` phase numbers are estimates;
`stats` samples cover only tasks that reached `done`. `stats --json` `planning` (tokens of `specrun plan` sessions, no prices) is input too: compare planning tokens with the spec's deviations and task costs — a cheap plan with many `spec-bug` / `ambiguity` deviations suggests too little refinement. With fewer than ~3 tasks, report the
numbers but propose little — outliers dominate.

## 2. Signals

Compare each task against its size group's p50/p90 (`stats` groups) before calling it an outlier.

| Signal (threshold)                                                                                | Suggests                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `unreadFirst` non-empty in ≥ 2 tasks, or many reads outside the Read-first list                   | Brief Read-first lists are off → write-spec's Read-first rules (or the briefs of that spec)                 |
| `topFiles` dominated by whole-file reads (> ~30k chars), `rereads` ≥ 3 in a task                  | Reading guidance (`sed -n`, `grep -n`, read once) in the project's CLAUDE.md or the spec's `TASK_PROMPT.md` |
| Large Bash results from test / verify commands in `topFiles` / transcripts                        | Quieter commands, or a verify summary script, in the test docs / `TASK_PROMPT.md`                           |
| phases `test` + `fix` > 40 % of tokens, or `verifyRounds` ≥ 3                                     | Test docs: turn recurring `test-trap` deviations into recipes                                               |
| Deviations by kind: `spec-bug` / `ambiguity` ≥ 2 in a spec                                        | write-spec analysis rules (check code claims, quote decisions, name signatures)                             |
| `ambiguity` deviations — each has the agent's `question`, `options` and `chosen`                  | The user confirms each pick (section 3); a question that recurs → decide it up front in write-spec          |
| `scope` deviations                                                                                | write-spec cutting rules                                                                                    |
| `constraint` deviations (permissions, missing tools)                                              | The project's CLAUDE.md / config                                                                            |
| Task turns outside its size range, `budgetExceeded`, or a `calibration` entry with a `suggestion` | Config `sizes` and write-spec's sizing guidance (S/M/L definitions)                                         |
| `peakContext` far above the p90 of its group                                                      | Split rules in write-spec (Read-first > ~10 entries, > 8 changed files)                                     |

Read the actual brief or deviation text before proposing a wording change; don't propose from
numbers alone.

## 3. Output

A numbered list, most token-saving first (estimate from tokens/cost of the affected tasks):

```
N. <target file> — <proposed change, concrete wording or setting> — evidence: <spec/task, numbers>
```

Before the list, the **questions agents answered themselves** (`ambiguity` and any other
deviation with a `question`), one per line: `<spec>/<task> — <text> → <chosen> (over <others>)`.
Ask the user to confirm or overturn each pick; an overturned pick becomes a follow-up (a fix
task or a decision in the spec's README §3), never a silent edit.

Target files are real paths (`docs/<spec>/TASK_PROMPT.md`, `plugin/skills/write-spec/SKILL.md`,
the project's test docs, `CLAUDE.md`, `specrun.config.json`). Merge proposals that touch the
same place. Leave out signals that did not fire; end with one line on what looked healthy.

Then ask which to apply — `AskUserQuestion` multi-select when available (one option per item),
otherwise ask in text. Apply only the chosen ones, keep edits minimal, then list the files
changed. Commit only if the user asks.

When a spec is done and merged and its questions are settled, offer to archive it: first move
behaviour that still holds from its README into the project's living docs, then
`specrun archive <spec>` (keeps the README and run history, so later feedback still sees it).
