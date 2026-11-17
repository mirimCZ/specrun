# FM-2 — specrun features check and task features field

Phase 1 · Needs: FM-1 · Implements: FMD-6, FMD-7

Turns the loaded feature map (FM-1) into errors and warnings and exposes the result as
`specrun features check`. Tasks can name the features they touch in `tasks.yaml`; the check
validates those ids. FM-1's notes name the loader and its types.

## Decisions

- **FMD-6** — `specrun features check` prints `path: message` lines and exits 1 on any error.
  - **Errors:**
    - map README missing, or not exactly one mermaid block,
    - invalid frontmatter, or id ≠ path,
    - missing required section,
    - index row without doc, or doc without row,
    - feature without node, or node without feature,
    - node id collision,
    - unknown `depends_on`,
    - missing `code` / `tests` path,
    - unknown feature id in an active spec's `tasks.yaml`.
  - **Warnings (exit 0):** capabilities outside 3–10; `specs` entry not found under `specsDir` or its archive.
  - No `featuresDir` → "No feature map" and exit 0.
- **FMD-7** — Optional task field `features: string[]` (default `[]`), passed through `SpecSchema`. `loadSpec` doesn't check the ids (FMD-6 does).
- **FMD-1** — feature id `<area>/<name>`; no `<featuresDir>` → no feature map.
- Side effect (README §2): a stale feature id in `tasks.yaml` must never stop `specrun run`.

## Read first

- `src/spec/specSchema.ts` — `TaskSchema` (strict) and the `SpecSchema` transform's field list
- `src/spec/loadSpec.spec.ts` — where to add the `features` round trip
- `src/plugin/templates.spec.ts` — parses the `tasks.yaml` template with `SpecSchema` (must stay green)
- `src/cli/commands/status.ts` + `status.spec.ts` — command shape, problem output, exit code via `process.exitCode`
- `src/cli/program.ts` — registration
- `src/spec/loadSpec.ts` — `listSpecs`, `loadSpec` (active specs for the id check)
- `src/archive/history.ts` — `archiveRoot` (`specs` warning)

## Changes

- `src/spec/specSchema.ts`: `features: z.array(z.string().min(1)).default([])` on `TaskSchema`, carried by the transform.
- New `src/features/checkFeatureMap.ts` + `.spec.ts`: `checkFeatureMap(map, { repoRoot, config, specTaskFeatures, knownSpecs }): Problem[]`. It is pure; the caller collects the active specs' task features and the active and archived spec names.
- New `src/cli/commands/features.ts` + `.spec.ts`: `specrun features check`, a `features` command with the `check` subcommand. Output is the errors, then the warnings, then a count line ("feature map OK — N features" or "N errors, M warnings"). Exit code 1 on errors.
- `src/cli/program.ts`: register.

## Done when

- `checkFeatureMap.spec.ts`: one case per FMD-6 error and warning, built from in-memory `FeatureMap` values, plus a fully valid map with no problems.
- `features.spec.ts` (temp repo):
  - a valid map exits 0 with the OK line,
  - a broken map exits 1 and lists `path: message` lines,
  - no `featuresDir` prints "No feature map" and exits 0,
  - an unknown feature id in a spec's `tasks.yaml` is an error.
- `loadSpec.spec.ts`: `features` is passed through and defaults to `[]`; a spec with an unknown feature id still loads.
- `templates.spec.ts`, status and run tests unchanged and green.
