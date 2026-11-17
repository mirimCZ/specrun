# FM-4 — Map in planning, write-spec upkeep, review pitfalls

Phase 1 · Needs: FM-3 · Implements: FMD-8, FMD-9, FMD-10

Wires the feature map into the spec lifecycle. Planning reads it, write-spec tags tasks with
features and ends each spec with a map-update task, and review files feature-specific lessons
into `## Pitfalls`. Everything is skipped in repos without a map.

## Decisions

- **FMD-8** — When the repo has a feature map, write-spec fills `features` per task and adds a last task "Update the feature map" (`needs: all`, size S, model default) from the template `templates/feature-map-task.md`. The brief: update the docs of the touched features from the tasks' notes and deviations in the prompt plus `git log --stat`; add the spec to `specs:`; a new feature gets a doc (`draft`), an index row and a node; obey the detail rule (FMD-5); run `specrun features check`. Without a map no such task.
- **FMD-9** — The plan context (`renderPlanContext`) adds the map README path when `<featuresDir>/README.md` exists, else "No feature map". Plan skill phase 1: read the map README, then only the docs of features the request touches. The refine checklist gains "feature map impact (features touched, new features)".
- **FMD-10** — `reviewPrompt.md` §2: a lesson tied to one feature → that feature doc's `## Pitfalls` (when the repo has a map); `test-trap` → test docs; a project-wide `constraint` → CLAUDE.md. Without a map, review behaves as today.
- **FMD-4** (status) — Only a human sets `verified`; agents keep the status they found.
- Side effect (README §2): the map-update task sees all notes because it `needs: all`. Read-only git (`git log --stat`) is allowed; git commands that change state are not.

## Read first

- `src/plan/planContext.ts` + `planContext.spec.ts` — `renderPlanContext` (from spec 001)
- `src/cli/commands/plan.ts` — where the context input is assembled (config at hand)
- `plugin/skills/plan/SKILL.md` — phase 1 and the refine checklist
- `plugin/skills/write-spec/SKILL.md` — §3 cutting, §5 tasks.yaml / briefs, §6 checks
- `plugin/skills/write-spec/templates/tasks.yaml` + `task.md` — template style; `templates.spec.ts` parses `tasks.yaml`
- `src/review/reviewPrompt.md` — §2 "Where rule fixes go, by kind"
- `plugin/skills/feature-map/SKILL.md` — the standard to point to (FM-3)

## Changes

- `src/plan/planContext.ts`: input `featureMap: string | null` (repo-relative README path), rendered as "Feature map: <path>" or "No feature map". `plan.ts` passes it from `config.featuresDir`. Tests in `planContext.spec.ts`.
- `plugin/skills/plan/SKILL.md`: FMD-9 phase 1 reading rule and the checklist item.
- `plugin/skills/write-spec/SKILL.md`: map rules (FMD-8). Under §5 tasks.yaml, the `features` field. Under §3, the final map-update task when the context or repo has a map. Under §6, the brief must list the features it touches. Point to the feature-map skill for the format.
- New `plugin/skills/write-spec/templates/feature-map-task.md`: brief template per FMD-8 (Read first: the map README and the touched docs; Done when: `specrun features check` green, `specs:` updated).
- `plugin/skills/write-spec/templates/tasks.yaml`: a commented `features: [<area>/<name>]` example line; the template must still parse.
- `src/review/reviewPrompt.md` §2: the FMD-10 bullet.

## Done when

- `planContext.spec.ts`: renders the map path when given and "No feature map" otherwise.
- `templates.spec.ts` still parses the `tasks.yaml` template; a new case checks that `feature-map-task.md` names `specrun features check` and `needs: all`, and that the template's header line follows `task.md`'s format.
- Review prompt tests (`src/review/buildReview.spec.ts`) unchanged and green.
- `npm run check` green.
