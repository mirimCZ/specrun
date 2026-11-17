# Bootstrap a feature map

Procedure for a repo with no `<featuresDir>/README.md`. Formats, ids, the detail rule and the
stability test are in [SKILL.md](SKILL.md) — follow them, don't restate them. Run the phases in
order; each one ends with the output named below.

## 1. Inventory

Read only cheap signals: CLAUDE.md layout, entry points (routes, CLI command registry, public
exports), top-level source folders, i18n namespaces, data collections and security rules, archived
spec READMEs, existing docs, e2e / integration test names. **Write no docs yet.**

Output: a table of proposed areas and features (`id`, title, one-line purpose, main code folders)
plus a draft of the overview diagram (areas as subgraphs, `A --> B` = A uses B).

## 2. Review gate

Show the inventory, then let the user adjust granularity with `AskUserQuestion` — merge, split,
rename. Follow the question rules in [refine §3](../refine/SKILL.md); the options explain the
detail rule and the stability test and what each choice costs. **Nothing is written before the
user approves.**

Output: the approved feature list (ids, titles, areas) and diagram.

## 3. Drafts

Start one subagent per area, in parallel. Each writes its area's feature docs per SKILL.md with
`status: draft`, reading the code and existing docs. A detailed existing doc is linked from the
feature doc, not copied. Docs describe what exists now — no plans.

Output: one doc per approved feature, `status: draft`.

## 4. Assemble

Write `<featuresDir>/README.md` (intro, the diagram, the `## Features` index) from the approved
list and the drafts' `depends_on`. Run `specrun features check` and fix every error until it is
green.

Output: a README and a green `specrun features check`.

## 5. Final message

Report:

- the drafts to verify, by id;
- proposals the user decides on — **don't apply them without an OK**: trim the CLAUDE.md sections
  the map now covers; add `specrun features check` to `verify` in `specrun.config.json`.

Only a human flips `draft` to `verified`. Tell the user to verify docs gradually, e.g. when a spec
touches them.

## Unattended

Without a user (an agent run by a spec), the review gate is replaced by the feature list given in
the brief: skip phase 2 and use that list. All docs stay `draft`; the final message goes to the
task notes.
