# <PX>-n — <Title>

Phase 1 · Needs: <PX>-m, … | — · Implements: <PD>-n, …

<Goal in 2–3 sentences: what the user sees afterwards / what changes in the code, and why.>

## Decisions

<!-- Quote every decision this task implements, verbatim from README §3, plus binding answers
from §5 and constraints from other specs. The agent does not read the README. -->

- **<PD>-n** — <decision>

## Read first

<!-- The research result: files to change, one pattern to copy for each kind of new file
(component, hook, spec, API endpoint, rules), the types it uses. 3–10 entries, each with what
to look at (symbol or line range) and why. Paths only — never pasted code. -->

- `path/to/File.tsx` — <what to change / `SymbolName`, lines 40–90>
- `path/to/Similar.tsx` + `Similar.spec.tsx` — pattern to copy for <the new component and its spec>

## Changes

- <Concrete change with the real file path, names of new components / functions / props.>
- <i18n keys (cs + en) if new UI text is added.>
- <Docs to annotate: `docs/<other>/<file>.md` — "superseded by <PX>-n".>

## Done when

- <Specs that must exist and what they assert.>
- <Behaviour that must stay unchanged, and the existing specs guarding it.>

## Implementation notes

<!-- Filled in by the implementing agent: files, exported names, deviations. -->
