#!/usr/bin/env bash
# Runs every unfinished phase of a spec (docs/<spec>/) with tools/spec-run.sh, one after another,
# until the whole spec is done. Before each task spec-run.sh checks the usage left (pause mode,
# see `tools/spec-run.sh --help`); when the 5h session runs low this script waits for its reset
# and continues. Phase N+1 starts on a branch created from phase N's branch.

set -uo pipefail

usage() {
  cat <<'EOF'
Usage: tools/spec-autorun.sh <spec> [options]

  <spec>   spec name (homebrew) or path to the spec dir (docs/homebrew).

Runs the phases listed in PROGRESS.md in order, skipping those whose tasks are all `done`.
Each phase runs on <spec>/phase-<N>; a missing phase branch is created from the previous
phase's branch (the first one from --base). The run stops when a phase ends with a task that
is not `done` (e.g. `blocked`), when a task or its verification fails, or when the weekly limit
runs low. Re-running the same command continues where it stopped.

Options:
  --min-left <pct>         % of the 5h session that must be left to start a task (default 15);
                           below it the script waits for the session reset
  --weekly-min-left <pct>  % of the weekly limit that must be left (default 5); below it the
                           run stops
  --from <phase>           start with this phase (default: the first unfinished one)
  --base <ref>             start point of the first phase branch if it has to be created
                           (default HEAD)
  --model <name>, --max-turns <n>, --skip-verify, --retry-blocked
                           passed to tools/spec-run.sh

While running, the Mac is kept awake (caffeinate -i) and the terminal title shows the state.
EOF
}

SPEC_ARG=""
MIN_LEFT=15
WEEKLY_MIN_LEFT=5
FROM=""
BASE_REF="HEAD"
PASS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --min-left) MIN_LEFT="$2"; shift ;;
    --weekly-min-left) WEEKLY_MIN_LEFT="$2"; shift ;;
    --from) FROM="$2"; shift ;;
    --base) BASE_REF="$2"; shift ;;
    --model|--max-turns) PASS+=("$1" "$2"); shift ;;
    --skip-verify|--retry-blocked) PASS+=("$1") ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage; exit 2 ;;
    *)
      if [ -z "$SPEC_ARG" ]; then SPEC_ARG="$1"
      else echo "Unexpected argument: $1" >&2; usage; exit 2
      fi
      ;;
  esac
  shift
done

[ -n "$SPEC_ARG" ] || { usage; exit 2; }
for n in "$MIN_LEFT" "$WEEKLY_MIN_LEFT"; do
  [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -le 100 ] || { echo "Not a percentage: $n" >&2; exit 2; }
done

EXIT_PAUSED=75
STATE="stopped"

log() { printf '\n\033[1;35m[spec-autorun %s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { STATE="failed"; printf '\n\033[1;31m[spec-autorun]\033[0m %s\n' "$*" >&2; exit 1; }

title() { [ -t 1 ] && printf '\033]0;%s\007' "$*"; }

cleanup() {
  [ -t 1 ] && printf '\033[?25h'
  title "$SPEC_NAME: $STATE"
  rm -f "$PAUSE_FILE"
}

REPO="$(git rev-parse --show-toplevel)" || exit 1

if [ -d "$SPEC_ARG" ]; then SPEC_DIR="$(cd "$SPEC_ARG" && pwd)"
elif [ -d "$REPO/$SPEC_ARG" ]; then SPEC_DIR="$REPO/$SPEC_ARG"
elif [ -d "$REPO/docs/$SPEC_ARG" ]; then SPEC_DIR="$REPO/docs/$SPEC_ARG"
else die "Spec '$SPEC_ARG' not found (tried it as a path and as docs/$SPEC_ARG)."
fi
SPEC_NAME="$(basename "$SPEC_DIR")"
PROGRESS_REL="${SPEC_DIR#"$REPO"/}/PROGRESS.md"
[ -f "$REPO/$PROGRESS_REL" ] || die "Missing $PROGRESS_REL"

# spec-run.sh switches branches, so HEAD has to be pinned before the first phase starts.
BASE="$(git -C "$REPO" rev-parse --verify --quiet "$BASE_REF^{commit}")" \
  || die "Base '$BASE_REF' is not a commit."

PAUSE_FILE="$(mktemp)"
trap cleanup EXIT
trap 'STATE="interrupted"; exit 130' INT TERM

# Keeps the Mac from idle-sleeping until this script exits.
command -v caffeinate >/dev/null && caffeinate -i -w $$ &

# Prints the phases of the tasks table in order of first appearance.
phases() {
  awk -F'|' '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    NF > 6 && trim($2) != "Phase" && trim($2) !~ /^-+$/ && !seen[trim($2)]++ { print trim($2) }
  ' "$REPO/$PROGRESS_REL"
}

# Prints "<task>\t<status>" for every task of the phase in PROGRESS.md at <ref> (working tree
# when <ref> is empty).
phase_statuses() {
  local phase="$1" ref="$2"
  if [ -n "$ref" ]; then git -C "$REPO" show "$ref:$PROGRESS_REL" 2>/dev/null
  else cat "$REPO/$PROGRESS_REL"
  fi | awk -F'|' -v p="$phase" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    NF > 6 && trim($2) == p { print trim($3) "\t" trim($5) }
  '
}

# Prints "<done>/<total>" for the given statuses; returns 0 when all tasks are done.
done_count() {
  awk -F'\t' '{ n++; if ($2 == "done") d++ } END { printf "%d/%d\n", d, n; exit (d == n && n > 0) ? 0 : 1 }' <<<"$1"
}

branch_exists() { git -C "$REPO" show-ref --verify --quiet "refs/heads/$1"; }

fmt_date() { LC_ALL=C date -r "$1" "$2" 2>/dev/null || LC_ALL=C date -d "@$1" "$2"; }

# "02:00" today, "Sat 02:00" on another day.
fmt_time() {
  if [ "$(fmt_date "$1" +%F)" = "$(date +%F)" ]; then fmt_date "$1" +%H:%M
  else fmt_date "$1" '+%a %H:%M'
  fi
}

pause_value() { sed -n "s/^$1=//p" "$PAUSE_FILE"; }

# Waits until <epoch> with a one-line spinner and countdown (plain log lines when not a TTY).
# The countdown is recomputed from the clock, so it stays right after the Mac wakes up.
wait_until() {
  local target="$1" next="$2" at now left i=0
  local frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
  at="$(fmt_time "$target")"
  title "⏳ $SPEC_NAME $at"
  if [ ! -t 1 ]; then
    log "Waiting for a new session at $at — next $next"
    while now="$(date +%s)"; [ "$now" -lt "$target" ]; do
      left=$((target - now))
      sleep $((left < 30 ? left : 30))
    done
    return
  fi
  printf '\n\033[?25l'
  while now="$(date +%s)"; [ "$now" -lt "$target" ]; do
    left=$((target - now))
    printf '\r\033[K %s Waiting for a new session at %s (%d:%02d:%02d left) — next %s' \
      "${frames[i % ${#frames[@]}]}" "$at" $((left / 3600)) $((left % 3600 / 60)) $((left % 60)) "$next"
    i=$((i + 1))
    sleep 0.2
  done
  printf '\r\033[K\033[?25h'
  log "New session — continuing with $next"
}

# Handles an exit of spec-run.sh in pause mode: waits for the session reset, or stops the run
# when the weekly limit is low.
handle_pause() {
  local reason task resets_at session_left weekly_left now target
  reason="$(pause_value reason)"
  task="$(pause_value task)"
  resets_at="$(pause_value resets_at)"
  session_left="$(pause_value session_left)"
  weekly_left="$(pause_value weekly_left)"
  now="$(date +%s)"

  if [ "$reason" = weekly ]; then
    STATE="paused (weekly limit)"
    log "Weekly limit: ${weekly_left:-?} % left (< $WEEKLY_MIN_LEFT %), resets $(fmt_date "${resets_at:-$now}" '+%a %-d.%-m. %H:%M')."
    log "Stopped before $task. Continue later with: tools/spec-autorun.sh $SPEC_NAME"
    exit "$EXIT_PAUSED"
  fi

  case "$reason" in
    session) log "${session_left:-?} % of the session left (< $MIN_LEFT %)" ;;
    limit) log "Usage limit hit during $task — its partial work is in git stash list" ;;
    *) log "spec-run.sh paused without a reason — waiting 30 min" ;;
  esac
  # A minute after the reset; 30 min when the reset time is unknown, 5 min when it has passed.
  if [ -z "$resets_at" ]; then target=$((now + 1800))
  elif [ $((resets_at + 60)) -le "$now" ]; then target=$((now + 300))
  else target=$((resets_at + 60))
  fi
  wait_until "$target" "${task:-?}"
}

# Runs one phase until spec-run.sh finishes it, waiting through session resets.
run_phase() {
  local phase="$1" base="$2" rc statuses
  while :; do
    : >"$PAUSE_FILE"
    title "▶ $SPEC_NAME phase $phase"
    SPEC_PAUSE_BELOW="$MIN_LEFT" SPEC_PAUSE_WEEKLY_BELOW="$WEEKLY_MIN_LEFT" \
      SPEC_PAUSE_FILE="$PAUSE_FILE" \
      "$REPO/tools/spec-run.sh" "$SPEC_NAME" "$phase" --base "$base" ${PASS[@]+"${PASS[@]}"}
    rc=$?
    case "$rc" in
      0) break ;;
      "$EXIT_PAUSED") handle_pause ;;
      *) die "spec-run.sh stopped in phase $phase (exit $rc) — fix it, then re-run tools/spec-autorun.sh $SPEC_NAME" ;;
    esac
  done

  # spec-run.sh left us on the phase branch.
  statuses="$(phase_statuses "$phase" "")"
  if ! done_count "$statuses" >/dev/null; then
    STATE="stopped (phase $phase unfinished)"
    log "Phase $phase finished with unfinished tasks — not starting the next phase:"
    awk -F'\t' '$2 != "done"' <<<"$statuses" | column -t
    exit 1
  fi
}

# --- main --------------------------------------------------------------------

PHASES="$(phases)"
[ -n "$PHASES" ] || die "No phases found in $PROGRESS_REL."
if [ -n "$FROM" ] && ! grep -qx -- "$FROM" <<<"$PHASES"; then
  die "Phase '$FROM' is not in $PROGRESS_REL (phases: $(tr '\n' ' ' <<<"$PHASES"))."
fi

log "Spec $SPEC_NAME — phases $(tr '\n' ' ' <<<"$PHASES")— pausing below $MIN_LEFT % session / $WEEKLY_MIN_LEFT % weekly left"

REACHED=0
[ -z "$FROM" ] && REACHED=1
for PHASE in $PHASES; do
  BRANCH="$SPEC_NAME/phase-$PHASE"
  REF="$BASE"
  branch_exists "$BRANCH" && REF="$BRANCH"
  [ "$PHASE" = "$FROM" ] && REACHED=1

  STATUSES="$(phase_statuses "$PHASE" "$REF")"
  if [ "$REACHED" -eq 0 ] || COUNT="$(done_count "$STATUSES")"; then
    [ "$REACHED" -eq 1 ] && log "Phase $PHASE already done on $REF — skipping"
    branch_exists "$BRANCH" && BASE="$BRANCH"
    continue
  fi

  log "Phase $PHASE: $COUNT tasks done — running on $BRANCH"
  run_phase "$PHASE" "$BASE"
  BASE="$BRANCH"
done

STATE="done"
log "✔ Spec $SPEC_NAME done — every phase finished."
