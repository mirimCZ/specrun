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
5. **Review and merge** the spec branch `specrun/<spec>` (one commit per task).
6. **Archive** — `specrun archive <spec>` replaces the finished spec by its README and run
   history, and removes its worktree and branch.
7. **Improve** — `/feedback` in Claude Code turns the run's stats and the agents' reported
   deviations into proposals for your CLAUDE.md, specs and sizes.

## Specs

A spec is a folder under `specsDir` (default `docs/`):

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
    phase: 1 # phases are checkpoints (see below)
    needs: [] # task ids, or `all`; never a task of a later phase
    model: strong # default | strong (opus / sonnet are accepted aliases)
    size: L # S | M | L — the expected turns and cost, see `sizes`
  - id: TR-2
    title: Trait picker
    phase: 1
    needs: [TR-1]
```

Each session gets specrun's protocol, the spec's `TASK_PROMPT.md`, the brief and the notes that
finished dependencies left for it. The project's `CLAUDE.md` is loaded too. Agents only edit
files: the runner owns git.

## Running

```sh
specrun run <spec> [--task <id>] [--retry-blocked] [--all-phases] [--base <ref>] [--model <alias>] [--no-ui]
```

For each runnable task (dependencies done, lowest open phase first):

1. **Usage check** — below `limits.sessionMinLeft` % of the 5-hour window it waits for the reset;
   below `limits.weeklyMinLeft` % of the week it stops (exit 75).
2. **Session** — the agent works until it calls `complete_task` (summary, commit message, notes
   for dependent tasks, deviations) or `block_task` (reason). Hitting a usage limit mid-session
   waits for the reset and resumes the same session.
3. **Verify** — the configured check runs. Red: the same session gets the failure summary and
   tries again, up to `verifyFixRounds` times; still red → the task is blocked.
4. **Commit** — green: one commit on the spec branch, message from the agent plus
   `Specrun-Task` / `Specrun-Session` trailers.

A blocked task's changes are parked under `refs/specrun/parked/<spec>/<task>` (see them with
`git show <ref>`) and the next task starts from a clean tree. Tasks that need a blocked one wait;
`--retry-blocked` runs blocked tasks again.

**Phases** are checkpoints: the run stops once every task of the lowest unfinished phase is done
or blocked, so you can review before the next phase. `--all-phases` runs through.

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

| Exit code | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| 0         | Spec done, phase checkpoint reached, or stopped on request |
| 1         | Failure (the message says why)                             |
| 75        | Stopped on the weekly usage limit                          |
| 130       | Interrupted                                                |

On macOS specrun keeps the machine awake (`caffeinate`) while it runs.

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

| Key               | Default                                             | Meaning                                                              |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| `worktree`        | `true`                                              | Run each spec in its own worktree (see [Workspace](#workspace))      |
| `worktreeFiles`   | `[]`                                                | Ignored files copied from the checkout into a new worktree           |
| `setup`           | `null` (`init`: from the lockfile, e.g. `npm ci`)   | Runs once in a new worktree                                          |
| `verify`          | required (`init`: `npm run check` or the scripts)   | `{ name, command }[]`, run in order after each task; first red stops |
| `limits`          | `{ "sessionMinLeft": 15, "weeklyMinLeft": 5 }`      | % left of the 5-hour / weekly window below which a run waits / stops |
| `specsDir`        | `"docs"`                                            | Folder with the specs                                                |
| `models`          | `{ "default": "sonnet", "strong": "opus" }`         | Model per `model` value in `tasks.yaml`; `--model` overrides all     |
| `maxTurns`        | `150`                                               | Turn limit of one session; reaching it blocks the task               |
| `verifyFixRounds` | `2`                                                 | Fix attempts after a red check                                       |
| `sizes`           | S 10–25 turns $0.60 · M 20–45 $1.20 · L 40–70 $2.50 | Expected range per size; exceeding it is recorded, never enforced    |
| `transcriptsDir`  | `"~/.specrun/runs"`                                 | Session transcripts (outside the repository)                         |
| `commitTrailers`  | `[]`                                                | Extra trailer lines for every task commit                            |

## Other commands

| Command                                                                | What it does                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `specrun status [spec] [--json]`                                       | All specs at a glance, or one spec's task table, branch, worktree and lock                     |
| `specrun set <spec> <task> <todo\|done\|blocked> --reason <text>`      | Override a task's status by hand (recorded in the log)                                         |
| `specrun stats [spec...] [--by task\|model\|size\|spec] [--calibrate]` | Turns, cost and context of finished tasks; `--calibrate` suggests `sizes`                      |
| `specrun deviations [spec...] [--kind <kind>]`                         | What agents reported as spec bugs, ambiguities, constraints, test traps, scope                 |
| `specrun analyze [spec] [--task <id>] [--reindex]`                     | Per-session analytics from the transcripts: file reads and edits, rereads, tool and Bash calls |
| `specrun archive <spec> [--force]`                                     | Archive a finished spec, remove its merged worktree and branch                                 |

`status`, `stats`, `deviations` and `analyze` work from another terminal during a run, and all
of them take `--json` (format in [`docs/json-output.md`](docs/json-output.md)).

## Development

```sh
npm install
npm run typecheck
npm test
npm run build      # → dist/, bin `specrun` = dist/cli/main.js
tools/spec-verify.sh  # typecheck + test + format check, short summary
```

Node ≥ 22, TypeScript strict, ESM, vitest, zod, Ink, Prettier (100 columns). Conventions are in
[`CLAUDE.md`](CLAUDE.md), testing rules in [`docs/testing.md`](docs/testing.md).
