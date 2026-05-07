#!/usr/bin/env bash
# HSEOS code-index-post-edit handler — Wave 4 implementation slice (W4-T7)
#
# Event:   PostToolUse (matcher: Write|Edit)
# Status:  active (replaces upstream ~/.claude/hooks/axon-post-edit.sh)
#
# Pluggable code-index re-index trigger. After a file is written or edited,
# notifies the active code-index provider (if any) so the index stays
# fresh. Currently supports the Axon provider; new providers plug in by
# adding a marker-directory detection branch below.
#
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: appending the same path twice is harmless (provider dedupes)
#   - Best-effort: never blocks the triggering action; exit 0 always
#   - Project-scoped: only writes inside the detected provider's directory
#   - Config-aware: detects providers via marker directories
#   - Fail-open: silent no-op when no provider is installed (P6 graceful
#     degradation) — downstream skills fall back to Read+Grep

set -euo pipefail

# The compiled hook entry passes the file path as $1.
FILE_PATH="${1:-}"

# No file path provided — silent no-op (e.g. wrong matcher)
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Walk up from the file's directory to find a project root with a code-index
# marker. This handles the case where the hook fires from a subdirectory.
DIR="${FILE_PATH%/*}"
[[ "$DIR" == "$FILE_PATH" ]] && DIR="$PWD"
[[ -d "$DIR" ]] || DIR="$PWD"

PROJECT_ROOT=""
PROVIDER=""

# Climb up to 8 levels looking for a known marker.
for _ in 1 2 3 4 5 6 7 8; do
  if [[ -d "$DIR/.axon" ]]; then
    PROJECT_ROOT="$DIR"
    PROVIDER="axon"
    break
  fi
  # Reserved for future providers (continue, cursor, repo-radar):
  #   if [[ -d "$DIR/.continue/index" ]]; then PROVIDER="continue"; break; fi
  parent="${DIR%/*}"
  [[ "$parent" == "$DIR" || -z "$parent" ]] && break
  DIR="$parent"
done

# No provider detected — silent no-op (P6)
if [[ -z "$PROVIDER" ]]; then
  exit 0
fi

case "$PROVIDER" in
  axon)
    QUEUE="$PROJECT_ROOT/.axon/pending-writes.txt"
    LOCK="$QUEUE.lock"

    # Atomic append with flock so concurrent hooks do not corrupt the queue.
    # The Axon MCP server drains this queue on its next tool call.
    (
      flock -x 9
      echo "$FILE_PATH" >> "$QUEUE"
    ) 9> "$LOCK" 2>/dev/null || true
    ;;
  *)
    # Unknown provider — should not happen given the explicit detection above
    exit 0
    ;;
esac

exit 0
