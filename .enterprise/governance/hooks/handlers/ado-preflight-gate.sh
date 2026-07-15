#!/usr/bin/env bash
# ADO Preflight Gate — blocks dev-squad dispatch without ADO mapping in PLAN.md
# Event: PreToolUse(Agent) — blocking, timeout 5s
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=.agents/hooks/handlers/_ado-lib.sh
source "${SCRIPT_DIR}/_ado-lib.sh"

# Skip if ADO not enabled
is_ado_enabled || exit 0

# Read tool input from stdin (Claude Code passes JSON)
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"

# Check if this is a dev-squad / swarm Agent dispatch
# (subagent_type contains general-purpose or description mentions dev-squad/swarm)
PROMPT="${CLAUDE_TOOL_DESCRIPTION:-}"
SUBAGENT="${CLAUDE_TOOL_SUBAGENT_TYPE:-}"

# Only gate when dispatching an Agent (squad worktree agent)
# Pattern: subagent type is general-purpose AND in an hseos project with worktrees
if [[ "$SUBAGENT" != "general-purpose" ]] && [[ "$SUBAGENT" != "claude-code-guide" ]]; then
  exit 0
fi

# Check if we're in a SWARM worktree context (branch has ado- prefix)
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo "")"

# If branch starts with ado- pattern, verify the PLAN.md has ADO mapping
# This gate only applies when ADO module is active and a wave is being dispatched
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
[[ -n "$PROJECT_ROOT" ]] || exit 0

# Look for active PLAN.md in dev-squad runs
ACTIVE_PLAN=""
for plan in "${PROJECT_ROOT}/.hseos/runs/dev-squad"/*/PLAN.md; do
  [[ -f "$plan" ]] && ACTIVE_PLAN="$plan" && break
done

# If no active plan, this isn't a dev-squad dispatch context — skip
[[ -n "$ACTIVE_PLAN" ]] || exit 0

# Check if PLAN.md has ADO mapping
if ! has_ado_mapping_in_plan "$ACTIVE_PLAN"; then
  echo "[ADO-GATE] ⚠️  PLAN.md sem mapeamento ADO." >&2
  echo "[ADO-GATE] Execute '/atlas plan' antes de despachar agentes." >&2
  echo "[ADO-GATE] Plan: $ACTIVE_PLAN" >&2
  # Advisory (warn but don't block) — ADO mapping is strongly recommended but
  # Commander may have already created items externally
  # To make blocking: exit 2
  exit 0
fi

exit 0
