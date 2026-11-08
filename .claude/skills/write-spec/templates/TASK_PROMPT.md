Implement **one task — {TASK}** — of the <Spec Title> specification in `docs/<spec>/`. You run
unattended — nobody will answer questions — with a fresh context. Your **task brief** is
appended below this prompt (`docs/<spec>/tasks/{TASK}.md`), followed by the implementation notes
of the tasks it depends on (dependencies are already `done`; the runner checked).

### Before starting

1. The brief is self-contained: its decisions are quoted from the spec, its **Read first** list is
   the result of the spec's code research. Read those files (several per command, e.g.
   `cat a.ts b.ts`; `sed -n` for line ranges) — don't explore the codebase beyond them unless
   something the brief needs is missing. Open `docs/<spec>/README.md` only for a decision or
   analysis point the brief refers to but doesn't quote.
2. The dependency notes say what earlier tasks actually built (files, exported names,
   deviations) — they override the brief where they differ. Look at those files instead of
   assuming the spec was implemented literally.

### Implement

1. Implement exactly what the brief describes — nothing from other tasks — following CLAUDE.md.
2. <Spec-specific invariant, e.g. "The journal page keeps its current behaviour; its specs are
   the regression net." / "Game logic in `libs/game-engine` is pure with injected `rng`.">
3. Where the brief says {TASK} supersedes behaviour described in other `docs/*` files, add a
   short note there ("superseded by {TASK}") — don't rewrite those documents.
4. Tests: read `docs/testing.md` before writing the first spec (mocks, MUI queries, known
   traps) and copy its example specs. While iterating run only the specs you touch:
   `npx vitest run --root <project dir> <path or name filter>` (e.g.
   `npx vitest run --root apps/fate-binder app/rooms/board/quick-encounter`). When done run
   `tools/spec-verify.sh` (typecheck, lint, test on affected projects; prints one line when green,
   otherwise the failed tasks and error lines plus the path of the full log — grep that log
   instead of re-running). Don't run `nx` / `tsc` / `eslint` yourself for the final check.
   For a quick typecheck use `npx nx run <project>:typecheck`, never `tsc -p` (it reads stale
   `dist/*.d.ts` of the libs).
   The workspace was green before this run, so every failure is yours to fix.
   Run every command in the foreground — never `run_in_background`, `&` or `nohup`: the
   session ends with your last reply and kills background jobs, so nothing gets committed.
   `tools/spec-verify.sh` takes several minutes; call it with a Bash `timeout` of 600000 and
   without pipes (`| tail` etc.), it already prints a short summary.
5. Fill in `## Implementation notes` at the end of `docs/<spec>/tasks/{TASK}.md` for the tasks
   that build on this one — at most ~15 lines: files created / changed, exported names, props
   and hooks other tasks will use, and every deviation from the brief with its reason. If a
   test problem not covered by `docs/testing.md` cost you several attempts, add a line
   `Test trap: <symptom> → <fix>`. Don't change the rest of the brief.
6. In `docs/<spec>/PROGRESS.md` update only the {TASK} row (status `done`, a one-line note) and
   add `- <YYYY-MM-DD> — {TASK} done.` to the run log.
7. Commit the task's files with the brief and PROGRESS.md: Conventional Commit, scope = feature
   area (<scopes, e.g. `character`, `canvas`, `chat`>), task ID in the subject, e.g.
   `<type>(<scope>): <summary> ({TASK})`. Stage files explicitly — never `git add -A` /
   `git add .`; leave unrelated untracked files alone (`.tmp/` included). Leave the Commit
   column empty — the task ID in the commit subject is the link.

### Rules

- **Ambiguity:** choose the simplest option consistent with the brief's decisions, record it in
  the implementation notes, continue.
- **Blocked** (a test you can't fix in ~3 attempts, needs a forbidden command, the brief is
  impossible as written): revert partial changes (`git checkout -- <files>`, delete files you
  created), mark {TASK} `blocked` in PROGRESS.md with the exact reason, commit PROGRESS.md, stop.
- **Spec bugs:** if the brief is wrong or contradicts the code, implement the sensible fix and
  describe it in the implementation notes.
- **Never:** `git push`, any firebase CLI command, rewrite git history, delete Firestore data,
  add heavy dependencies, modify code unrelated to {TASK}, disable tests or lint rules to get
  green<, spec-specific prohibitions with decision IDs>.
- Finish with a clean working tree for tracked files (`git status --untracked-files=no` shows
  nothing).
