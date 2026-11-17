---
name: refine
description: Refine a feature request, plan or design together with the user before implementation — find gaps, risks and better alternatives, then resolve them through interactive multiple-choice questions with a recommended option. Use when the user asks to propose changes or improvements, to ask questions interactively, to review or stress-test a plan, or to clarify an assignment — e.g. "propose improvements", "ask me questions", "if you have questions or suggestions, ask them interactively", "what's missing from this plan", "what could be better", "grill me", "navrhni úpravy a vylepšení", "polož mi otázky", "vyzpovídej mě".
---

# Refine

Goal: turn a rough request into a **complete, unambiguous and user-friendly solution** before
any code is written. You are a critical product + engineering partner, not a stenographer: find
what's missing, what will break, and what would make the result clearly better — then let the
user decide quickly through well-designed choices.

## 1. Research first, ask second

Before asking anything, learn what the codebase already answers:

- Read the relevant code, `CLAUDE.md`, and related specs in the project's specs folder
  (`specsDir` in `specrun.config.json`, default `specrun/specs/`). Decision logs and resolved questions
  of earlier specs are binding unless the user reopens them.
- Find existing patterns the solution should reuse (modules, components, data shapes, naming,
  error handling, translations) and the exact files it would touch.
- Never ask what you can find out yourself. Never ask about things with an obvious conventional
  default — decide, and mention the default in the summary.

**Keep a file map while you research.** Whatever you open, note it at once in a working list
grouped by area (e.g. domain logic / persistence / API / UI), so nobody has to rediscover it
later:

- **Change:** files the solution modifies — with the symbol or line range and what changes.
- **Pattern:** the closest existing example to copy for each kind of new file (module + its
  test, component, endpoint, schema, migration), with what to copy from it.
- **Types / API:** types, functions and endpoints the solution uses, with their file.
- **Guards:** existing tests that protect behaviour which must stay unchanged.
- **New:** files to create, with their intended path and name.

Paths and short notes only, never pasted code. Prefer reading several files per command
(`cat a b`, `sed -n` ranges, `grep -n`) to keep the research itself cheap.

## 2. Critical review — collect findings

Go through the request deliberately and write down findings in four buckets:

| Bucket           | What to look for                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blockers**     | Ambiguities that change what gets built: unclear scope, who sees / can do it (roles), which entities, what "active" / "current" means, where in the product it lives.                                    |
| **Risks**        | Things that will break or surprise: edge cases (0 / 1 / many items, empty values, deleted references, legacy data), permissions and access rules, concurrency, migrations, compatibility, performance.   |
| **Variants**     | Places with 2+ reasonable designs (data model, state location, API shape, UX flow). Each needs trade-offs, not just names.                                                                               |
| **Improvements** | Optional additions that make the result noticeably nicer to use: shortcuts, confirmations, empty / disabled states with hints, feedback after actions, consistency with similar features, accessibility. |

Be honest about problems with the user's own idea. If the request as stated would be awkward,
inconsistent with the rest of the product, or a hack, say so and offer the better alternative as
a choice — the user decides.

## 3. Ask with `AskUserQuestion`

Rules for every question:

- **Max 4 questions per round**, each with **2–4 options**. The automatic "Other" option covers
  free-form answers — never add one yourself.
- **Recommended option first**, label ending with ` (Recommended)`. Recommend whenever you have
  a reasoned preference.
- **Option descriptions state consequences**, not just names: what the user will see, what it
  costs, what it rules out.
- `header` ≤ 12 characters.
- Use **`multiSelect: true`** for improvement menus ("Which of these should I add?") and for
  "which places / which roles" questions.
- Use **`preview`** when comparing concrete artifacts: ASCII mockups of layouts, data shapes,
  API signatures, URL or CLI formats. Previews only work with single-select.
- Phrase questions in the user's language and in the domain terms they use.
- One decision per question. Don't bundle "A and also B?".

Order of rounds:

1. **Blockers** (otherwise later questions may be moot).
2. **Variants** and **risks** that need a policy decision.
3. **Improvements** (multi-select menu).

Run another round only when answers open new questions or reveal a dependency. Stop when every
remaining point has a sensible default. Never ask "Shall I continue?" or "Is the plan OK?".

## 4. Summarize the outcome

After the last round, give a compact summary the user can scan:

- **Decisions** — one line each: question → answer → consequence. Mark which ones were your
  defaults (not asked) so the user can still object.
- **Risks accepted / mitigated** — what you will handle and how.
- **Out of scope** — what was explicitly declined.
- **File map** — the list from §1, updated with the decisions (drop files a declined variant
  would have touched), plus a rough size: number of files to change / create per area.

Keep the decisions in a shape that `write-spec` can paste into a **Decision log** and
**Resolved questions** table (ID, topic, decision; question, answer). The file map and size are
what `write-spec` uses for the task briefs' **Read first** lists and for cutting the work into
sized tasks — it doesn't repeat the research.

Then continue with what the user asked for: implement it, or — if they want a spec — use the
`write-spec` skill. Don't write a spec unless asked.

## Examples

Good question (variants with consequences, recommended first):

> **Where should the active filter live?** (header: `State`)
>
> - **URL query (Recommended)** — `/orders?status=open`; refresh keeps the filter, links can be
>   shared, browser Back restores the previous filter.
> - **Component state** — simplest; refresh resets the filter, links always open unfiltered.

Good improvement menu (multi-select):

> **Which entry points should open the export dialog?** — Toolbar button / Row context menu /
> Keyboard shortcut

Bad questions — don't ask these:

- "Should I write tests?" (project rules already say yes)
- "Do you want the button to have an icon?" (follow the surrounding UI)
- "Is this plan OK?" / "Shall I proceed?"
- An open "What do you think about X?" without concrete options.
