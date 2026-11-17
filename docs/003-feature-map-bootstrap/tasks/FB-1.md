# FB-1 — Bootstrap mode of the feature-map skill

Phase 1 · Needs: — · Implements: FBD-1, FBD-2, FBD-3, FBD-4, FBD-7

Adds the procedure for creating a feature map in a repo that has none, as
`plugin/skills/feature-map/bootstrap.md`, and routes the skill to it. The same procedure is used
interactively (with the user's review gate) and by unattended agents (with a given feature list).

## Decisions

- **FBD-1** — The `feature-map` skill routes: no `<featuresDir>/README.md` → bootstrap, following `plugin/skills/feature-map/bootstrap.md`; otherwise update (as today). SKILL.md only gets the routing line and a pointer; the procedure lives in `bootstrap.md`.
- **FBD-2** — Phases:
  1. **Inventory** (cheap signals: CLAUDE.md layout, entry points such as routes, CLI command registry and public exports, top-level source folders, i18n namespaces, data collections and security rules, archived spec READMEs, existing docs, e2e / integration test names). No docs are written. Output: a table of proposed areas and features (id, title, one-line purpose, main code folders) plus the diagram draft.
  2. **Review gate:** the user adjusts granularity with `AskUserQuestion` (merge / split / rename; the options explain the detail rule and stability test). Nothing is written before approval.
  3. **Drafts:** one subagent per area, in parallel, writes that area's docs per the standard with `status: draft`, reading code and existing docs. Detailed existing docs are linked, not copied.
  4. **Assemble:** the README (diagram + index), then `specrun features check` until green.
  5. **Final message:** the drafts to verify, and proposals the user decides on (not applied without OK): trim the CLAUDE.md sections the map now covers, add `specrun features check` to `verify`.
- **FBD-3** — Only a human flips `draft` → `verified`. The skill tells the user to verify docs gradually, e.g. when a spec touches them.
- **FBD-4** — When run by an unattended agent (no user), the review gate is replaced by the feature list given in the brief; all docs stay `draft`.
- **FBD-7** — The "Feature map" section of the root `README.md` gets a "Bootstrapping an existing repo" how-to.

## Read first

- `plugin/skills/feature-map/SKILL.md` — the standard; where the "No map yet" note is to replace with the routing line
- `plugin/skills/refine/SKILL.md` §3 — `AskUserQuestion` rules the review gate must follow (link, don't copy)
- `README.md` — "Feature map" section

## Changes

- New `plugin/skills/feature-map/bootstrap.md` with the FBD-2 phases, an unattended note (FBD-4) and the verify note (FBD-3). Each phase says what it outputs. Under ~100 lines; refer to SKILL.md for formats.
- `plugin/skills/feature-map/SKILL.md`: the routing line (FBD-1); extend the description's triggers with "create the feature map", "vytvoř feature mapu".
- `README.md`: "Bootstrapping an existing repo" subsection (5 steps, matching FBD-2).

## Done when

- `src/plugin/templates.spec.ts` (skill frontmatter) still passes.
- `bootstrap.md` exists and is referenced from SKILL.md by relative link.
- `npm run check` green.
