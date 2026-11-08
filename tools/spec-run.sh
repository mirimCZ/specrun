#!/usr/bin/env bash
# Runs the implementation tasks of one phase of a spec (docs/<spec>/), each task in a fresh
# `claude -p` session, on the branch <spec>/phase-<N> (created or switched to automatically).
# State lives in docs/<spec>/PROGRESS.md and git. Specs are written by the `write-spec` skill
# (.claude/skills/write-spec/); the prompt of a task is TASK_PROMPT.md + docs/<spec>/tasks/<TASK>.md
# + the "Implementation notes" of the tasks it needs.

set -uo pipefail

usage() {
  cat <<'EOF'
Usage: tools/spec-run.sh <spec> <phase> [options]

  <spec>   spec name (board, character) or path to the spec dir (docs/character).
           The dir must contain PROGRESS.md and TASK_PROMPT.md; optional run.env
           may set OPUS_TASKS="ID ID ..." (tasks that run on opus, others on sonnet).

Prompt:
  TASK_PROMPT.md with {TASK} replaced, then tasks/<TASK>.md (the task brief) if it exists, then
  the "## Implementation notes" section of tasks/<DEP>.md for every task in the dependency table
  of PROGRESS.md. A task whose dependencies are not `done` is skipped without starting a session.
  Sessions get only the Bash, Read, Edit and Write tools — no MCP servers, no skills.

Branch:
  The phase runs on <spec>/phase-<phase>. If it exists the script switches to it,
  otherwise it creates it from --base (default: current HEAD). Requires a clean tracked tree.

Options:
  --base <ref>         start point when the phase branch has to be created (default HEAD)
  --branch <name>      use this branch name instead of <spec>/phase-<phase>
  --no-branch          stay on the current branch (still refuses main/master/rebel)
  --retry-blocked      also run tasks marked `blocked`
  --only <TASK>        run a single task (e.g. --only F-4)
  --model <name>       force model for every task (default: per-task opus/sonnet)
  --max-turns <n>      max agent turns per task (default 150)
  --skip-verify        don't re-run typecheck/lint/test after each task
  --dry-run            print branch + tasks that would run, don't switch branches or call claude

Env:
  SPEC_LOG_DIR         log root (default ~/spec-logs); logs go to <root>/<spec>/phase-<phase>
  SPEC_LIMIT_WAIT      seconds to wait after a usage-limit stop (default 1800)
  SPEC_LIMIT_RETRIES   max waits per task (default 6)

Pause mode (used by tools/spec-autorun.sh):
  SPEC_PAUSE_BELOW         % of the 5h session that must be left to start a task; enables the mode
  SPEC_PAUSE_WEEKLY_BELOW  % of the weekly limit that must be left to start a task (default 10)
  SPEC_PAUSE_FILE          where to write why and until when the run paused (key=value lines)
  Below either threshold, and on a usage-limit stop (partial work stashed), the script exits
  with code 75 instead of waiting; re-running the phase continues where it stopped.

Usage stats:
  Before the first task a tiny haiku call records the 5h session usage; at exit the script prints
  how much of the session the run used, how much is left and when it resets. After every task it
  prints turns, peak context, cache reads and cost, and appends them to <log dir>/stats.tsv and
  to the "## Run stats" table of PROGRESS.md (committed as `docs(<spec>): run stats of <TASK>`).
EOF
}

SPEC_ARG=""
PHASE=""
BASE_REF="HEAD"
BRANCH_OVERRIDE=""
NO_BRANCH=0
RETRY_BLOCKED=0
ONLY=""
MODEL_OVERRIDE=""
MAX_TURNS=150
SKIP_VERIFY=0
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE_REF="$2"; shift ;;
    --branch) BRANCH_OVERRIDE="$2"; shift ;;
    --no-branch) NO_BRANCH=1 ;;
    --retry-blocked) RETRY_BLOCKED=1 ;;
    --only) ONLY="$2"; shift ;;
    --model) MODEL_OVERRIDE="$2"; shift ;;
    --max-turns) MAX_TURNS="$2"; shift ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage; exit 2 ;;
    *)
      if [ -z "$SPEC_ARG" ]; then SPEC_ARG="$1"
      elif [ -z "$PHASE" ]; then PHASE="$1"
      else echo "Unexpected argument: $1" >&2; usage; exit 2
      fi
      ;;
  esac
  shift
done

[ -n "$SPEC_ARG" ] && [ -n "$PHASE" ] || { usage; exit 2; }

log() { printf '\n\033[1;36m[spec-run %s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\n\033[1;31m[spec-run]\033[0m %s\n' "$*" >&2; exit 1; }

REPO="$(git rev-parse --show-toplevel)" || exit 1

# Resolve the spec dir: a path (absolute or repo-relative) or a name under docs/.
if [ -d "$SPEC_ARG" ]; then SPEC_DIR="$(cd "$SPEC_ARG" && pwd)"
elif [ -d "$REPO/$SPEC_ARG" ]; then SPEC_DIR="$REPO/$SPEC_ARG"
elif [ -d "$REPO/docs/$SPEC_ARG" ]; then SPEC_DIR="$REPO/docs/$SPEC_ARG"
else die "Spec '$SPEC_ARG' not found (tried it as a path and as docs/$SPEC_ARG)."
fi
SPEC_NAME="$(basename "$SPEC_DIR")"

PROGRESS="$SPEC_DIR/PROGRESS.md"
TEMPLATE="$SPEC_DIR/TASK_PROMPT.md"
LOG_DIR="${SPEC_LOG_DIR:-$HOME/spec-logs}/$SPEC_NAME/phase-$PHASE"
LIMIT_WAIT="${SPEC_LIMIT_WAIT:-1800}"
LIMIT_RETRIES="${SPEC_LIMIT_RETRIES:-6}"
PAUSE_BELOW="${SPEC_PAUSE_BELOW:-}"
PAUSE_WEEKLY_BELOW="${SPEC_PAUSE_WEEKLY_BELOW:-10}"
PAUSE_FILE="${SPEC_PAUSE_FILE:-}"
EXIT_PAUSED=75

# Per-spec settings (tasks with tricky game logic, security rules or data plumbing → opus).
OPUS_TASKS=""
# shellcheck source=/dev/null
[ -f "$SPEC_DIR/run.env" ] && . "$SPEC_DIR/run.env"
OPUS_TASKS=" $OPUS_TASKS "

trap 'die "Interrupted."' INT TERM

# Prints "<task>\t<status>" for every row of the phase in PROGRESS.md.
phase_tasks() {
  awk -F'|' -v p="$PHASE" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    NF > 6 && trim($2) == p { print trim($3) "\t" trim($5) }
  ' "$PROGRESS"
}

task_status() {
  awk -F'|' -v t="$1" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    NF > 6 && trim($3) == t { print trim($5); exit }
  ' "$PROGRESS"
}

# Prints the dependencies of a task (dependency table: "| <task> | <dep>, <dep> |"), one per line.
task_needs() {
  awk -F'|' -v t="$1" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    NF == 4 && trim($2) == t {
      n = split(trim($3), deps, /[ ,]+/)
      for (i = 1; i <= n; i++) if (deps[i] ~ /[0-9]/) print deps[i]
      exit
    }
  ' "$PROGRESS"
}

# Prints "<dep> (<status>)" for every dependency of the task that is not done.
unmet_needs() {
  local dep status
  while read -r dep; do
    [ -n "$dep" ] || continue
    status="$(task_status "$dep")"
    # In a dry run, tasks listed earlier as "would run" count as done.
    [[ "$DRY_PLANNED" == *" $dep "* ]] && status=done
    [ "$status" = done ] || printf '%s (%s) ' "$dep" "${status:-missing}"
  done <<<"$(task_needs "$1")"
}

# The "## Implementation notes" section of a task brief, without its heading and comment lines.
implementation_notes() {
  awk '/^## Implementation notes/ { on = 1; next } on && /^## / { exit } on && !/^<!--.*-->$/ { print }' "$1"
}

# Prompt of one task: TASK_PROMPT.md + the task brief + the notes of the tasks it needs.
build_prompt() {
  local task="$1" brief="$SPEC_DIR/tasks/$1.md" rel dep notes
  rel="${SPEC_DIR#"$REPO"/}"
  sed "s/{TASK}/$task/g" "$TEMPLATE"
  if [ -f "$brief" ]; then
    printf '\n\n---\n\n<!-- Task brief: %s/tasks/%s.md -->\n\n' "$rel" "$task"
    cat "$brief"
  fi
  while read -r dep; do
    [ -n "$dep" ] && [ -f "$SPEC_DIR/tasks/$dep.md" ] || continue
    notes="$(implementation_notes "$SPEC_DIR/tasks/$dep.md")"
    [ -n "${notes//[[:space:]]/}" ] || continue
    printf '\n\n---\n\n# Implementation notes of %s (dependency)\n\n%s\n' "$dep" "$notes"
  done <<<"$(task_needs "$task")"
}

model_for() {
  if [ -n "$MODEL_OVERRIDE" ]; then echo "$MODEL_OVERRIDE"
  elif [[ "$OPUS_TASKS" == *" $1 "* ]]; then echo opus
  else echo sonnet
  fi
}

tracked_dirty() { [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]; }

is_protected() {
  case "$1" in main|master|rebel|"") return 0 ;; *) return 1 ;; esac
}

# Switches to (or creates) the phase branch. In dry-run only reports what would happen.
prepare_branch() {
  local current target
  current="$(git -C "$REPO" branch --show-current)"

  if [ "$NO_BRANCH" -eq 1 ]; then
    is_protected "$current" && die "Refusing to run on branch '$current' (--no-branch)."
    BRANCH="$current"
    return
  fi

  target="${BRANCH_OVERRIDE:-$SPEC_NAME/phase-$PHASE}"
  is_protected "$target" && die "Refusing to use protected branch '$target'."
  git check-ref-format --branch "$target" >/dev/null 2>&1 || die "Invalid branch name '$target'."
  BRANCH="$target"

  if [ "$current" = "$target" ]; then
    log "Already on $target"
    return
  fi

  if git -C "$REPO" show-ref --verify --quiet "refs/heads/$target"; then
    if [ "$DRY_RUN" -eq 1 ]; then
      log "[dry-run] would switch $current → $target (exists); statuses below are from $target"
      # Read the task statuses the real run would see.
      local snapshot
      snapshot="$(mktemp)"
      if git -C "$REPO" show "$target:${PROGRESS#"$REPO"/}" >"$snapshot" 2>/dev/null; then
        PROGRESS="$snapshot"
      else
        log "[dry-run] $target has no ${PROGRESS#"$REPO"/} — showing the current branch's"
      fi
      return
    fi
    tracked_dirty && die "Uncommitted tracked changes — commit or stash before switching to $target."
    git -C "$REPO" switch -q "$target" || die "Could not switch to $target."
    log "Switched $current → $target"
  else
    git -C "$REPO" rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null \
      || die "Base '$BASE_REF' is not a commit."
    if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] would create $target from $BASE_REF"; return; fi
    tracked_dirty && die "Uncommitted tracked changes — commit or stash before creating $target."
    git -C "$REPO" switch -q -c "$target" "$BASE_REF" || die "Could not create $target."
    log "Created $target from $BASE_REF ($(git -C "$REPO" rev-parse --short HEAD))"
  fi
}

# Human-readable view of the stream-json event log.
pretty() {
  node -e '
    const rl = require("readline").createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      let e;
      try { e = JSON.parse(line); } catch { return; }
      if (e.type === "assistant") {
        for (const c of e.message?.content ?? []) {
          if (c.type === "text") console.log("💬 " + c.text);
          else if (c.type === "tool_use") {
            const i = c.input ?? {};
            const arg = String(i.command ?? i.file_path ?? i.pattern ?? i.description ?? "");
            console.log("🔧 " + c.name + "  " + arg.split("\n")[0].slice(0, 160));
          }
        }
      } else if (e.type === "result") {
        console.log("✅ result: " + (e.subtype ?? "") + "  turns=" + e.num_turns + (e.is_error ? "  ERROR" : ""));
      }
    });
  '
}

# Prints session usage from the rate_limit_event lines of the given stream-json logs.
# Mode `start` prints the current state; `end` also prints what the run used, summed per 5h
# window so a reset during the run (usage-limit waits) doesn't skew the number.
usage_report() {
  node -e '
    const fs = require("fs");
    const [mode, ...files] = process.argv.slice(1);
    const events = [];
    for (const f of files) {
      let text;
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      for (const line of text.split("\n")) {
        if (!line.includes("\"rate_limit_event\"")) continue;
        try {
          const w = JSON.parse(line).rate_limit_info?.unifiedWindows;
          if (w?.five_hour) events.push(w);
        } catch {}
      }
    }
    if (!events.length) { console.log("Usage stats unavailable (no rate_limit_event in logs)"); process.exit(0); }
    const pct = (u) => Math.round(u * 100);
    const when = (s) => new Date(s * 1000).toLocaleString("en-GB",
      { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    const last = events[events.length - 1];
    const session = "left " + (100 - pct(last.five_hour.utilization)) + " %, resets " + when(last.five_hour.resetsAt);
    const weekly = last.seven_day
      ? "\n  weekly: left " + (100 - pct(last.seven_day.utilization)) + " %, resets " + when(last.seven_day.resetsAt)
      : "";
    if (mode === "start") { console.log("Usage at start (5h session): " + session + weekly); process.exit(0); }
    const windows = new Map();
    for (const w of events) {
      const g = windows.get(w.five_hour.resetsAt);
      if (g) g.last = w.five_hour.utilization;
      else windows.set(w.five_hour.resetsAt, { first: w.five_hour.utilization, last: w.five_hour.utilization });
    }
    let used = 0;
    for (const g of windows.values()) used += g.last - g.first;
    const resets = windows.size > 1 ? " (" + (windows.size - 1) + " reset(s) during the run)" : "";
    console.log("Usage (5h session): used " + pct(used) + " %" + resets + ", " + session + weekly);
  ' "$@"
}

# Prints "<session left %> <session reset epoch> <weekly left %> <weekly reset epoch>" from the
# last rate_limit_event of the given stream-json logs; nothing when there is none.
usage_now() {
  node -e '
    const fs = require("fs");
    let last;
    for (const f of process.argv.slice(1)) {
      let text;
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      for (const line of text.split("\n")) {
        if (!line.includes("\"rate_limit_event\"")) continue;
        try {
          const w = JSON.parse(line).rate_limit_info?.unifiedWindows;
          if (w?.five_hour) last = w;
        } catch {}
      }
    }
    if (!last) process.exit(0);
    const left = (u) => Math.round(100 - u * 100);
    const week = last.seven_day ?? { utilization: 0, resetsAt: "" };
    console.log([left(last.five_hour.utilization), last.five_hour.resetsAt, left(week.utilization), week.resetsAt].join(" "));
  ' "$@"
}

# Pause mode: writes the pause file and exits with EXIT_PAUSED.
pause() {
  local reason="$1" task="$2" resets_at="$3" session_left="$4" weekly_left="$5"
  if [ -n "$PAUSE_FILE" ]; then
    printf 'reason=%s\ntask=%s\nresets_at=%s\nsession_left=%s\nweekly_left=%s\n' \
      "$reason" "$task" "$resets_at" "$session_left" "$weekly_left" >"$PAUSE_FILE"
  fi
  log "Pausing at $task ($reason: session ${session_left:-?} % left, weekly ${weekly_left:-?} % left)"
  exit "$EXIT_PAUSED"
}

# Pause mode: pauses when too little of the session or week is left to start the task.
pause_if_low() {
  local task="$1" session_left session_reset weekly_left weekly_reset
  [ -n "$PAUSE_BELOW" ] || return 0
  read -r session_left session_reset weekly_left weekly_reset <<<"$(usage_now "${RUN_LOGS[@]}")"
  [ -n "$session_left" ] || return 0
  if [ "$weekly_left" -lt "$PAUSE_WEEKLY_BELOW" ]; then
    pause weekly "$task" "$weekly_reset" "$session_left" "$weekly_left"
  fi
  if [ "$session_left" -lt "$PAUSE_BELOW" ]; then
    pause session "$task" "$session_reset" "$session_left" "$weekly_left"
  fi
}

# Minimal claude call whose stream-json log carries the current rate_limit_event.
usage_probe() {
  claude -p "Reply with OK." --model haiku --max-turns 1 --tools "" --strict-mcp-config \
    --no-session-persistence --output-format stream-json --verbose >"$1" 2>/dev/null
}

# Runs one claude session; returns 0 ok, 3 usage limit, 1 other failure.
run_claude() {
  local task="$1" model="$2" logfile="$3" rc result
  build_prompt "$task" \
    | claude -p --model "$model" --permission-mode acceptEdits --max-turns "$MAX_TURNS" \
        --tools "Bash,Read,Edit,Write" --strict-mcp-config --disable-slash-commands \
        --output-format stream-json --verbose \
    | tee "$logfile" | pretty
  rc=${PIPESTATUS[1]}
  result="$(grep '"type":"result"' "$logfile" | tail -n 1)"
  if [ "$rc" -eq 0 ] && [ -n "$result" ] && ! grep -q '"is_error":true' <<<"$result"; then
    return 0
  fi
  if tail -n 20 "$logfile" | grep -qiE 'usage limit|rate.?limit|limit reached|reset at|429|overloaded'; then
    return 3
  fi
  return 1
}

# Prints "turns, peak context, cache reads, cost" of a task log and appends a row to stats.tsv.
# A second line carries the same values tab-separated (date, model, turns, peak context, cache
# read, cache write, output, cost) for record_stats.
task_stats() {
  local task="$1" model="$2" logfile="$3"
  node -e '
    const fs = require("fs");
    const [task, model, file, tsv] = process.argv.slice(1);
    let turns = 0, peak = 0, read = 0, written = 0, out = 0, cost = "";
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "assistant" && e.message?.usage) {
        const u = e.message.usage;
        const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        peak = Math.max(peak, ctx);
      } else if (e.type === "result") {
        turns = e.num_turns ?? turns;
        read = e.usage?.cache_read_input_tokens ?? 0;
        written = e.usage?.cache_creation_input_tokens ?? 0;
        out = e.usage?.output_tokens ?? 0;
        cost = e.total_cost_usd != null ? e.total_cost_usd.toFixed(2) : "";
      }
    }
    const k = (n) => Math.round(n / 1000) + "k";
    const m = (n) => (n / 1e6).toFixed(1) + "M";
    console.log(`Stats ${task} (${model}): ${turns} turns, peak context ${k(peak)}, cache read ${m(read)}, cache write ${k(written)}, output ${k(out)}` + (cost ? `, $${cost}` : ""));
    const date = new Date().toISOString().slice(0, 10);
    console.log([date, model, turns, k(peak), m(read), k(written), k(out), cost ? "$" + cost : "—"].join("\t"));
    if (!fs.existsSync(tsv)) fs.writeFileSync(tsv, "date\ttask\tmodel\tturns\tpeak_ctx\tcache_read\tcache_write\toutput\tcost_usd\n");
    fs.appendFileSync(tsv, [new Date().toISOString(), task, model, turns, peak, read, written, out, cost].join("\t") + "\n");
  ' "$task" "$model" "$logfile" "$LOG_DIR/stats.tsv" 2>/dev/null || true
}

# Adds a row to the "## Run stats" table of PROGRESS.md (created at the end of the file when
# missing) and commits it. Task is the first column: the PROGRESS parsers above match the task
# table by its 2nd/3rd column and the dependency table by its column count.
record_stats() {
  local task="$1" result="$2" attempt="$3" cells="$4" rel row line tmp c
  [ -n "$cells" ] || return 0
  rel="${PROGRESS#"$REPO"/}"
  IFS=$'\t' read -r -a c <<<"$cells"
  row="| $task | ${c[0]} | ${c[1]} | $result | $attempt | ${c[2]} | ${c[3]} | ${c[4]} | ${c[5]} | ${c[6]} | ${c[7]} |"
  if ! grep -q '^## Run stats' "$PROGRESS"; then
    cat >>"$PROGRESS" <<'EOF'

## Run stats

Appended by `tools/spec-run.sh` after every finished task session (`Attempt` counts usage-limit
restarts; stats of interrupted attempts are only in the log dir's `stats.tsv`).

| Task | Date | Model | Result | Attempt | Turns | Peak context | Cache read | Cache write | Output | Cost |
| ---- | ---- | ----- | ------ | ------- | ----- | ------------ | ---------- | ----------- | ------ | ---- |
EOF
  fi
  # Insert after the last table line of the section, so sections added later stay below it.
  line="$(awk '/^## Run stats/ { s = 1; next } s && /^## / { exit } s && /^\|/ { n = NR } END { print n }' "$PROGRESS")"
  tmp="$(mktemp)"
  awk -v n="$line" -v row="$row" '{ print } NR == n { print row }' "$PROGRESS" >"$tmp" && cat "$tmp" >"$PROGRESS"
  rm -f "$tmp"
  (cd "$REPO" && npx prettier --write "$rel" >/dev/null 2>&1) \
    || log "Could not format $rel — committing the stats unformatted"
  git -C "$REPO" add -- "$rel" \
    && git -C "$REPO" commit -q -m "docs($SPEC_NAME): run stats of $task" -- "$rel" \
    || log "Could not commit the stats of $task in $rel — commit them by hand"
}

# Runs typecheck, lint and test on projects affected since <base>; retries once on failure.
verify() {
  local base="$1" attempt
  for attempt in 1 2; do
    "$REPO/tools/spec-verify.sh" --base "$base" && return 0
    [ "$attempt" -eq 1 ] && log "Verification failed — retrying once"
  done
  return 1
}

# --- preflight -------------------------------------------------------------

[ "$DRY_RUN" -eq 1 ] || command -v claude >/dev/null || die "claude CLI not found in PATH."
[ -f "$PROGRESS" ] || die "Missing $PROGRESS"
[ -f "$TEMPLATE" ] || die "Missing $TEMPLATE"

TASKS="$(phase_tasks)"
[ -n "$TASKS" ] || die "No tasks found for phase $PHASE in $PROGRESS."

prepare_branch
if [ "$DRY_RUN" -eq 0 ] && tracked_dirty; then
  die "Working tree has uncommitted tracked changes — commit or stash first."
fi

# The branch switch may have changed PROGRESS.md — re-read the tasks.
TASKS="$(phase_tasks)"
[ -n "$TASKS" ] || die "No tasks found for phase $PHASE in $PROGRESS on $BRANCH."
[ "$DRY_RUN" -eq 1 ] || mkdir -p "$LOG_DIR"

log "Spec $SPEC_NAME, phase $PHASE on branch $BRANCH — logs in $LOG_DIR"
printf '%s\n' "$TASKS" | column -t

# Logs of this run, read by usage_report; the start probe comes first.
RUN_LOGS=()
if [ "$DRY_RUN" -eq 0 ]; then
  PROBE_LOG="$LOG_DIR/_usage-start-$(date +%Y%m%d-%H%M%S).jsonl"
  usage_probe "$PROBE_LOG" || log "Usage probe failed — start usage taken from the first task"
  RUN_LOGS+=("$PROBE_LOG")
  log "$(usage_report start "$PROBE_LOG")"
  trap 'log "$(usage_report end "${RUN_LOGS[@]}")"' EXIT
fi

# --- main loop ---------------------------------------------------------------

DRY_PLANNED=" "

while IFS=$'\t' read -r TASK _ <&3; do
  [ -n "$ONLY" ] && [ "$TASK" != "$ONLY" ] && continue

  STATUS="$(task_status "$TASK")"
  case "$STATUS" in
    done) log "$TASK already done — skipping"; continue ;;
    blocked) [ "$RETRY_BLOCKED" -eq 1 ] || { log "$TASK blocked — skipping (use --retry-blocked)"; continue; } ;;
  esac

  UNMET="$(unmet_needs "$TASK")"
  if [ -n "$UNMET" ]; then
    log "$TASK needs ${UNMET% } — skipping"
    continue
  fi

  MODEL="$(model_for "$TASK")"
  if [ "$DRY_RUN" -eq 1 ]; then
    BRIEF="no task brief"
    [ -f "$SPEC_DIR/tasks/$TASK.md" ] && BRIEF="brief tasks/$TASK.md"
    log "[dry-run] would run $TASK ($STATUS) with $MODEL — $BRIEF, prompt $(build_prompt "$TASK" | wc -c | tr -d ' ') chars"
    DRY_PLANNED+="$TASK "
    continue
  fi
  pause_if_low "$TASK"

  BEFORE="$(git -C "$REPO" rev-parse HEAD)"
  ATTEMPT=0
  while :; do
    LOGFILE="$LOG_DIR/$TASK-$(date +%Y%m%d-%H%M%S).jsonl"
    RUN_LOGS+=("$LOGFILE")
    log "▶ $TASK with $MODEL (attempt $((ATTEMPT + 1)))"
    run_claude "$TASK" "$MODEL" "$LOGFILE"
    RC=$?
    STATS="$(task_stats "$TASK" "$MODEL" "$LOGFILE")"
    log "$(head -n 1 <<<"$STATS")"
    [ "$RC" -eq 0 ] && break

    if [ "$RC" -eq 3 ] && { [ -n "$PAUSE_BELOW" ] || [ "$ATTEMPT" -lt "$LIMIT_RETRIES" ]; }; then
      ATTEMPT=$((ATTEMPT + 1))
      if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
        git -C "$REPO" stash push --include-untracked -m "spec-run $SPEC_NAME $TASK partial (usage limit)" >/dev/null
        log "Partial work of $TASK stashed (git stash list) — next attempt starts clean"
      fi
      if [ -n "$PAUSE_BELOW" ]; then
        read -r S_LEFT S_RESET W_LEFT _ <<<"$(usage_now "$LOGFILE")"
        pause limit "$TASK" "$S_RESET" "$S_LEFT" "$W_LEFT"
      fi
      log "Usage limit hit — waiting $((LIMIT_WAIT / 60)) min before retrying $TASK"
      sleep "$LIMIT_WAIT"
      continue
    fi
    die "$TASK failed (see $LOGFILE)."
  done

  tracked_dirty && die "$TASK left uncommitted tracked changes — inspect before continuing."

  STATUS="$(task_status "$TASK")"
  record_stats "$TASK" "${STATUS:-?}" "$((ATTEMPT + 1))" "$(sed -n 2p <<<"$STATS")"
  case "$STATUS" in
    done)
      if [ "$SKIP_VERIFY" -eq 0 ]; then
        log "Verifying $TASK (typecheck, lint, test on affected projects)"
        verify "$BEFORE" || die "Verification failed after $TASK — fix before continuing."
      fi
      log "✔ $TASK done"
      ;;
    blocked) log "✖ $TASK blocked — continuing with the next task" ;;
    *) die "$TASK finished but PROGRESS.md says '$STATUS' — inspect $LOGFILE." ;;
  esac
done 3<<<"$TASKS"

log "Spec $SPEC_NAME, phase $PHASE summary (branch $BRANCH):"
phase_tasks | column -t
