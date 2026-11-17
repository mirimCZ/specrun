# FM-1 — Feature map loader: config, schema, mermaid nodes

Phase 1 · Needs: — · Implements: FMD-1, FMD-2, FMD-3, FMD-4, FMD-5 (parsing only)

Adds `featuresDir` to the config and a pure loader that reads a feature map into a typed model:
the README's index rows and diagram nodes, and every feature doc's frontmatter and sections. The
check (FM-2) turns the model into errors. This task only parses and reports what it can't parse.

## Decisions

- **FMD-1** — Config `featuresDir` (default `docs/features`, repo-relative). Map: `<featuresDir>/README.md`. Feature doc: `<featuresDir>/<area>/<name>.md`; feature id `<area>/<name>`, both parts kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). No `<featuresDir>` → the repo has no feature map and every feature-map step is skipped.
- **FMD-2** — H1, one intro paragraph, exactly one fenced `mermaid` block (a `flowchart`, one `subgraph` per area), then a `## Features` table with columns `ID | Title | Summary`; the ID cell is a link `[<id>](<id>.md)`; one row per feature, sorted by id.
- **FMD-3** — Node id of a feature = its id with `/` and `-` replaced by `_` (`board/fog-cells` → `board_fog_cells`). Every feature must have a node **defined** with a label (`<nodeId>` followed by `[`, `(`, `{` or `>`) inside the mermaid block. Every defined node must belong to a feature. Edges are free and not checked. Lines starting with `subgraph`, `end`, `%%`, `classDef`, `class`, `style`, `click`, `linkStyle`, `flowchart`, `graph` are ignored. Two features mapping to one node id is an error. Regex-based, no Mermaid dependency.
- **FMD-4** — YAML frontmatter, strict: `id` (= path), `title`, `status: draft | verified`, `depends_on: id[]` (default `[]`), `code: path[]` (min 1), `tests: path[]` (default `[]`), `specs: string[]` (default `[]`). Paths are repo-relative files or folders, no globs.
- **FMD-5** (structure) — sections `## Purpose`, `## Capabilities`, `## Expectations` required, `## Pitfalls` and `## Out of scope` optional, in this order. Capabilities are the top-level `- ` bullets of their section.
- README §2: a node can be defined inside an edge line (`a[A] --> b[B]`), and shapes include `([…])`, `[[…]]`, `>…]`. Plain ids in edges only reference nodes.

## Read first

- `src/config/configSchema.ts` + `configSchema.spec.ts` — `ConfigSchema` defaults (`specsDir` pattern)
- `src/spec/specSchema.ts` — zod strict schema style
- `src/spec/loadSpec.ts` — `readYamlFile`, `SpecrunError` usage, `formatIssues`
- `src/spec/loadSpec.spec.ts` — temp-dir test pattern for a loader
- `docs/testing.md` — temp dir rules

## Changes

- `src/config/configSchema.ts`: `featuresDir: z.string().min(1).default('docs/features')`. Add a test in `configSchema.spec.ts`.
- New `src/features/featureSchema.ts`: `FEATURE_ID_PATTERN`, `FeatureFrontmatterSchema` (strict), `nodeIdOf(id)`, `REQUIRED_SECTIONS`, `OPTIONAL_SECTIONS`.
- New `src/features/mermaidNodes.ts` + `.spec.ts`: `mermaidBlocks(markdown): string[]` and `definedNodes(block): string[]` (FMD-3).
- New `src/features/loadFeatureMap.ts` + `.spec.ts`: `loadFeatureMap(repoRoot, config): FeatureMap | null` (`null` when `featuresDir` doesn't exist). `FeatureMap = { readme: { path, mermaidBlocks: number, nodes: string[], rows: { id, link, title }[] } | null, docs: FeatureDoc[], problems: Problem[] }`. `FeatureDoc = { path, idFromPath, frontmatter | null, sections: string[], capabilities: number }`. `Problem = { path, message, level: 'error' | 'warning' }`. Unparseable frontmatter becomes a problem, not a throw.
- `CLAUDE.md` layout: `features/   feature map: schema, loader, check (specrun features)`.

## Done when

- `mermaidNodes.spec.ts` covers:
  - all six shapes,
  - nodes defined inside edge lines,
  - plain edge ids not counted,
  - ignored keyword lines and `%%` comments,
  - several blocks counted.
- `loadFeatureMap.spec.ts` (temp dir):
  - a valid map loads rows, nodes, docs, sections and capability counts,
  - a missing `featuresDir` gives `null`,
  - a missing README gives `readme: null`,
  - broken YAML and a schema violation each yield an error problem with the doc's path,
  - docs are found recursively as `<area>/<name>.md` (other depths reported).
- `nodeIdOf('board/fog-cells') === 'board_fog_cells'`.
- Existing config tests unchanged and green.
