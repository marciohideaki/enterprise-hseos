#!/usr/bin/env bash
# =============================================================================
# HSEOS Worktree Manager — Task Isolation Lifecycle
# Authority: Enterprise Constitution > execution-governance
# Usage:
#   ./scripts/governance/worktree-manager.sh create <task-id> <feature-branch>
#   ./scripts/governance/worktree-manager.sh validate <task-id>
#   ./scripts/governance/worktree-manager.sh commit <task-id> "<message>"
#   ./scripts/governance/worktree-manager.sh merge <task-id> <feature-branch>
#   ./scripts/governance/worktree-manager.sh remove <task-id>
#   ./scripts/governance/worktree-manager.sh status
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKTREE_BASE="${REPO_ROOT}/.worktrees"
LOG_DIR="${REPO_ROOT}/.logs/runs"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
WORKTREE_ENFORCED="${WORKTREE_ENFORCED:-true}"
VALIDATION_ENFORCED="${VALIDATION_ENFORCED:-true}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()  { echo -e "${BLUE}[WT]${NC} $*"; }
pass()  { echo -e "${GREEN}[WT]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WT]${NC} $*"; }
fatal() { echo -e "${RED}[WT-FATAL]${NC} $*"; exit 1; }

log_run() {
  mkdir -p "$LOG_DIR"
  echo "[${TIMESTAMP}] $*" >> "${LOG_DIR}/worktree-manager.log"
}

# =============================================================================
# Helpers
# =============================================================================

worktree_path() {
  echo "${WORKTREE_BASE}/$1"
}

task_branch() {
  echo "task/$1"
}

assert_worktree_enforced() {
  if [[ "${WORKTREE_ENFORCED}" != "true" ]]; then
    warn "WORKTREE_ENFORCED is not 'true' — isolation is advisory"
  fi
}

assert_task_id() {
  [[ -n "${1:-}" ]] || fatal "task-id is required"
  [[ "$1" =~ ^[a-zA-Z0-9_-]+$ ]] || fatal "task-id must be alphanumeric/dash/underscore: $1"
}

assert_in_repo() {
  git -C "${REPO_ROOT}" rev-parse --git-dir &>/dev/null || fatal "Not a git repository: ${REPO_ROOT}"
}

# =============================================================================
# Commands
# =============================================================================

cmd_create() {
  local task_id="${1:-}"; local feature_branch="${2:-}"
  assert_task_id "$task_id"
  [[ -n "$feature_branch" ]] || fatal "feature-branch is required"
  assert_in_repo
  assert_worktree_enforced

  local wt_path; wt_path="$(worktree_path "$task_id")"
  local task_branch; task_branch="task/${task_id}"

  # Validate feature branch follows naming convention
  [[ "$feature_branch" == feature/* ]] || \
    fatal "feature-branch must follow feature/* pattern, got: ${feature_branch}"

  # Prevent creating worktree if it already exists
  if [[ -d "$wt_path" ]]; then
    fatal "Worktree already exists: ${wt_path}. Remove it first with: remove ${task_id}"
  fi

  # Resolve source ref for feature branch (local preferred, remote fallback)
  local feature_ref
  if git -C "${REPO_ROOT}" rev-parse --verify "${feature_branch}" &>/dev/null; then
    feature_ref="${feature_branch}"
  elif git -C "${REPO_ROOT}" rev-parse --verify "origin/${feature_branch}" &>/dev/null; then
    feature_ref="origin/${feature_branch}"
  else
    fatal "Feature branch not found: ${feature_branch}"
  fi

  if git -C "${REPO_ROOT}" rev-parse --verify "${task_branch}" &>/dev/null; then
    fatal "Task branch already exists: ${task_branch}. Remove it first or pick another task-id"
  fi

  info "Creating task branch: ${task_branch} from ${feature_ref}"
  git -C "${REPO_ROOT}" branch "${task_branch}" "${feature_ref}" 2>/dev/null || \
    fatal "Failed to create task branch ${task_branch}"

  info "Creating worktree: ${wt_path}"
  mkdir -p "${WORKTREE_BASE}"
  git -C "${REPO_ROOT}" worktree add "${wt_path}" "${task_branch}" || \
    fatal "Failed to create worktree at ${wt_path}"

  # Write task metadata
  cat > "${wt_path}/.worktree-meta" <<EOF
task_id=${task_id}
task_branch=${task_branch}
feature_branch=${feature_branch}
created_at=${TIMESTAMP}
status=active
EOF

  log_run "CREATE task=${task_id} branch=${task_branch} feature=${feature_branch} path=${wt_path}"
  pass "Worktree created: ${wt_path}"
  pass "Task branch: ${task_branch}"
  info "Execute your task inside: ${wt_path}"
}

cmd_validate() {
  local task_id="${1:-}"
  assert_task_id "$task_id"

  local wt_path; wt_path="$(worktree_path "$task_id")"
  [[ -d "$wt_path" ]] || fatal "Worktree not found: ${wt_path}"

  info "Running quality gates for task: ${task_id}"
  VALIDATION_ENFORCED="${VALIDATION_ENFORCED}" \
    bash "${SCRIPT_DIR}/quality-gates.sh" || \
    fatal "Validation FAILED for task ${task_id} — commit blocked"

  # Update metadata
  sed -i 's/^status=.*/status=validated/' "${wt_path}/.worktree-meta" 2>/dev/null || true
  echo "validated_at=${TIMESTAMP}" >> "${wt_path}/.worktree-meta"

  log_run "VALIDATE task=${task_id} result=passed"
  pass "Validation passed for task: ${task_id}"
}

cmd_commit() {
  local task_id="${1:-}"; local commit_msg="${2:-}"
  assert_task_id "$task_id"
  [[ -n "$commit_msg" ]] || fatal "commit message is required"

  local wt_path; wt_path="$(worktree_path "$task_id")"
  [[ -d "$wt_path" ]] || fatal "Worktree not found: ${wt_path}"

  # Check metadata for validation status
  if [[ -f "${wt_path}/.worktree-meta" ]]; then
    local status
    status=$(grep '^status=' "${wt_path}/.worktree-meta" | cut -d= -f2)
    if [[ "$status" != "validated" && "${VALIDATION_ENFORCED}" == "true" ]]; then
      fatal "Validation not confirmed for task ${task_id}. Run: validate ${task_id} first"
    fi
  fi

  # Validate commit message
  bash "${SCRIPT_DIR}/validate-commit-msg.sh" "$commit_msg" || \
    fatal "Commit message validation FAILED"

  info "Committing in worktree: ${wt_path}"
  git -C "${wt_path}" add -A
  git -C "${wt_path}" commit -m "$commit_msg"

  # Update metadata
  sed -i 's/^status=.*/status=committed/' "${wt_path}/.worktree-meta" 2>/dev/null || true
  echo "committed_at=${TIMESTAMP}" >> "${wt_path}/.worktree-meta"
  echo "commit_msg=${commit_msg}" >> "${wt_path}/.worktree-meta"

  log_run "COMMIT task=${task_id} msg=${commit_msg}"
  pass "Committed in task: ${task_id}"
}

cmd_merge() {
  local task_id="${1:-}"; local feature_branch="${2:-}"
  assert_task_id "$task_id"
  [[ -n "$feature_branch" ]] || fatal "feature-branch is required"

  local wt_path; wt_path="$(worktree_path "$task_id")"
  local task_branch="task/${task_id}"

  # Check metadata for commit status
  if [[ -f "${wt_path}/.worktree-meta" ]]; then
    local status
    status=$(grep '^status=' "${wt_path}/.worktree-meta" | cut -d= -f2)
    if [[ "$status" != "committed" ]]; then
      fatal "Task ${task_id} has not been committed yet (status: ${status})"
    fi
  fi

  info "Merging task/${task_id} into ${feature_branch}"
  git -C "${REPO_ROOT}" checkout "${feature_branch}"
  git -C "${REPO_ROOT}" merge --no-ff "${task_branch}" -m "merge(${feature_branch}): integrate task/${task_id}"

  log_run "MERGE task=${task_id} into=${feature_branch}"
  pass "Task ${task_id} merged into ${feature_branch}"
  info "Next: run 'remove ${task_id}' to clean up the worktree"
}

cmd_remove() {
  local task_id="${1:-}"
  assert_task_id "$task_id"

  local wt_path; wt_path="$(worktree_path "$task_id")"
  local task_branch="task/${task_id}"

  if [[ -d "$wt_path" ]]; then
    info "Removing worktree: ${wt_path}"
    git -C "${REPO_ROOT}" worktree remove --force "${wt_path}" 2>/dev/null || \
      rm -rf "${wt_path}"
  else
    warn "Worktree not found (already removed?): ${wt_path}"
  fi

  if git -C "${REPO_ROOT}" rev-parse --verify "${task_branch}" &>/dev/null; then
    info "Deleting task branch: ${task_branch}"
    git -C "${REPO_ROOT}" branch -d "${task_branch}" 2>/dev/null || \
      warn "Could not delete ${task_branch} — may still have unmerged changes"
  fi

  log_run "REMOVE task=${task_id}"
  pass "Worktree and task branch removed: ${task_id}"
}

cmd_status() {
  assert_in_repo
  info "Active worktrees:"
  git -C "${REPO_ROOT}" worktree list

  echo ""
  if [[ -d "${WORKTREE_BASE}" ]]; then
    info "Task worktrees in ${WORKTREE_BASE}:"
    for meta in "${WORKTREE_BASE}"/*/.worktree-meta; do
      [[ -f "$meta" ]] || continue
      echo ""
      echo "  --- $(dirname "$meta" | xargs basename) ---"
      cat "$meta" | sed 's/^/  /'
    done
  else
    info "No task worktrees found"
  fi
}

# =============================================================================
# Main
# =============================================================================

COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
  create)   cmd_create "$@" ;;
  validate) cmd_validate "$@" ;;
  commit)   cmd_commit "$@" ;;
  merge)    cmd_merge "$@" ;;
  remove)   cmd_remove "$@" ;;
  status)   cmd_status ;;
  help|*)
    echo "HSEOS Worktree Manager"
    echo ""
    echo "Usage:"
    echo "  $0 create   <task-id> <feature/phase-name>  — Create task branch + worktree"
    echo "  $0 validate <task-id>                       — Run quality gates in worktree"
    echo "  $0 commit   <task-id> '<message>'           — Commit after validation"
    echo "  $0 merge    <task-id> <feature/phase-name>  — Merge task into feature branch"
    echo "  $0 remove   <task-id>                       — Remove worktree + task branch"
    echo "  $0 status                                   — Show all active worktrees"
    echo ""
    echo "Flow:"
    echo "  create → [work in .worktrees/<task-id>] → validate → commit → merge → remove"
    echo ""
    echo "Environment:"
    echo "  WORKTREE_ENFORCED=true  (default) — enforces task isolation"
    echo "  VALIDATION_ENFORCED=true (default) — blocks commit without validation"
    ;;
esac
