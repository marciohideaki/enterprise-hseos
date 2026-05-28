#!/usr/bin/env bash
# Tests for ado-pr-link.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
HANDLER="${PROJECT_ROOT}/.agents/hooks/handlers/ado-pr-link.sh"
PASS=0; FAIL=0
ok() { echo "  ✓ $*"; ((PASS++)); }
fail() { echo "  ✗ $*" >&2; ((FAIL++)); }
echo ""; echo "▶ pr-link tests"

bash -n "$HANDLER" && ok "syntax check" || fail "syntax check"

# Non-PR commands should pass
export CLAUDE_TOOL_COMMAND="git status"
R=0; bash "$HANDLER" 2>/dev/null || R=$?
[[ $R -eq 0 ]] && ok "non-PR command skipped" || fail "expected exit 0 for non-PR command"
unset CLAUDE_TOOL_COMMAND

echo ""; echo "  Result: $PASS passed | $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
