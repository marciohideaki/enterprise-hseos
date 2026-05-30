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
ALLOWED_PATTERN='^(feature/|task/|fix/|hotfix/|release/|docs/|chore/|ci/)'

for branch in "${PROTECTED_BRANCHES[@]}"; do
  if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
    echo -e "${RED}[BRANCH-GUARD]${NC} Direct commit to '${branch}' is FORBIDDEN."
    echo ""
    echo "  Governance rule: write work must occur on a governed branch."
    echo "  Create a feature branch first, or use the task worktree flow:"
    echo ""
    echo "    git checkout -b feature/<phase-name>"
    echo "    # or for a task:"
    echo "    ./scripts/governance/worktree-manager.sh create <task-id> feature/<phase-name>"
    echo ""
    exit 1
  fi
done

# Warn if not on a governed branch prefix.
if [[ ! "$CURRENT_BRANCH" =~ $ALLOWED_PATTERN ]]; then
  echo -e "${RED}[BRANCH-GUARD]${NC} Unusual branch pattern: '${CURRENT_BRANCH}'"
  echo "  Expected: feature/*, task/*, fix/*, hotfix/*, release/*, docs/*, chore/*, ci/*"
  echo "  Proceeding — but ensure this is intentional."
fi

echo -e "${GREEN}[BRANCH-GUARD]${NC} Branch check passed: ${CURRENT_BRANCH}"
