#!/usr/bin/env bash
# ADO Task From Branch — extracts ADO Task ID from current branch name
# Pattern: ado-{TASK_ID}-{slug}
# Usage: bash scripts/governance/ado-task-from-branch.sh
#        TASK_ID=$(bash scripts/governance/ado-task-from-branch.sh)
set -euo pipefail

BRANCH="$(git branch --show-current 2>/dev/null || echo "")"

if [[ -z "$BRANCH" ]]; then
  echo ""
  exit 0
fi

# Extract numeric ID from pattern ado-{ID}-...
TASK_ID="$(echo "$BRANCH" | grep -oE 'ado-[0-9]+' | head -1 | sed 's/ado-//' || echo "")"

echo "${TASK_ID:-}"
