---
name: write-spec
description: Write an implementation spec that specrun runs unattended — docs/<spec>/ with tasks.yaml (tasks with phase, needs, model and size), README.md (request, analysis, decision log, task overview), a spec-specific TASK_PROMPT.md and one self-contained brief per task in tasks/. Use when the user asks to write something up as a spec, plan or task list for implementation — e.g. "write this up as a spec", "turn this into a spec for specrun", "new spec in docs", "sepiš to jako spec", "zapiš to do docs".
---

# Write spec

Produce a spec that unattended agents implement **task by task with no questions**.
`specrun run <spec>` runs each task in a fresh Agent SDK session (CLAUDE.md is loaded
automatically) whose prompt is:

1. specrun's built-in protocol — how to work unattended, no git commands, ambiguity and spec
   bugs, finishing with `complete_task` (summary, commit message, notes, deviations) or
   `block_task`. Never repeat it in a spec.
2. the spec's `TASK_PROMPT.md` with `{TASK}` replaced — only rules specific to this spec,
3. the task brief `tasks/<TASK>.md`,
4. the notes and deviations every task it needs reported through `complete_task`.

A task runs only when everything it needs is done. The runner verifies (the `verify` steps of
`specrun.config.json`) and commits on green, so briefs never tell the agent to commit or to
update progress files. The agent reads **no other spec file** unless the brief points it there,
so the brief is where all context for the task goes. Every token in the prompt, and every file
the agent reads, is paid again on each later turn — short, precise briefs are the main lever on
cost.

Templates: [templates/](templates/) — copy them, never reconstruct the format from memory.

## 1. Make sure the decisions are agreed

The decisions are binding for the implementing agents, so they may contain only decisions the
user agreed to.

- If the conversation already resolved the open points (e.g. via the `refine` skill), use them.
- If design questions are still open, resolve them first with the `refine` skill
  (`AskUserQuestion`). Only trivial conventional defaults may go in without asking — list them
  in the final message so the user can object.
- Never present your own proposals as agreed. If the user explicitly wants the spec before
  answering, mark such rows "proposed, to confirm" and say so in the final message.

## 2. Reuse the research

The session writing the spec has usually already researched the code (refine's **File map**).
Don't redo it:

- Take the file map from the conversation. Read only what is still unknown for a brief (a
  pattern file nobody opened yet, a line range to cite).
- Check that every path you cite exists with one batched `ls` / `grep -n` call, not by reading
  the files again.
- Note other specs the change supersedes (the brief tells the agent to add one-line notes there).

## 3. Cut the work into sized tasks

Each session pays a fixed cost (system prompt, CLAUDE.md, protocol, plus reading the brief's
files), and then every turn re-reads the whole growing context. Tasks with many new files and
their tests run long and cost several times more — mostly fixing tests late in the session.

Every task gets a **size** `S`, `M` or `L`. The expected turn range of each size is in the
project's `specrun.config.json` under `sizes` (defaults: S 10–25, M 20–45, L 40–70 turns;
`specrun stats --calibrate` tunes them from real runs). Read the configured ranges before sizing.

- **S** — 1–3 changed files in one folder, no new test suite of its own (a small module, wiring,
  docs).
- **M** (the target) — one coherent commit of **3–8 changed files incl. tests**, in one layer.
  A medium feature (~15–25 files) is typically **3–5 tasks**.
- **L** — only when splitting would make two tasks share almost all of their Read-first list
  (e.g. a component with several states and its test suite). Anything bigger is split.
- **Merge** tasks that would each be S and share most of their Read-first list (same folder or
  layer) — e.g. two pure-logic modules in one folder, a module and its wiring into the caller,
  a follow-up that only adds translations / docs.
- **Split** when the read sets differ (domain logic vs. persistence vs. UI), when a task would
  exceed ~8 changed files or two components with their own test suites, and always refactors
  from behaviour changes (refactor first, existing tests as the safety net).
- Quick check: if two tasks' Read-first lists overlap by more than half and together stay ≤ 8
  changed files → merge. If one Read-first list needs more than ~10 entries → split.
- Order by dependency; a task never relies on a later one. Phases only for large specs where
  each phase is shippable on its own (the run doesn't stop between phases — they only order the
  work, lowest first).
- Each task leaves the project's verify steps green.

**Model:** `strong` for tasks that need the stronger model — core domain rules, security /
permission rules, data model or migration changes, cross-cutting refactors shared by several
callers, tricky state / history / concurrency handling. Everything else is `default`.

In §4 of the README, add one line on how the work was cut when it isn't obvious.

## 4. Name the spec

- Folder `<specsDir>/<kebab-name>/` (`specsDir` from `specrun.config.json`, default `docs`),
  e.g. `docs/export-dialog/`.
- Two prefixes: tasks `<PX>-n` and decisions `<PD>-n` (e.g. `ED-1` / `EDD-1`; task ids must
  match `^[A-Z][A-Z0-9]*-[0-9]+$`). Check they are unused:
  `grep -rnE '\b<PX>-[0-9]+' <specsDir>/` must return nothing.
- The runner works on branch `specrun/<spec>`; set `branch` in `tasks.yaml` only when the
  project needs another name.

## 5. Write the files

Copy `templates/*` into the spec folder (`task.md` once per task as `tasks/<PX>-n.md`) and fill
every `<placeholder>`; delete optional comment blocks you don't use. Don't author `PROGRESS.md`
— specrun generates it from its run events.

**tasks.yaml** — the machine-readable plan: `title`, optional `branch`, and one entry per task
`{ id, title, phase, needs, model: default | strong, size: S | M | L }` in dependency order.
`needs` lists task ids of this spec (`[]` when none, `all` = every other task); no cycles.
`model` may be omitted for `default`; the header comment says why the strong tasks were picked
(see **Model** above). No task status — specrun keeps it in `events.jsonl`.

**README.md** — for the humans and as the source of truth:

- §1 Request: the user's request close to verbatim (in English), mapped to tasks.
- §2 Analysis: facts from the code with paths; "Side effects to keep in mind".
- §3 Decision log: one row per decision, precise enough to implement without guessing (names,
  formats, keys, signatures). Date + "agreed with the product owner".
- §4 Tasks: the overview table only (link, Needs, size, model — the same as `tasks.yaml`);
  details live in the briefs.
- §5 Resolved questions (`Q1…`, answer in bold, decision ID). §6 Out of scope.

**tasks/<PX>-n.md** — self-contained; the agent sees nothing else from the spec:

- **Decisions:** quote verbatim every decision the task implements, the §5 answers it depends
  on, and the side effects from §2 that concern it. Don't reference IDs without the text.
- **Read first:** the file map for this task — files to change, one pattern per kind of new
  file (module + its test, component, endpoint, schema), types it uses; each with a symbol or
  line range and why. 3–10 entries, paths only, never pasted code (it goes stale when earlier
  tasks change the files). Don't list files a dependency task creates — its notes will name
  them.
- **Changes:** concrete changes with real paths, names of new modules / functions / props,
  translation keys, docs to annotate ("superseded by <PX>-n").
- **Done when:** tests that must exist and what they assert; behaviour that must stay unchanged
  and the existing tests guarding it.
- No "Implementation notes" section — notes reach later tasks through `complete_task`.
- Test know-how (mocks, queries, traps) lives in the project's test docs, which CLAUDE.md or
  `TASK_PROMPT.md` makes the agent read — don't repeat it in briefs. Name only the test to copy
  in Read first.
- Keep a brief under ~120 lines. Longer means the task is too big or the analysis belongs in
  the README.

**TASK_PROMPT.md** — only what is specific to this spec: where its decision log is, its key
invariant, spec-specific prohibitions with their decision IDs, and project rules for agents
that CLAUDE.md doesn't already state (test docs to read, checks to run while iterating). Never
repeat the protocol (git, background jobs, ambiguity, `complete_task`) or project conventions
from CLAUDE.md, and don't add reading lists — they belong in the briefs. Delete the file if
nothing is left.

## 6. Check and commit

1. Format the markdown with the project's formatter (e.g.
   `npx prettier --write <spec dir>/*.md <spec dir>/tasks/*.md <spec dir>/tasks.yaml`) — then
   re-read lines with inline code containing backticks or `${…}`: prettier can glue them to
   neighbouring words. Rephrase so no inline code contains a backtick. Also check numbered
   lists: a continuation line starting with inline code that contains `<…>` can lose its
   indentation.
2. Consistency: every task in `tasks.yaml` has a brief and a row in the README overview with the
   same phase, needs, size and model; the brief's header line has the same phase and needs;
   every decision ID a brief cites is quoted in it and exists in §3.
3. `specrun status <spec>` loads without errors — it validates `tasks.yaml`, ids, needs, cycles
   and that every task has its brief — and lists every task as `todo`. Brief lengths should be
   roughly even for tasks of the same size (an outlier brief is a sizing smell).
4. Commit only the spec folder (`git add <spec dir>`): `docs(<scope>): add <name> spec` with
   the attribution trailer from the system prompt — only when the user asked to commit;
   otherwise tell them it's ready to commit.

## 7. Curate test traps

Before writing a new spec, run `specrun deviations --kind test-trap` — the traps earlier runs
recorded. Fold the ones that recur (or that cost a lot) into the project's test docs as a short
recipe, and tell the user which ones you added.

## 8. Final message

Short, in the user's language: the folder, the task list (ID, one line, size, model), how the
work was cut, which decisions were defaults or still need confirmation, and the run command
`specrun run <spec>`.
