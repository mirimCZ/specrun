#!/usr/bin/env bash
# Typecheck, test and format check with short output: one line when green; on failure the failed
# step, its error lines (capped) and the path of the full log for further grepping. Used by the
# bootstrap runner (tools/spec-run.sh) and its agents while specrun builds itself.
#
# Usage: tools/spec-verify.sh [--base <ref>]   (--base is accepted for spec-run.sh and ignored:
#                                              the whole package is always checked)

set -uo pipefail

while [ $# -gt 0 ]; do
  case "$1" in
    --base) shift ;;
    -h|--help) sed -n 2,7p "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

REPO="$(git rev-parse --show-toplevel)" || exit 1
LOG_DIR="$REPO/.tmp/spec-verify"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y%m%d-%H%M%S).log"
MAX_LINES="${SPEC_VERIFY_MAX_LINES:-60}"

strip_ansi() { sed -E $'s/\x1b\\[[0-9;?]*[A-Za-z]//g'; }

# Runs one npm script; returns its exit code, output appended to $LOG under a header.
run_step() {
  printf '\n===== %s =====\n' "$1" >>"$LOG"
  (cd "$REPO" && npm run --silent "$1") 2>&1 | grep -v '^npm warn' | strip_ansi >>"$LOG"
  return "${PIPESTATUS[0]}"
}

report_failure() {
  local step="$1"
  echo "verify: FAILED at $step — full log: ${LOG#"$REPO"/}"
  echo "--- errors (first $MAX_LINES lines) ---"
  # The failed step's section only: tsc errors, vitest failures, prettier's unformatted files.
  awk -v step="$step" '
    /^===== / { on = ($2 == step); next }
    on && (/error TS[0-9]+/ || /^ *(FAIL|×) |AssertionError|^ *(Error|TypeError|ReferenceError|SyntaxError):|^[-+] (Expected|Received)|❯ .*:[0-9]+:[0-9]+|^\[warn\]/) {
      if ($0 !~ /node_modules\//) print
    }
  ' "$LOG" | awk '!seen[$0]++' | head -n "$MAX_LINES"
}

: >"$LOG"
for step in typecheck test format:check; do
  run_step "$step" || { report_failure "$step"; exit 1; }
done

echo "verify: OK (typecheck, test, format:check) — log: ${LOG#"$REPO"/}"
