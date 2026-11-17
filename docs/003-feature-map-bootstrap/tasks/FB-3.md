# FB-3 — specrun feature map: insights, knowledge, README, verify

Phase 1 · Needs: FB-2 · Implements: FBD-4, FBD-5 (areas insights, knowledge), FBD-6

Completes specrun's feature map. It writes the docs of the areas `insights` and `knowledge`, then
assembles `docs/features/README.md` (diagram + index) for all features, and adds
`specrun features check` to specrun's verify steps. FB-2's notes list the docs it wrote.

## Decisions

- **FBD-4** — When run by an unattended agent (no user), the review gate is replaced by the feature list given in the brief; all docs stay `draft`.
- **FBD-5** (this task's part) —
  - `insights/run-log`: events, transcripts, analyze (`src/events/`, `src/analytics/`, `src/progress/`).
  - `insights/stats`: stats, deviations, feedback skill (`src/stats/`, `plugin/skills/feedback/`).
  - `insights/review`: `src/review/`.
  - `knowledge/feature-map`: check and skill (`src/features/`, `plugin/skills/feature-map/`).
  - The README covers all areas: `run`, `specs`, `insights`, `knowledge`, `setup`.
- **FBD-6** — `specrun.config.json` `verify` gets `{ "name": "features", "command": "npx tsx src/cli/main.ts features check" }` after `format`.
- Side effect (README §2): the verify step runs the CLI from source because the installed `specrun` may be older than the code being verified.

## Read first

- `plugin/skills/feature-map/SKILL.md` + `templates/README.md` + `templates/feature.md` — the standard and templates
- `plugin/skills/feature-map/bootstrap.md` — phases 3–4
- `docs/features/` — FB-2's docs (frontmatter and `depends_on` to wire into the diagram)
- `README.md` — "Other commands" (stats, deviations, review, analyze)
- `docs/002-feature-map/README.md` §3 — feature map decisions (or its archived copy under `docs/archive/`)
- `specrun.config.json` — verify steps

## Changes

- New docs `docs/features/insights/{run-log,stats,review}.md` and `docs/features/knowledge/feature-map.md` (`status: draft`).
- New `docs/features/README.md` per the template:
  - a `flowchart LR` with one `subgraph` per area and one labelled node per feature (node id per the standard),
  - edges following `depends_on`,
  - a `## Features` index of all 13 features, sorted by id.
- `specrun.config.json`: the FBD-6 step.

## Done when

- `npx tsx src/cli/main.ts features check` exits 0 with no errors (warnings allowed, listed in the notes).
- The verify run passes with the new `features` step.
- `npm run check` green.
