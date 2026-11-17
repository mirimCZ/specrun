Spec **Feature Map** (`docs/002-feature-map/`), task **{TASK}**. Decision IDs `FMD-n` refer to
the decision log in `docs/002-feature-map/README.md` — open it only for a decision the brief
cites but doesn't quote.

## Rules of this spec

- A repo without `featuresDir` behaves exactly as before — every feature-map step is skipped
  (FMD-1).
- `loadSpec` never validates feature ids; only `specrun features check` does (FMD-7).
- No Mermaid or markdown parser dependency — regexes over lines (FMD-3).
- Read `docs/testing.md` before writing the first test.
