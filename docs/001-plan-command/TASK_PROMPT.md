Spec **Plan Command** (`docs/001-plan-command/`), task **{TASK}**. Decision IDs `PLD-n` refer to
the decision log in `docs/001-plan-command/README.md` — open it only for a decision the brief
cites but doesn't quote.

## Rules of this spec

- Planning metrics are tokens only — never add prices or USD for planning sessions (PLD-6).
- The plan context carries no content from other specs or their deviations (PLD-4).
- Tests never start `claude` or read `~/.claude`: inject the launcher and the Claude config dir,
  write transcripts into the temp dir.
- Read `docs/testing.md` before writing the first test.
