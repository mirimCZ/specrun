---
name: write-spec
description: Write an implementation spec into docs/<spec>/ in the format run by tools/spec-run.sh (README.md with request, analysis, decision log and task overview; one self-contained brief per task in tasks/; PROGRESS.md, TASK_PROMPT.md, run.env). Use when the user asks to write something up as a spec, plan or task list for implementation — e.g. "sepiš to jako spec", "zapiš to do docs", "udělej z toho spec pro spec-run", "nový spec do /docs".
---

# Write spec

Produce a spec that unattended agents implement **task by task with no questions**.
`tools/spec-run.sh <spec> <phase>` runs each task in a fresh `claude -p` session (tools Bash,
Read, Edit, Write only; CLAUDE.md is loaded automatically) whose prompt is:

1. `TASK_PROMPT.md` with `{TASK}` replaced,
2. the task brief `tasks/<TASK>.md`,
3. the `## Implementation notes` of every task it needs (dependency table in PROGRESS.md).

Tasks whose dependencies aren't `done` are skipped without starting a session. The agent reads
**no other spec file** unless the brief points it there, so the brief is where all context for
the task goes. Every token in the prompt, and every file the agent reads, is paid again on each
later turn of the session — short, precise briefs are the main lever on cost.

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
- Note other specs in `docs/` the change supersedes (the brief tells the agent to add one-line
  notes there).

## 3. Cut the work into tasks

Each session pays a fixed cost (~16k tokens of system prompt + CLAUDE.md, plus reading the
brief's files), and then every turn re-reads the whole growing context. Measured on earlier
specs: a task changing 2–4 files in one folder finishes in ~20–25 turns; a UI task with 6–8 new
files and their specs takes 40–60 turns at ~100k context and costs ~3× as much — mostly
fixing tests late in the session. Aim for the middle:

- **Target:** one coherent commit of **3–8 changed files incl. specs**, in one layer, expected
  **20–45 turns**. A medium feature (~15–25 files) is typically **3–5 tasks**.
- **Merge** tasks that would each touch ≤ 3 files and share most of their Read-first list
  (same folder or layer) — e.g. two pure-logic modules in the same `game-engine` folder, a
  component and its wiring into the parent, a follow-up that only adds i18n / docs.
- **Split** when the read sets differ (game-engine logic vs. Firestore API + rules vs. UI), when
  a task would exceed ~8 changed files or two components with their own spec suites, and always
  refactors from behaviour changes (refactor first, existing specs as the safety net).
- Quick check: if two tasks' Read-first lists overlap by more than half and together stay ≤ 8
  changed files → merge. If one Read-first list needs more than ~10 entries → split.
- Order by dependency; a task never relies on a later one. Phases only for large specs where
  each phase is shippable on its own.
- Each task leaves `tools/spec-verify.sh` green.

In §4 of the README, add one line on how the work was cut when it isn't obvious.

## 4. Name the spec

- Folder `docs/<kebab-name>/` (e.g. `journal-dialog`, `character-fixes2`).
- Two prefixes: tasks `<PX>-n` and decisions `<PD>-n` (e.g. `JD-1` / `JDD-1`). Check they are
  unused: `grep -rnE '\b<PX>-[0-9]+' docs/` must return nothing.
- Branch is `<spec>/phase-<n>` (created by the runner).

## 5. Write the files

Copy `templates/*` into `docs/<spec>/` (`task.md` once per task as `tasks/<PX>-n.md`) and fill
every `<placeholder>`; delete optional comment blocks you don't use (keep the comment under
`## Implementation notes` — the runner ignores it).

**README.md** — for the humans and as the source of truth:

- §1 Request: the user's request close to verbatim (in English), mapped to tasks.
- §2 Analysis: facts from the code with paths; "Side effects to keep in mind".
- §3 Decision log: one row per decision, precise enough to implement without guessing (names,
  URL formats, i18n keys, props). Date + "agreed with the product owner".
- §4 Tasks: the overview table only (link, Needs, model) — details live in the briefs.
- §5 Resolved questions (`Q1…`, answer in bold, decision ID). §6 Out of scope.

**tasks/<PX>-n.md** — self-contained; the agent sees nothing else from the spec:

- **Decisions:** quote verbatim every decision the task implements, the §5 answers it depends
  on, and the side effects from §2 that concern it. Don't reference IDs without the text.
- **Read first:** the file map for this task — files to change, one pattern per kind of new
  file (component + its spec, hook, endpoint, rules), types it uses; each with a symbol or line
  range and why. 3–10 entries, paths only, never pasted code (it goes stale when earlier tasks
  change the files). Don't list files a dependency task creates — its implementation notes will
  name them.
- **Changes:** concrete changes with real paths, names of new components / functions / props,
  i18n keys (cs + en), docs to annotate ("superseded by <PX>-n").
- **Done when:** specs that must exist and what they assert; behaviour that must stay unchanged
  and the existing specs guarding it.
- Test know-how (mocks, MUI queries, traps) lives in `docs/testing.md`, which TASK_PROMPT
  makes the agent read — don't repeat it in briefs. Name only the spec to copy in Read first.
- Keep a brief under ~120 lines. Longer means the task is too big or the analysis belongs in
  the README.

**PROGRESS.md** — task table (all `todo`, Commit empty), dependency table matching the briefs'
`Needs` lines (the runner reads it), empty run log.

**TASK_PROMPT.md** — keep the fixed parts of the template. Fill in: spec title / path, the
spec's key invariant (Implement step 2), commit scopes, spec-specific prohibitions with their
decision IDs. Don't add reading lists — they belong in the briefs.

**run.env** — `OPUS_TASKS` lists tasks that need the stronger model: game-rule logic, Firestore
rules or data model changes, cross-cutting refactors shared by several callers, tricky
state/URL/history handling. UI wiring and small features run on sonnet. The comment says why.

## 6. Check and commit

1. `npx prettier --write docs/<spec>/*.md docs/<spec>/tasks/*.md` — then re-read lines with
   inline code containing backticks or `${…}`: prettier can glue them to neighbouring words.
   Rephrase so no inline code contains a backtick. Also check numbered lists: a continuation
   line starting with inline code that contains `<…>` can lose its indentation.
2. Consistency: every task has a brief, a row in the README overview, the PROGRESS task and
   dependency tables (matching the brief's `Needs`) and, if opus, run.env; every decision ID
   a brief cites is quoted in it and exists in §3.
3. `bash tools/spec-run.sh <spec> 1 --dry-run` — every phase-1 task is listed as "would run"
   with `brief tasks/<ID>.md`; the prompt sizes it prints should be roughly even (an outlier
   brief is a sizing smell).
4. Commit only the spec folder (`git add docs/<spec>`):
   `docs(<scope>): add <name> spec` with the attribution trailer from the system prompt — only
   when the user asked to commit; otherwise tell them it's ready to commit.

## 7. Curate test traps

Before writing a new spec, `grep -rn 'Test trap:' docs/*/tasks/` — the traps earlier runs
recorded. Fold the ones that recur (or that cost a lot) into `docs/testing.md` as a short
recipe, and tell the user which ones you added.

## 8. Final message

Short, in the user's language: the folder, the task list (ID, one line, model), how the work was
cut, which decisions were defaults or still need confirmation, and the run command
`tools/spec-run.sh <spec> 1`.
