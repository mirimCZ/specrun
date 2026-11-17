---
name: feature-map
description: The feature map standard — a repo's user-level feature docs plus one Mermaid overview, kept up to date by agents and humans. Use when creating, updating or reading feature docs or the feature map, when a change adds, alters or removes user-visible behaviour, or when writing documentation or test plans from them — e.g. "update the feature map", "feature doc", "add a feature to the map", "aktualizuj feature mapu", "popiš feature", "create the feature map", "vytvoř feature mapu".
---

# Feature map

A **feature map** describes what a product does at user level: one short doc per feature plus an
overview graph. AI agents use it to find the right code and plan changes without reading the whole
repo; humans use it to orient themselves. It is only useful while it is true, so every change that
touches behaviour updates it.

## Layout and ids

`featuresDir` in `specrun.config.json` (default `specrun/features`):

```
<featuresDir>/README.md              the map: overview graph + index
<featuresDir>/<area>/<name>.md       one feature doc
```

The feature id is `<area>/<name>`, both parts kebab-case (`board/fog-cells`). The id is the file
path, the frontmatter `id`, the index link and the base of the graph node id.

## README format

In this order: H1, one intro paragraph, exactly one fenced `mermaid` block, then `## Features`.

- The block is a `flowchart` with one `subgraph` per area.
- Node id = feature id with `/` and `-` replaced by `_` (`board/fog-cells` → `board_fog_cells`).
  Every feature has a labelled node (`board_fog_cells["Fog cells"]`); every labelled node is a feature.
- Edges are free: `A --> B` means A uses B.
- `## Features` is a table `ID | Title | Summary`, sorted by id. The ID cell is a link
  `[board/fog-cells](board/fog-cells.md)`.

See `templates/README.md`.

## Feature doc format

Frontmatter (see `templates/feature.md`):

- `id`, `title`, `status: draft | verified`, `depends_on` (feature ids).
- `code` (at least one), `tests`, `specs` (spec folder names that built or changed it).
- Paths are repo-relative files or folders, no globs.

Sections, in this order:

- `## Purpose` — 1–3 sentences: what problem, for whom.
- `## Capabilities` — 3–10 bullets, each "who can do what / what happens", at user level.
- `## Expectations` — invariants that must hold: rules, permissions, data consistency.
- `## Pitfalls` (optional) — known traps, surprising side effects.
- `## Out of scope` (optional).

## Detail rule

A feature is a whole the user can name and use. **Stability test:** renaming a button, moving a
panel or restyling must not require a change to the doc. More than 10 capabilities → split the
feature.

- Good: "A player can reveal a cell; neighbouring empty cells open with it."
- Too detailed: "Clicking the blue Reveal button in the toolbar calls `revealCell()`." — it breaks
  on a restyle and belongs in code or a test.

## Updating a doc after a change

1. Find the docs whose `code:` covers the files you changed (grep the paths). New behaviour with no
   fitting doc → add a feature doc, an index row and a graph node.
2. Touch only what the change affects: capabilities, expectations, pitfalls; `code` / `tests` when
   files moved or were added; `depends_on` and edges when the feature starts or stops using another.
3. Add the spec folder to `specs:` when a spec changed the feature.
4. Removing a feature: delete its doc, row and node, and fix `depends_on` elsewhere.
5. Status: only a human sets `verified`. Keep the status you found; new docs start as `draft`.
6. Run `specrun features check` and fix every error (it exits 1 on errors; warnings are advice).

## Docs → documentation and test plans

- Purpose and capabilities become user documentation.
- Each capability becomes acceptance criteria or a test scenario.
- Each expectation becomes a negative test: try to break the invariant.
- `tests:` shows what is covered; a capability with no test there is a gap to report or fill.

## No map yet

No `<featuresDir>/README.md` → bootstrap: follow [bootstrap.md](bootstrap.md) and don't improvise
one. Otherwise update, as above.
