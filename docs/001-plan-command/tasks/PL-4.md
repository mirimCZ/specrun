# PL-4 — Plan skill, write-spec folder rule, docs

Phase 1 · Needs: PL-2, PL-3 · Implements: PLD-9, PLD-10, PLD-11

The `specrun:plan` skill that `specrun plan` starts with `/specrun:plan <spec>`. It runs the
fixed planning sequence so the user no longer types refine and write-spec. The task also adds
the write-spec rule for a pre-created folder and documents the command. PL-2's and PL-3's notes
name the final flags, messages and output fields.

## Decisions

- **PLD-9** — `plugin/skills/plan/SKILL.md` (name `plan`), linked as `.claude/skills/plan`. Fixed phases:
  - **1 Context:** read the specrun context, CLAUDE.md is already loaded; read only code and docs the request touches.
  - **2 Refine:** follow the refine skill. Before the questions, walk the checklist (scope and roles; data model and migration; permissions and security; edge cases and legacy data; UI states and user-visible texts; tests and verify; docs to update; out of scope) and mark each item resolved, defaulted (listed in the summary) or not applicable.
  - **3 Gate:** one `AskUserQuestion` "Write the spec now?" (Write the spec (Recommended) / More questions).
  - **4 Write:** follow the write-spec skill into the given folder.
  - **5 Validate:** `specrun status <spec>` until it loads cleanly.

  The final message is as in write-spec §8. Never commit unless the user asks. The skill refers to refine and write-spec instead of copying their rules.

- **PLD-10** — write-spec §4 gets: "When the session context names the spec folder (`specrun plan`), use it as is — don't compute a new number or rename it."
- **PLD-11** — Root `README.md`: a "Planning" section (command, phases, what is logged, the commit reminder) and the command in the commands overview. `plugin/README.md`: a row for `plan`. Feedback skill: `stats --json` `planning` is input (e.g. planning tokens vs. the spec's deviations and task costs).
- **PLD-4** (what the session receives) — the spec name and folder, `new` or its existing files, `specsDir`, the request in `<request>` tags or "ask the user", and "Write the spec into exactly this folder". Nothing from other specs.

## Read first

- `plugin/skills/refine/SKILL.md` — structure, frontmatter and tone to match; §4 summary that write-spec consumes
- `plugin/skills/write-spec/SKILL.md` — §4 "Name the spec" (where PLD-10 goes), §6–§8
- `plugin/skills/feedback/SKILL.md` — inputs list (where `planning` goes)
- `plugin/README.md` — skills table
- `README.md` — "Other commands" (line ~201) and "Specs" (line ~55) sections
- `src/plugin/templates.spec.ts` — skill folder checks (`ships refine and write-spec`)
- `.claude/skills/` — relative symlinks to `../../plugin/skills/<name>`

## Changes

- New `plugin/skills/plan/SKILL.md`, frontmatter `name: plan` and a description with trigger phrases ("plan a spec", "naplánuj spec"). It notes that it is normally started by `specrun plan`; started by hand, it tells the user that the session isn't logged and to use `specrun plan -n <name>`. Phases per PLD-9, under ~90 lines.
- Symlink `.claude/skills/plan -> ../../plugin/skills/plan`.
- `plugin/skills/write-spec/SKILL.md` §4: the PLD-10 sentence. Keep the uncommitted local edits in §5 if present.
- `src/plugin/templates.spec.ts`: `ships refine and write-spec` also expects `plan`.
- `README.md`: "Planning" section and the overview entry (PLD-11). `plugin/README.md`: `plan` row. `plugin/skills/feedback/SKILL.md`: planning input.

## Done when

- `src/plugin/templates.spec.ts` passes with `plan` included (frontmatter `name` = folder).
- `.claude/skills/plan/SKILL.md` resolves through the symlink.
- `npm run check` green (prettier formats the markdown).
