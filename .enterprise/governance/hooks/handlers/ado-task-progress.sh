#!/usr/bin/env bash
# ADO Task Progress — adds comment to ADO Task on git commit in ado-* branch
# Event: PostToolUse(Bash) — non-blocking, best-effort
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_ado-lib.sh"

# Skip if ADO not enabled
is_ado_enabled || exit 0

# Only process git commit commands
COMMAND="${CLAUDE_TOOL_COMMAND:-}"
echo "$COMMAND" | grep -qE "^\s*git\s+commit" || exit 0

# Only in branches with ado-{ID}-* pattern
TASK_ID="$(get_task_id_from_branch)"
[[ -n "$TASK_ID" ]] || exit 0

# Get commit SHA (best effort)
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
BRANCH="$(git branch --show-current 2>/dev/null || echo "unknown")"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Build comment text
COMMENT="Squad agent commit. SHA: ${SHA}. Branch: ${BRANCH}. Timestamp: ${TIMESTAMP}."

# Post comment via REST API (async, best-effort)
ado_rest_comment "$TASK_ID" "$COMMENT" || true

# Transition to Active if task is still New (best-effort)
ado_rest_update_state "$TASK_ID" "Active" || true

exit 0
