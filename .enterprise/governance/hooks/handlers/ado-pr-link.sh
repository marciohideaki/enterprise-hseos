#!/usr/bin/env bash
# ADO PR Link — links GitHub PR to ADO Story after gh pr create
# Event: PostToolUse(Bash) — non-blocking, best-effort
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_ado-lib.sh"

# Skip if ADO not enabled
is_ado_enabled || exit 0

# Only process gh pr create or az repos pr create
COMMAND="${CLAUDE_TOOL_COMMAND:-}"
echo "$COMMAND" | grep -qE "gh\s+pr\s+create|az\s+repos\s+pr\s+create" || exit 0

# Get output from the tool call
TOOL_OUTPUT="${CLAUDE_TOOL_OUTPUT:-}"
[[ -n "$TOOL_OUTPUT" ]] || exit 0

# Extract PR URL from output
PR_URL="$(echo "$TOOL_OUTPUT" | grep -oE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+' | head -1)"
[[ -n "$PR_URL" ]] || exit 0

PR_NUMBER="$(echo "$PR_URL" | grep -oE '[0-9]+$')"

# Find Story ADO ID from ado-mapping.json
MAPPING_FILE="$(get_ado_mapping_file)"
if [[ -z "$MAPPING_FILE" ]]; then
  echo "[ADO-PR-LINK] ℹ️  ado-mapping.json não encontrado — link manual necessário." >&2
  exit 0
fi

# Extract story ID for current wave (basic heuristic: current branch wave pattern)
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo "")"
WAVE_NUM="$(echo "$CURRENT_BRANCH" | grep -oE 'w[0-9]+' | head -1 | tr -d 'w')"

STORY_ID=""
if [[ -n "$WAVE_NUM" ]] && command -v jq &>/dev/null; then
  STORY_ID="$(jq -r ".stories[\"wave-w${WAVE_NUM}\"] // empty" "$MAPPING_FILE" 2>/dev/null)"
fi

if [[ -n "${STORY_ID:-}" ]]; then
  COMMENT="PR aberto: ${PR_URL} (PR #${PR_NUMBER}). Linked to this Story."
  ado_rest_comment "$STORY_ID" "$COMMENT" || true
  echo "[ADO-PR-LINK] 🔗 PR #${PR_NUMBER} linkado à Story ADO #${STORY_ID}." >&2
else
  echo "[ADO-PR-LINK] ℹ️  PR #${PR_NUMBER} criado. Link manual ao Story ADO recomendado." >&2
  echo "[ADO-PR-LINK] PR URL: ${PR_URL}" >&2
fi

exit 0
