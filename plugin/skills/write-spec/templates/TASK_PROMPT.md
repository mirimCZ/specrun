Spec **<Spec Title>** (`docs/<spec>/`), task **{TASK}**. Decision IDs `<PD>-n` refer to the
decision log in `docs/<spec>/README.md` — open it only for a decision the brief cites but
doesn't quote.

## Rules of this spec

- <Key invariant, e.g. "The export keeps its current file format; its tests are the regression
  net." / "Domain logic in `src/domain` stays pure with an injected clock.">
- <Spec-specific prohibition with its decision ID, e.g. "Never change the public `Order` API
  (<PD>-3).">

<!-- Optional, only what CLAUDE.md doesn't already say:
- Read `<test docs>` before writing the first test.
- While iterating run only the tests you touch: `<command with a path filter>`.
-->
