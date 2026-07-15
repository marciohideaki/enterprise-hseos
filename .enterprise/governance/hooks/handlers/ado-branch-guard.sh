#!/usr/bin/env bash
# ADO Branch Guard — blocks direct push to trunk branches
# Event: PreToolUse(Bash) — blocking
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_ado-lib.sh"

# Skip if ADO not enabled
is_ado_enabled || exit 0

# Only process git push commands
COMMAND="${CLAUDE_TOOL_COMMAND:-}"
echo "$COMMAND" | grep -qE "^\s*git\s+push" || exit 0

# Extract the branch being pushed to
# Patterns: git push origin main, git push --force origin/main, etc.
BRANCH_REF=""
if echo "$COMMAND" | grep -qE "(main|master|develop|trunk|staging|hmg)"; then
  # Check if it's pushing TO a trunk branch (not from one)
  BRANCH_REF="$(echo "$COMMAND" | grep -oE '\b(main|master|develop|trunk|staging|hmg)\b' | head -1)"
fi

[[ -n "$BRANCH_REF" ]] || exit 0

# Allow if it's a feature branch push that happens to mention trunk in remote tracking
# Only block if pushing directly to trunk
if echo "$COMMAND" | grep -qE "git push.*(origin|ado)\s+(main|master|develop|trunk|staging|hmg)$"; then
  echo "[ADO-BRANCH-GUARD] 🚫 Push direto para '$BRANCH_REF' bloqueado." >&2
  echo "[ADO-BRANCH-GUARD] Crie uma feature branch e abra um PR:" >&2
  echo "[ADO-BRANCH-GUARD]   git checkout -b feature/wave-wNNN-<titulo>" >&2
  echo "[ADO-BRANCH-GUARD]   git push origin feature/wave-wNNN-<titulo>" >&2
  exit 2
fi

exit 0
