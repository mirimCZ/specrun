# FM-3 — feature-map skill: standard and templates

Phase 1 · Needs: FM-2 · Implements: FMD-5, FMD-11 (and documents FMD-1 to FMD-4, FMD-6)

Writes the feature map standard as the `feature-map` skill, with templates for the map README and
a feature doc. Every agent and human updating a map follows this skill. Bootstrapping a map for an
existing repo is added by spec 003; leave a short "No map yet" note pointing at it.

## Decisions

- **FMD-1** — Config `featuresDir` (default `docs/features`). Map: `<featuresDir>/README.md`. Feature doc: `<featuresDir>/<area>/<name>.md`; feature id `<area>/<name>`, kebab-case parts.
- **FMD-2** — H1, one intro paragraph, exactly one fenced `mermaid` block (a `flowchart`, one `subgraph` per area), then a `## Features` table `ID | Title | Summary`; the ID cell is a link `[<id>](<id>.md)`; sorted by id.
- **FMD-3** — Node id = feature id with `/` and `-` → `_`; every feature has a labelled node, every labelled node is a feature; edges free (`A --> B` = A uses B).
- **FMD-4** — Frontmatter: `id`, `title`, `status: draft | verified`, `depends_on`, `code` (min 1), `tests`, `specs`. Repo-relative paths, files or folders, no globs. Only a human sets `verified`; agents keep the status they found (new docs start as `draft`).
- **FMD-5** — Sections:
  - `## Purpose`: 1–3 sentences, what problem and for whom.
  - `## Capabilities`: 3–10 bullets, each "who can do what / what happens", at user level.
  - `## Expectations`: invariants that must hold (rules, permissions, data consistency).
  - Optional `## Pitfalls`: known traps, surprising side effects.
  - Optional `## Out of scope`.

  Detail rule: a feature is a whole the user can name and use. **Stability test:** renaming a button, moving a panel or restyling must not require a change to the doc. More than 10 capabilities → split the feature.

- **FMD-11** — The skill covers format, detail rule, how to update a doc, and how docs feed documentation and test plans (capabilities → acceptance criteria / scenarios, expectations → negative tests, `tests:` → coverage). Other skills point to it.
- **FMD-6** — `specrun features check` validates all of it and exits 1 on errors.

## Read first

- `plugin/skills/refine/SKILL.md` — frontmatter, structure and tone to match
- `plugin/skills/write-spec/templates/task.md` — template style (placeholders, optional comment blocks)
- `plugin/README.md` — skills table
- `README.md` — "Specs" (~line 55) and "Configuration" (~line 179) sections
- `src/plugin/templates.spec.ts` — template tests (the `tasks.yaml` one is the pattern)
- `.claude/skills/` — relative symlinks to `../../plugin/skills/<name>`

## Changes

- New `plugin/skills/feature-map/SKILL.md` (`name: feature-map`; description with triggers like "update the feature map", "feature doc", "aktualizuj feature mapu"). Sections: what the map is for (AI discovery and planning, human orientation); layout and ids; README format; feature doc format; the detail rule with the stability test and one good / one too-detailed capability example; updating a doc after a change (what to touch, `specs:`, status rule); docs → documentation and test plans; run `specrun features check`; "No map yet" (one line: bootstrapping comes with the bootstrap instructions). Under ~140 lines.
- New `plugin/skills/feature-map/templates/README.md` and `templates/feature.md` (placeholders `<…>`, valid once filled in).
- Symlink `.claude/skills/feature-map -> ../../plugin/skills/feature-map`.
- `src/plugin/templates.spec.ts`: fill both templates (an area `example`, a feature `example/sample`) in a temp dir and assert `loadFeatureMap` + `checkFeatureMap` report no errors.
- `README.md`: "Feature map" section (what, where, `featuresDir`, `specrun features check`, add it to `verify` if wanted). `plugin/README.md`: row for `feature-map`.

## Done when

- The new template test passes: the filled templates form a valid map.
- Skill frontmatter test passes for `feature-map`; `.claude/skills/feature-map/SKILL.md` resolves.
- `npm run check` green.
