#!/usr/bin/env bash
# Tests for ado-branch-guard.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
HANDLER="${PROJECT_ROOT}/.agents/hooks/handlers/ado-branch-guard.sh"
PASS=0; FAIL=0
ok() { echo "  ✓ $*"; ((PASS++)) || true; }
fail() { echo "  ✗ $*" >&2; ((FAIL++)) || true; }
echo ""; echo "▶ branch-guard tests"

bash -n "$HANDLER" && ok "syntax check" || fail "syntax check"

# Non-push commands should pass
export CLAUDE_TOOL_COMMAND="git status"
R=0; bash "$HANDLER" 2>/dev/null || R=$?
[[ $R -eq 0 ]] && ok "non-push command passes" || fail "expected exit 0 for git status"
unset CLAUDE_TOOL_COMMAND

# Feature branch push should pass
export CLAUDE_TOOL_COMMAND="git push origin feature/my-feature"
R=0; bash "$HANDLER" 2>/dev/null || R=$?
[[ $R -eq 0 ]] && ok "feature branch push allowed" || fail "expected exit 0 for feature branch"
unset CLAUDE_TOOL_COMMAND

echo ""; echo "  Result: $PASS passed | $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
