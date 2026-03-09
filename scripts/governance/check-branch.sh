#!/usr/bin/env bash
# =============================================================================
# HSEOS Branch Protection Guard
# Authority: Enterprise Constitution > execution-governance
# Blocks direct commits to main/develop/master
# Called by: .husky/pre-commit
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
PROTECTED_BRANCHES=("main" "master" "develop")

for branch in "${PROTECTED_BRANCHES[@]}"; do
  if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
    echo -e "${RED}[BRANCH-GUARD]${NC} Direct commit to '${branch}' is FORBIDDEN."
    echo ""
    echo "  Governance rule: all work must occur in feature/* or task/* branches."
    echo "  Create a feature branch first:"
    echo ""
    echo "    git checkout -b feature/<phase-name>"
    echo "    # or for a task:"
    echo "    ./scripts/governance/worktree-manager.sh create <task-id> feature/<phase-name>"
    echo ""
    exit 1
  fi
done

# Warn if not on feature/* or task/* (e.g., hotfix/*, chore/*)
if [[ ! "$CURRENT_BRANCH" =~ ^(feature/|task/|feat/|fix/|chore/|hotfix/|release/|docs/) ]]; then
  echo -e "${RED}[BRANCH-GUARD]${NC} Unusual branch pattern: '${CURRENT_BRANCH}'"
  echo "  Expected: feature/*, task/*, fix/*, chore/*, hotfix/*, release/*, docs/*"
  echo "  Proceeding — but ensure this is intentional."
fi

echo -e "${GREEN}[BRANCH-GUARD]${NC} Branch check passed: ${CURRENT_BRANCH}"
