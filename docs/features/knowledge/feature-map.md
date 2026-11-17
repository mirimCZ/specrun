---
id: knowledge/feature-map
title: Feature map
status: draft
depends_on: []
code:
  - src/features/
  - src/cli/commands/features.ts
  - plugin/skills/feature-map/
tests:
  - src/features/checkFeatureMap.spec.ts
  - src/features/loadFeatureMap.spec.ts
  - src/features/mermaidNodes.spec.ts
  - src/cli/commands/features.spec.ts
specs:
  - 002-feature-map
  - 003-feature-map-bootstrap
---

# Feature map

## Purpose

Keeps a user-level description of what a product does, so agents and humans find the right code
and plan changes without reading the whole repo. The format lives in the feature-map skill.

## Capabilities

- A user can check the map: index, diagram, frontmatter, referenced paths, required sections and the features named by tasks.
- The check lists problems per file and fails on errors; warnings are advice only.
- A repo without a feature folder is treated as having no map and the check passes.
- A user can ask for a map of an existing repo and get a bootstrap in phases, with drafts to verify.
- An agent or user can update the docs of the features a change touches, with the skill's rules.
- Docs can feed user documentation and test plans.

## Expectations

- Every feature has an index row, a doc and a diagram node, and the reverse.
- Only a human marks a doc verified; new docs start as draft.
- The check needs no external diagram tool.

## Out of scope

- Judging whether a doc's content is true; the check validates structure and references.
