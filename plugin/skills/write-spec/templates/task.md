# <PX>-n — <Title>

Phase 1 · Needs: <PX>-m, … | — · Implements: <PD>-n, …

<Goal in 2–3 sentences: what the user sees afterwards / what changes in the code, and why.>

## Decisions

<!-- Quote every decision this task implements, verbatim from README §3, plus binding answers
from §5 and constraints from other specs. The agent does not read the README. -->

- **<PD>-n** — <decision>

## Read first

<!-- The research result: files to change, one pattern to copy for each kind of new file
(module, component, test, endpoint, schema), the types it uses. 3–10 entries, each with what
to look at (symbol or line range) and why. Paths only — never pasted code. -->

- `path/to/module.ts` — <what to change / `symbolName`, lines 40–90>
- `path/to/similar.ts` + `similar.test.ts` — pattern to copy for <the new module and its test>

## Changes

- <Concrete change with the real file path, names of new modules / functions / props.>
- <Translation keys if new UI text is added.>
- <Docs to annotate: `docs/<other>/<file>.md` — "superseded by <PX>-n".>

## Done when

- <Tests that must exist and what they assert.>
- <Behaviour that must stay unchanged, and the existing tests guarding it.>
