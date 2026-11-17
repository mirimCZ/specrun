# <PX>-n — Update the feature map

Phase 1 · Needs: all · Implements: —

Bring the feature map in line with what this spec built, so the next planning session finds
current docs. Standard: the **feature-map** skill.

## Decisions

- Update the docs of the touched features from the tasks' notes and deviations in the prompt plus
  `git log --stat` (read-only git only; never run git commands that change state).
- Add this spec to `specs:` of every touched feature doc.
- A new feature gets a doc (status `draft`), an index row in the map README and a node in the
  diagram. Obey the detail rule of the feature-map skill.
- Only a human sets `verified`; keep the status you found.

## Read first

- `<featuresDir>/README.md` — index and diagram to update
- `<featuresDir>/<area>/<name>.md` — one entry per touched feature doc
- `plugin/skills/feature-map/SKILL.md` — format, detail rule, update steps

## Changes

- Update the touched feature docs (behaviour, code and test paths, `## Pitfalls` from deviations).
- Add new features: doc, index row, node.

## Done when

- `specrun features check` is green.
- Every touched feature lists this spec under `specs:`.

<!-- In tasks.yaml this task is `needs: all`, size S, model default. -->
