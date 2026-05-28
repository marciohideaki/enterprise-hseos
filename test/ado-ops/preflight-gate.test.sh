#!/usr/bin/env bash
# Tests for ado-preflight-gate.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
HANDLER="${PROJECT_ROOT}/.agents/hooks/handlers/ado-preflight-gate.sh"
PASS=0; FAIL=0
ok() { echo "  ✓ $*"; ((PASS++)); }
fail() { echo "  ✗ $*" >&2; ((FAIL++)); }
echo ""; echo "▶ preflight-gate tests"

# Test 1: exits 0 when ado.enabled=false (covered by feature-flag test)
bash -n "$HANDLER" && ok "syntax check" || fail "syntax check"

# Test 2: exits 0 for non-Agent tools
export CLAUDE_TOOL_SUBAGENT_TYPE="explore"
R=0; bash "$HANDLER" 2>/dev/null || R=$?
[[ $R -eq 0 ]] && ok "skip for non-dev-squad agent type" || fail "expected exit 0 for explore type"
unset CLAUDE_TOOL_SUBAGENT_TYPE

echo ""; echo "  Result: $PASS passed | $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
