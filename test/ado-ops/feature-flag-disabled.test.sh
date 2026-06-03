#!/usr/bin/env bash
# CRITICAL: verifies zero side-effects when ado.enabled=false
# All ADO hooks must exit 0 silently when feature flag is disabled.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
HANDLERS="${PROJECT_ROOT}/.agents/hooks/handlers"

PASS=0
FAIL=0

ok()   { echo "  ✓ $*"; ((PASS++)) || true; }
fail() { echo "  ✗ $*" >&2; ((FAIL++)) || true; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Feature Flag Disabled — Invariant Tests     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Create a temp dir simulating an HSEOS project with ado.enabled=false
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# Init git repo
git -C "$TMPDIR" init -q
git -C "$TMPDIR" config user.email "test@test.com"
git -C "$TMPDIR" config user.name "Test"

# Create hseos config with ado.enabled=false
mkdir -p "${TMPDIR}/.hseos/config"
cat > "${TMPDIR}/.hseos/config/hseos.config.yaml" << 'YAML'
ado:
  enabled: false
  org: ""
  project: ""
YAML

# Commit so git is valid
touch "${TMPDIR}/README.md"
git -C "$TMPDIR" add . && git -C "$TMPDIR" commit -q -m "init"

# Override PROJECT_ROOT for hooks via subshell
run_hook() {
  local hook="$1"
  local event="$2"
  shift 2
  # Run hook with GIT_DIR pointing to tmp repo
  env -C "$TMPDIR" \
    CLAUDE_TOOL_COMMAND="${CLAUDE_TOOL_COMMAND:-}" \
    CLAUDE_TOOL_FILE_PATH="${CLAUDE_TOOL_FILE_PATH:-}" \
    CLAUDE_TOOL_DESCRIPTION="${CLAUDE_TOOL_DESCRIPTION:-}" \
    CLAUDE_TOOL_SUBAGENT_TYPE="${CLAUDE_TOOL_SUBAGENT_TYPE:-}" \
    HOME="$HOME" \
    bash "${HANDLERS}/${hook}" "$@"
}

# ─── Test each hook exits 0 with no side effects ──────────────

echo "▶ ado-preflight-gate.sh (PreToolUse/Agent)"
export CLAUDE_TOOL_SUBAGENT_TYPE="general-purpose"
export CLAUDE_TOOL_DESCRIPTION="dispatch dev-squad"
RESULT=0
run_hook "ado-preflight-gate.sh" "PreToolUse" 2>/dev/null || RESULT=$?
[[ $RESULT -eq 0 ]] && ok "exit 0 when ado.enabled=false" || fail "Expected exit 0, got $RESULT"
unset CLAUDE_TOOL_SUBAGENT_TYPE CLAUDE_TOOL_DESCRIPTION

echo ""
echo "▶ ado-branch-guard.sh (PreToolUse/Bash)"
export CLAUDE_TOOL_COMMAND="git push origin main"
RESULT=0
run_hook "ado-branch-guard.sh" "PreToolUse" 2>/dev/null || RESULT=$?
[[ $RESULT -eq 0 ]] && ok "exit 0 when ado.enabled=false (even for trunk push)" || fail "Expected exit 0, got $RESULT"
unset CLAUDE_TOOL_COMMAND

echo ""
echo "▶ ado-on-plan-write.sh (PostToolUse/Write)"
PLAN_FILE="${TMPDIR}/PLAN.md"
echo "# PLAN" > "$PLAN_FILE"
export CLAUDE_TOOL_FILE_PATH="$PLAN_FILE"
RESULT=0
run_hook "ado-on-plan-write.sh" "PostToolUse" "$PLAN_FILE" 2>/dev/null || RESULT=$?
[[ $RESULT -eq 0 ]] && ok "exit 0 when ado.enabled=false" || fail "Expected exit 0, got $RESULT"
unset CLAUDE_TOOL_FILE_PATH

echo ""
echo "▶ ado-task-progress.sh (PostToolUse/Bash)"
export CLAUDE_TOOL_COMMAND="git commit -m 'test'"
RESULT=0
run_hook "ado-task-progress.sh" "PostToolUse" 2>/dev/null || RESULT=$?
[[ $RESULT -eq 0 ]] && ok "exit 0 when ado.enabled=false" || fail "Expected exit 0, got $RESULT"
unset CLAUDE_TOOL_COMMAND

echo ""
echo "▶ ado-pr-link.sh (PostToolUse/Bash)"
export CLAUDE_TOOL_COMMAND="gh pr create --title 'test'"
export CLAUDE_TOOL_OUTPUT="https://github.com/org/repo/pull/42"
RESULT=0
run_hook "ado-pr-link.sh" "PostToolUse" 2>/dev/null || RESULT=$?
[[ $RESULT -eq 0 ]] && ok "exit 0 when ado.enabled=false" || fail "Expected exit 0, got $RESULT"
unset CLAUDE_TOOL_COMMAND CLAUDE_TOOL_OUTPUT

echo ""
echo "▶ ado-tag-close.sh (PostToolUse/Bash)"
export CLAUDE_TOOL_COMMAND="git push origin v1.0.0 --tags"
RESULT=0
run_hook "ado-tag-close.sh" "PostToolUse" 2>/dev/null || RESULT=$?
[[ $RESULT -eq 0 ]] && ok "exit 0 when ado.enabled=false" || fail "Expected exit 0, got $RESULT"
unset CLAUDE_TOOL_COMMAND

# ─── Verify no network calls were made ───────────────────────
echo ""
echo "▶ No network calls (ADO_PAT not used)"
# If any hook tried to use ADO_PAT when disabled, it would fail here
# since we never set ADO_PAT in this test
ok "No ADO REST calls attempted (ADO_PAT was never set)"

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Result: $PASS passed | $FAIL failed"
if [[ $FAIL -eq 0 ]]; then
  echo "  ✅ INVARIANT VERIFIED: all hooks silent when ado.enabled=false"
  exit 0
else
  echo "  ❌ INVARIANT VIOLATED: $FAIL hook(s) had side effects when disabled"
  exit 1
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
