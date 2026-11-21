# specrun

Runs implementation specs task by task with Claude, unattended: each task in a fresh Agent SDK
session, dependencies first, waiting out plan usage limits, verifying and committing on green,
and recording run analytics and deviations from the brief for later feedback.

The design and its decision log (`SRD-*`) are in [`docs/v1/README.md`](docs/v1/README.md).

## Requirements

- Node ≥ 22 and git.
- [Claude Code](https://claude.com/claude-code), logged in with a Claude subscription. specrun
  uses its credentials through the Agent SDK — no API key, sessions count against the plan.

## Install

specrun is not on npm yet; install it from a clone:

```sh
git clone <specrun repository> && cd specrun
npm install
npm run do          # build + npm link → `specrun` on your PATH
```

The Claude Code plugin with the authoring skills (`refine`, `write-spec`, `feedback`) comes from
the same repository. In Claude Code:

```
/plugin marketplace add <path or GitHub owner/repo of specrun>
/plugin install specrun@specrun
```

## Quick start

In the repository you want to work on:

1. **Configure** — `specrun init` asks a few questions (see [Configuration](#configuration))
   and writes `specrun.config.json`, plus `.specrun/` to `.gitignore` and a `merge=union` rule
   for `events.jsonl` to `.gitattributes`. `specrun run` offers the same wizard when the config
   is missing.
2. **Write a spec** — in Claude Code, `/refine <request>` turns a rough request into decisions,
   then `/write-spec` writes `docs/<spec>/` (see [Specs](#specs)).
3. **Commit the spec** — the run starts from `HEAD`, so uncommitted spec files are not seen.
4. **Run it** — `specrun run <spec>`. Leave it running; it waits out usage limits by itself.
5. **Review the deviations** — `specrun review <spec>` walks through what the agents decided on
   their own with you in Claude Code and adds fix tasks for the picks you overturn (see
   [Other commands](#other-commands)); run the spec again for those.
6. **Review the code and close** — look through the spec branch `specrun/<spec>` (one commit per
   task), then `specrun close <spec>` merges it into your current branch and archives the spec:
   its README and run history stay, its worktree and branch go (see
   [Other commands](#other-commands)).
7. **Improve** — `/feedback` in Claude Code turns the run's stats and the agents' reported
   deviations into proposals for your CLAUDE.md, specs and sizes.

## Specs

A spec is a folder under `specsDir` (default `specrun/specs/`):

```
docs/<spec>/
  tasks.yaml        task list — authored, never written by specrun
  README.md         request, analysis, decision log (for humans and agents)
  TASK_PROMPT.md    optional: spec-specific rules added to every task prompt ({TASK} = task id)
  tasks/<ID>.md     one self-contained brief per task
  events.jsonl      written by specrun: append-only run log, the source of every status
  PROGRESS.md       written by specrun: generated task table, regenerated on every commit
```

`tasks.yaml`:

```yaml
title: Character traits # optional, defaults to the folder name
branch: feat/traits # optional, defaults to specrun/<spec>
tasks:
  - id: TR-1 # ^[A-Z][A-Z0-9]*-[0-9]+$, brief in tasks/TR-1.md
    title: Trait rules data and character model
    phase: 1 # lower phases run first (see below)
    needs: [] # task ids, or `all`; never a task of a later phase
    model: strong # default | strong (opus / sonnet are accepted aliases)
    size: L # XS | S | M | L | XL — the expected turns and cost, see `sizes`
  - id: TR-2
    title: Trait picker
    phase: 1
    needs: [TR-1]
```

Each session gets specrun's protocol, the spec's `TASK_PROMPT.md`, the brief and the notes that
finished dependencies left for it. The project's `CLAUDE.md` is loaded too. Agents only edit
files: the runner owns git.

## Feature map

A repo can keep a map of what its product does at user level: `<featuresDir>/README.md` (an
overview graph and an index) plus one doc per feature at `<featuresDir>/<area>/<name>.md`.
`featuresDir` defaults to `specrun/features`; without that folder every feature-map step is skipped.
The format and how to update it are in the plugin's `feature-map` skill (templates included).

`specrun features check` validates the map — index, graph, frontmatter, paths, sections and the
`features:` of tasks — and exits 1 on errors. Add it to `verify` in `specrun.config.json`
(`{ "name": "features", "command": "specrun features check" }`) to keep the map true.

### Bootstrapping an existing repo

Ask the `feature-map` skill to "create the feature map" in a repo without `<featuresDir>/README.md`:

1. **Inventory** — it scans cheap signals (CLAUDE.md, entry points, folders, docs, test names) and
   proposes areas, features and a diagram. Nothing is written.
2. **Review** — you merge, split or rename features; nothing is written before you approve.
3. **Drafts** — one subagent per area writes its docs with `status: draft`.
4. **Assemble** — the README (diagram + index), then `specrun features check` until green.
5. **Final message** — the drafts to verify, plus proposals you decide on: trim the CLAUDE.md
   sections the map covers, add `specrun features check` to `verify`.

Only you flip `draft` to `verified` — do it gradually, e.g. when a spec touches a doc.

## Planning

`specrun plan -n <name>` creates the next numbered spec folder (`docs/<NNN>-<name>/`) and starts
Claude Code on this terminal with `/specrun:plan <spec>`. `-f <file>` hands over a request file
verbatim, `--resume` continues the spec's latest planning session, `--print` shows what Claude
would get. `--account <name>` starts Claude on that account instead of the priority account
(see [Global config](#global-config)). The `plan` skill runs fixed phases: **context** (read only what the request touches),
**refine** (checklist, then interactive questions), **gate** ("Write the spec now?"), **write**
(write-spec into the prepared folder), **validate** (`specrun status <spec>`) and **commit
message** (a proposal for the spec's commit).

specrun logs each planning session in the spec's `events.jsonl` — turns and tokens only, no
prices — and shows it in `specrun stats` (`planning` in `--json`); archiving keeps it. When Claude
exits and the spec loads, `specrun plan` commits the spec folder (incl. `events.jsonl`, nothing
else) on the checked-out HEAD. The message is the one the skill proposed in
`.specrun/plan/<spec>.commit`, else `docs(<spec>): plan spec` (`update spec` once it is committed),
with a `Specrun-Plan-Session` trailer and `commitTrailers`. An invalid spec stays uncommitted.

## Running

```sh
specrun run <spec> [--task <id>] [--retry-blocked] [--base <ref>] [--model <alias>] [--account <name>] [-b] [--no-ui] [--chime | --no-chime]
specrun run --all [--dry-run] [--retry-blocked] [--base <ref>] [--model <alias>] [--account <name>] [-b] [--no-ui] [--chime | --no-chime]
```

With several accounts in `~/.specrun/config.json`, the run switches to the next account when one
is used up; `-b` / `--burn` also moves on when the 5-hour window is low instead of waiting for its
reset, and `--account <name>` pins the run to one account.

With `chimeOnFinish` (or `--chime`; `--no-chime` wins over the config) a run that ends on a
terminal calls you back: a sound every 2 s (macOS: Glass on success, Basso otherwise; elsewhere
the terminal bell) until you press a key, at most 30 minutes, before the questions after a
complete run. Ctrl+C at that point stops the sound and skips the questions. No chime after
Ctrl+C during the run, outside a terminal, or when the run ends within `chimeSilentBetween`.

For each runnable task (dependencies done, lowest open phase first):

1. **Usage check** — below `limits.sessionMinLeft` % of the 5-hour window it waits for the reset;
   below `limits.weeklyMinLeft` % of the week it stops (exit 75).
2. **Session** — the agent works until it calls `complete_task` (summary, commit message, notes
   for dependent tasks, deviations) or `block_task` (reason). Hitting a usage limit mid-session
   waits for the reset and resumes the same session.
3. **Verify** — the configured check runs. Red: the same session gets the failure summary and
   tries again, up to `verifyFixRounds` times; still red → the task is blocked. The spec's last
   task (every other task done) also runs the `verifyFinal` steps, e.g. the full test suite when
   `verify` tests only what the change touches.
4. **Commit** — green: one commit on the spec branch, message from the agent plus
   `Specrun-Task` / `Specrun-Session` trailers.

A blocked task's changes are parked under `refs/specrun/parked/<spec>/<task>` (see them with
`git show <ref>`) and the next task starts from a clean tree. Tasks that need a blocked one wait;
`--retry-blocked` runs blocked tasks again.

**Phases** only order the work: a run goes on until nothing is runnable, the lowest phase first —
a later phase runs while an earlier one waits for a blocked task.

**Resuming** — everything lives in files, so running `specrun run <spec>` again continues where
it stopped; an interrupted session is resumed with its context.

### Dashboard and controls

In a terminal `run` shows a live dashboard: a log of milestones (task started, verify, commit,
block, waits, usage) above a box with every task, the running task's turns, context, cost and
current tool call, the usage windows or the wait countdown. With `--no-ui` or when the output is
piped it prints log lines instead.

| Key                    | Effect                                                                           |
| ---------------------- | -------------------------------------------------------------------------------- |
| `Ctrl+C` (first) / `s` | Finish the running task (verify, fixes, commit or block), start no other; exit 0 |
| `c`                    | Cancel a pending stop — the run goes on                                          |
| `Ctrl+C` (second)      | Interrupt now; the task resumes on the next run (exit 130)                       |
| SIGTERM                | Interrupt now                                                                    |

A stop requested while the run waits for a usage limit ends it at once. `s` and `c` exist only
in the dashboard; without it, `Ctrl+C` works the same two-step way.

| Exit code | Meaning                                                |
| --------- | ------------------------------------------------------ |
| 0         | Spec done (or nothing runnable), or stopped on request |
| 1         | Failure (the message says why)                         |
| 75        | Stopped on the weekly usage limit                      |
| 130       | Interrupted                                            |

On macOS specrun keeps the machine awake (`caffeinate`) while it runs.

**After a complete run** — when every task is done and the dashboard runs on a terminal, specrun
stays open and asks: _Run specrun review on the finished specs?_ (only with deviations), then,
once Claude exits, _Run specrun close on the finished specs?_. Between the two it offers to
commit what the review changed and to run the fix tasks it added. `n` or `Ctrl+C` ends it.

### All specs at once

`specrun run --all` runs every spec under `specsDir` (the archive aside), alphabetically, in one
shared worktree `.specrun/worktrees/.all` on the branch `specrun/all` — each spec sees the
commits of the ones before it. A spec that ends done goes on to the next; a weekly limit, a stop
request, an interrupt or a failure ends the whole run with that spec's exit code. Specs with
nothing to run are skipped. At the end it prints one row per spec (result, tasks, blocked, cost,
time) and keeps it in `.specrun/logs/all/summary-<time>.md`.

- It refuses to start while a spec has its own worktree or branch (`specrun/<spec>`, or `branch`
  in `tasks.yaml`) — finish and close those first.
- On later runs it first merges `--base` (default `HEAD`) into `specrun/all`, so specs committed
  meanwhile join; a real merge runs the check, and a conflict or a red check undoes it and stops.
- `specrun run <spec>` for a spec that ran there continues in the shared worktree.
- `--dry-run` lists the order, each spec's state and the reasons it would refuse, changing nothing.
- `specrun close --all` closes them together (below); `close <spec>` refuses such a spec.

## Workspace

By default each spec runs in its own git worktree at `.specrun/worktrees/<spec>` on the spec
branch, created from `--base` (default `HEAD`) on the first run. You can keep working in your
checkout meanwhile and run several specs at once. A new worktree has no ignored files: list the
ones it needs (e.g. `.env`) in `worktreeFiles`, and install dependencies with `setup`.

With `"worktree": false` the spec runs in your main checkout instead: specrun switches it to the
spec branch (refused when it has uncommitted changes) and runs no `setup`. Don't edit files while
it runs — blocking a task resets and cleans the checkout. Only one such run per checkout.

## Configuration

`specrun.config.json` in the repository root. `specrun init` asks for the common keys in this
order — prefilled from the existing file, whose other keys it keeps — and can try the check right
away; `specrun init --yes` writes the detected defaults without asking (`--force` to change an
existing file).

| Key                  | Default                                                                               | Meaning                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `worktree`           | `true`                                                                                | Run each spec in its own worktree (see [Workspace](#workspace))                              |
| `worktreeFiles`      | `[]`                                                                                  | Ignored files copied from the checkout into a new worktree                                   |
| `setup`              | `null` (`init`: from the lockfile, e.g. `npm ci`)                                     | Runs once in a new worktree                                                                  |
| `verify`             | required (`init`: `npm run check` or the scripts)                                     | `{ name, command }[]`, run in order after each task; first red stops                         |
| `verifyFinal`        | `[]`                                                                                  | Steps added after `verify` for the spec's last task and after a merge (`close`, `run --all`) |
| `limits`             | `{ "sessionMinLeft": 15, "weeklyMinLeft": 5 }`                                        | % left of the 5-hour / weekly window below which a run waits / stops                         |
| `limits.accounts`    | `{}`                                                                                  | Account name → partial `limits` override (see [Global config](#global-config))               |
| `specsDir`           | `"specrun/specs"`                                                                     | Folder with the specs                                                                        |
| `models`             | `{ "default": "sonnet", "strong": "opus" }`                                           | Model per `model` value in `tasks.yaml`; `--model` overrides all                             |
| `maxTurns`           | `150`                                                                                 | Turn limit of one session; reaching it blocks the task                                       |
| `verifyFixRounds`    | `2`                                                                                   | Fix attempts after a red check                                                               |
| `sizes`              | XS 5–15 turns $0.30 · S 10–25 $0.60 · M 20–45 $1.20 · L 40–70 $2.50 · XL 60–110 $4.50 | Expected range per size; exceeding it is recorded, never enforced                            |
| `transcriptsDir`     | `"~/.specrun/runs"`                                                                   | Session transcripts (outside the repository)                                                 |
| `commitTrailers`     | `[]`                                                                                  | Extra trailer lines for every task commit                                                    |
| `chimeOnFinish`      | `false`                                                                               | Repeat a sound when a run ends until a key is pressed; `--chime` / `--no-chime` override     |
| `chimeSilentBetween` | `{ "from": "00:00", "to": "08:00" }`                                                  | Local `HH:MM` window without the chime (may span midnight); `null`: always chime             |

### Global config

`~/.specrun/config.json` holds settings for every repository on this machine: the Claude accounts
specrun can run tasks with. Without it there is one implicit account `default` that uses your
Claude Code login, and specrun behaves as described above. The order of `accounts` is the
priority: the first one is the priority account. `token` is `{ "env": "<VAR>" }` or
`{ "command": "<shell command>" }`. An account without `token` uses the system login, and at most
one account may omit it.

```json
{
  "accounts": [
    {
      "name": "lorem-pro",
      "token": { "env": "SPECRUN_PRO2_TOKEN" },
      "limits": { "sessionMinLeft": 10, "weeklyMinLeft": 5 }
    },
    { "name": "ipsum", "limits": { "sessionMinLeft": 30, "weeklyMinLeft": 20 } }
  ]
}
```

Each limit field of an account comes from the first level that sets it: `limits.accounts.<name>`
in `specrun.config.json` > `limits` of the account in `~/.specrun/config.json` > `limits` in
`specrun.config.json` > the defaults (15 / 5). If `limits.accounts` names an account the global
config doesn't define, you get a warning, not an error.

## Other commands

| Command                                                                      | What it does                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `specrun plan -n <name> [-f <file>] [--resume] [--print] [--account <name>]` | Plan a spec with Claude Code on this terminal (see Planning)                                   |
| `specrun accounts`                                                           | List the Claude accounts in priority order with token source, limits and a usage probe         |
| `specrun status [spec] [--json]`                                             | All specs at a glance, or one spec's task table, branch, worktree and lock                     |
| `specrun set <spec> <task> <todo\|done\|blocked> --reason <text>`            | Override a task's status by hand (recorded in the log)                                         |
| `specrun stats [spec...] [--by task\|model\|size\|spec] [--calibrate]`       | Turns, cost and context of finished tasks; `--calibrate` suggests `sizes`                      |
| `specrun deviations [spec...] [--kind <kind>]`                               | What agents reported as spec bugs, ambiguities, constraints, test traps, scope                 |
| `specrun review [spec...] [--kind <kind>] [--include-reviewed] [--print]`    | Review those deviations with Claude Code on this terminal (below)                              |
| `specrun analyze [spec] [--task <id>] [--reindex]`                           | Per-session analytics from the transcripts: file reads and edits, rereads, tool and Bash calls |
| `specrun archive <spec> [--force]`                                           | Archive a finished spec, remove its merged worktree and branch                                 |
| `specrun close <spec> [--into <branch>] [--force]`                           | Merge the spec branch (fast-forward, else a merge commit + verify) and archive the spec        |
| `specrun close --all [--into <branch>] [--force]`                            | The same for `specrun/all`: one merge, then archive every spec that ran there                  |
| `specrun shelve <spec> --reason <text> [--remote <name>] [--no-push]`        | Push the spec branch, archive the spec without merging it, remove the worktree                 |
| `specrun unshelve <spec> [--into <branch>] [--force] [--no-merge]`           | Bring a shelved spec back, merge it like `close` and archive it as merged                      |

`status`, `stats`, `deviations` and `analyze` work from another terminal during a run, and all
of them take `--json` (format in [`docs/json-output.md`](docs/json-output.md)).

**Closing a spec** — `specrun close <spec>` checks first that every task is done, nothing runs,
and both the main checkout and the worktree are clean. It merges the spec branch into the
checked-out branch (`--into` for another one; a checkout left on the spec branch by
`"worktree": false` goes back to main / master): a fast-forward when possible, else a merge
commit followed by the configured check — a red check keeps the merge but stops before archiving.
A conflict aborts the merge. Then it runs `specrun archive` and deletes the spec branch. It never
pushes. `specrun close --all` does the same for `specrun/all`: every spec that ran there must be
done (`--force` archives them anyway), then it archives each of them and removes the shared
worktree and branch.

**Shelving a spec** — when a spec's work should not be merged (yet) but not be lost either,
`specrun shelve <spec> --reason "…"` pushes its branch to `origin` (`--remote` for another,
`--no-push` keeps it local), archives the spec as with `specrun archive` but without a merge —
unfinished tasks are fine, the README note says it is not merged, why and where the work is — and
removes the worktree; the branch stays. `specrun status` lists shelved specs separately, `stats` and
`deviations` mark them. `specrun unshelve <spec>` takes it back: it fetches the branch if needed,
restores the spec folder, merges and verifies like `close` and archives the spec as merged.
`--no-merge` only restores it, to finish it with `specrun run` and `specrun close`.

**Reviewing deviations** — `specrun review <spec>` starts Claude Code on the same terminal. specrun
first gathers what the review needs — the config, each task's brief, its commit (message, changed
files, the diffs of files a deviation names), the decision log rows the deviations cite and the
next free IDs — and hands it over as part of the system prompt (`.specrun/review/<spec>.md`), so
Claude starts with an overview of every deviation and its verdict instead of reading files. It
then asks until everything is decided: every question an agent decided on its own, with a
recommendation to confirm or overturn it, each proposed fix for the rules that caused the rest as
its own yes/no question, and the clear cases in one final question. Every option shows a preview of
what it changes and costs. With your answers it edits those files, records the decisions in the
spec's README and adds fix tasks (with briefs) for overturned picks, so `specrun run <spec>` can
apply them. When Claude exits, specrun asks whether to mark the deviations as reviewed (in
`events.jsonl`, or `history.json` of an archived spec — commit it with the review's edits); the
next `specrun review` then shows only new ones, `--include-reviewed` all of them. `--print` shows
what Claude would get. `--account <name>` starts Claude on that account instead of the priority
account.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build      # → dist/, bin `specrun` = dist/cli/main.js
npm run check      # verify:typecheck → verify:test → verify:format, compact output
```

Node ≥ 22, TypeScript strict, ESM, vitest, zod, Ink, Prettier (100 columns). Conventions are in
[`CLAUDE.md`](CLAUDE.md), testing rules in [`docs/testing.md`](docs/testing.md).
