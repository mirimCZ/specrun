# <Spec Title>

<One paragraph: what changes for the user and what stays as it is.>

| Document                         | Contents                                                   |
| -------------------------------- | ---------------------------------------------------------- |
| README.md (this file)            | Request, analysis, decision log, task overview, questions  |
| [tasks/](tasks/)                 | One self-contained brief per task (+ implementation notes) |
| [PROGRESS.md](PROGRESS.md)       | Task status and dependency tables, filled by runs          |
| [TASK_PROMPT.md](TASK_PROMPT.md) | Prompt for unattended per-task runs                        |

Runner: `tools/spec-run.sh <spec> 1` (branch `<spec>/phase-1`, Opus tasks in [run.env](run.env)).

<!-- Optional, only when the spec depends on another spec's tasks:
> **Precondition:** run this spec only **after** `docs/<other>` <TASK-IDS> are `done`.
-->

---

## 1. Request (product owner, <YYYY-MM-DD>)

| #   | Request                                                        | Tasks     |
| --- | -------------------------------------------------------------- | --------- |
| R1  | <the user's request, translated to English, close to verbatim> | <PX-1, …> |

## 2. Analysis

<!-- Facts from the code that the tasks rely on. Real file paths, current behaviour, why a naive
approach would be wrong. One `###` per topic. -->

### <Topic>

<Where the behaviour lives today (`path/to/File.tsx`), what depends on it, constraints.>

### Side effects to keep in mind

- <Risk found during refinement and how the tasks handle it.>

## 3. Decision log

Agreed with the product owner on <YYYY-MM-DD> (see [Resolved questions](#5-resolved-questions)).
Prefix `<PD>-`.

| ID     | Topic   | Decision                                                 |
| ------ | ------- | -------------------------------------------------------- |
| <PD>-1 | <topic> | <decision, precise enough to implement without guessing> |

---

## 4. Tasks

| Phase | Task                      | Title   | Needs | Model  |
| ----- | ------------------------- | ------- | ----- | ------ |
| 1     | [<PX>-1](tasks/<PX>-1.md) | <title> | —     | sonnet |

<!-- Optional: why the work is cut this way (layers, what was merged and why). -->

---

## 5. Resolved questions

Answered by the product owner on <YYYY-MM-DD>.

| #   | Question   | Answer                |
| --- | ---------- | --------------------- |
| Q1  | <question> | **<answer>** (<PD>-n) |

## 6. Out of scope

- <Declined improvement or explicitly excluded behaviour.>
