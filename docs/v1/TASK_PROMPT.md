Implement **one task — {TASK}** — of the specrun v1 specification in `docs/v1/`. You run
unattended — nobody will answer questions — with a fresh context. Your **task brief** is
appended below this prompt (`docs/v1/tasks/{TASK}.md`), followed by the implementation notes
of the tasks it depends on (dependencies are already `done`; the runner checked).

### Before starting

1. The brief is self-contained: its decisions are quoted from the spec, its **Read first** list is
   the result of the spec's research. Read those files (several per command, e.g.
   `cat a.ts b.ts`; `sed -n` for line ranges; `grep -n` in `sdk.d.ts`, which is 10k lines — never
   read it whole) — don't explore beyond them unless something the brief needs is missing.
   Open `docs/v1/README.md` only for a decision or analysis point the brief refers to but
   doesn't quote.
2. The dependency notes say what earlier tasks actually built (files, exported names,
   deviations) — they override the brief where they differ. Look at those files instead of
   assuming the spec was implemented literally.

### Implement

1. Implement exactly what the brief describes — nothing from other tasks — following CLAUDE.md.
2. Nothing in tests touches the real Agent SDK, the network or the `claude` CLI: SDK access is
   injected (`query` / `AgentSession`) and tests use the fakes in `test/fakes/`. Modules take
   their side effects as injected dependencies (CLAUDE.md).
3. Where the brief says {TASK} supersedes behaviour described in other `docs/*` files, add a
   short note there ("superseded by {TASK}") — don't rewrite those documents.
4. Tests: read `docs/testing.md` before writing the first spec. While iterating run only the
   specs you touch: `npx vitest run <path or name filter>`; quick typecheck `npm run typecheck`.
   When done run `tools/spec-verify.sh` (typecheck, tests, format check; prints one line when
   green, otherwise the failed step, its error lines and the log path — grep that log instead
   of re-running). Run `npm run format` before it. The workspace was green before this run, so
   every failure is yours to fix. Run every command in the foreground — never
   `run_in_background`, `&` or `nohup`: the session ends with your last reply and kills
   background jobs, so nothing gets committed.
5. Fill in `## Implementation notes` at the end of `docs/v1/tasks/{TASK}.md` for the tasks
   that build on this one — at most ~15 lines: files created / changed, exported names and
   signatures other tasks will use, and every deviation from the brief with its reason. If a
   test problem not covered by `docs/testing.md` cost you several attempts, add a line
   `Test trap: <symptom> → <fix>`. Don't change the rest of the brief.
6. In `docs/v1/PROGRESS.md` update only the {TASK} row (status `done`, a one-line note) and
   add `- <YYYY-MM-DD> — {TASK} done.` to the run log.
7. Commit the task's files with the brief and PROGRESS.md: Conventional Commit, scope = the
   `src/` folder (`config`, `spec`, `events`, `progress`, `git`, `verify`, `limits`,
   `session`, `runner`, `analytics`, `stats`, `cli`, `ui`) or `plugin`, task ID in the subject,
   e.g. `feat(events): append-only event store ({TASK})`. Stage files explicitly — never
   `git add -A` / `git add .`; leave unrelated untracked files alone (`.tmp/` included). Leave
   the Commit column empty — the task ID in the commit subject is the link.

### Rules

- **Ambiguity:** choose the simplest option consistent with the brief's decisions, record it in
  the implementation notes, continue.
- **Blocked** (a test you can't fix in ~3 attempts, needs a forbidden command, the brief is
  impossible as written): revert partial changes (`git checkout -- <files>`, delete files you
  created), mark {TASK} `blocked` in PROGRESS.md with the exact reason, commit PROGRESS.md, stop.
- **Spec bugs:** if the brief is wrong or contradicts the code, implement the sensible fix and
  describe it in the implementation notes.
- **Never:** `git push`, rewrite git history, publish to npm, run the real Agent SDK / `claude`
  except where the brief explicitly allows it (SR-6 probe, SR-12/13 `claude plugin`), modify `tools/` or `spikes/`, add
  dependencies the brief doesn't name, modify code unrelated to {TASK}, disable or skip tests
  to get green, write `spec.json` or rewrite `events.jsonl` from runner code (SRD-5).
- Finish with a clean working tree for tracked files (`git status --untracked-files=no` shows
  nothing).
