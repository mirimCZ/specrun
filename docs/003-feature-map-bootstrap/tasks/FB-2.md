# FB-2 — specrun feature map: run, specs, setup areas

Phase 1 · Needs: FB-1 · Implements: FBD-4, FBD-5 (areas run, specs, setup)

Writes the first half of specrun's own feature map unattended: the docs for the areas `run`,
`specs` and `setup`. Follow phase 3 of `plugin/skills/feature-map/bootstrap.md` with the feature
list below in place of the review gate. FB-3 writes the remaining areas, the README and the
verify step.

## Decisions

- **FBD-4** — When run by an unattended agent (no user), the review gate is replaced by the feature list given in the brief; all docs stay `draft`.
- **FBD-5** (this task's part) —
  - `run/orchestration`: task loop, needs order, sessions, follow-ups (`src/runner/`, `src/session/`).
  - `run/workspace`: isolated worktree, setup, `worktreeFiles`, spec branch, `worktree: false` mode (`src/git/worktree.ts`, `src/git/workspace.ts`).
  - `run/verify-commit`: verify steps, fix rounds, commits, parking blocked work (`src/verify/`, `src/git/git.ts`, `src/git/commitMessage.ts`).
  - `run/limits`: usage windows, waiting, keep-awake (`src/limits/`).
  - `run/dashboard`: Ink dashboard and run controls (`src/ui/`, `src/cli/runControls.ts`).
  - `specs/format`: tasks.yaml, briefs, validation, status / set (`src/spec/`, `src/cli/commands/status.ts`, `src/cli/commands/set.ts`).
  - `specs/authoring`: planning and writing specs as one workflow — `specrun plan`, the refine, write-spec and plan skills (`src/plan/`, `plugin/skills/refine/`, `plugin/skills/write-spec/`, `plugin/skills/plan/`).
  - `specs/lifecycle`: archive, close, shelve, unshelve (`src/archive/`).
  - `setup/config`: config and init (`src/config/`, `src/cli/commands/init.ts`).
- Detail rule (from the standard): user-level capabilities ("the user can stop a run after the current task"), not flags or key bindings. The doc must survive renaming a flag. `depends_on` uses ids from the whole FBD-5 list, including FB-3's areas (`insights/run-log`, `insights/stats`, `insights/review`, `knowledge/feature-map`).

## Read first

- `plugin/skills/feature-map/SKILL.md` + `templates/feature.md` — the standard and the doc template
- `plugin/skills/feature-map/bootstrap.md` — phase 3 (drafts)
- `README.md` — user-facing behaviour per command ("Running", "Dashboard and controls", "Workspace", "Configuration", "Other commands")
- `CLAUDE.md` — layout
- `docs/v1/README.md` — decision log `SRD-*`, for Expectations and Pitfalls (link decisions, don't copy)
- `docs/001-plan-command/README.md` §3 — planning decisions (if the spec is archived: `docs/archive/001-plan-command/README.md`)

## Changes

- New docs under `docs/features/<area>/<name>.md` for the nine features above. Frontmatter: `status: draft`, `code` with the folders / files listed, `tests` with the main spec files, `specs` with the spec folder names that shaped the feature (`v1`, `001-plan-command`, …).
- Read source only as far as needed to state capabilities and invariants correctly. Prefer README and the decision log; open code to confirm.

## Done when

- Nine docs exist with all required sections, 3–10 capabilities each, valid frontmatter (id = path).
- `npx tsx src/cli/main.ts features check` reports no frontmatter, section or path errors for these docs. Errors about the missing README, index rows and diagram nodes are expected until FB-3.
- `npm run check` green.
