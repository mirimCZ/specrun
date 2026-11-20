Spec **Multiple Claude accounts** (`docs/004-multi-account/`), task **{TASK}**. Decision IDs
`MAD-n` refer to the decision log in `docs/004-multi-account/README.md`. Open it only for a
decision the brief cites but doesn't quote.

## Rules of this spec

- Without a global config there is one implicit account `default` and specrun behaves as today
  (MAD-6). The existing tests of the runner, CLI, UI and stats are the regression net. Extend
  their harness if needed, but don't change what existing cases assert.
- A token never reaches events, logs, transcripts, error messages, test snapshots or
  `PROGRESS.md` (MAD-15). Tests use placeholder tokens such as `lorem-token`.
- Never set `CLAUDE_CONFIG_DIR`, and never read or write `~/.claude` credentials (MAD-1).
- Tests never read the real `~/.specrun/config.json`: inject the home dir (`deps.homedir`).
