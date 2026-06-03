#!/usr/bin/env bash
# ADO-Lib — helper functions sourced by all ado-* hooks
# Requer: bash 4+, yq (opcional mas preferido), git
set -euo pipefail

# ─────────────────────────────────────────────
# is_ado_enabled
# Returns 0 if ado.enabled=true in hseos.config.yaml, 1 otherwise.
# Fallback: grep-based if yq not available.
# ─────────────────────────────────────────────
is_ado_enabled() {
  local project_root
  project_root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1

  local config_file="${project_root}/.hseos/config/hseos.config.yaml"
  [[ -f "$config_file" ]] || return 1

  # Prefer yq for structured YAML parsing
  if command -v yq &>/dev/null; then
    local enabled
    enabled="$(yq '.ado.enabled // false' "$config_file" 2>/dev/null)"
    [[ "$enabled" == "true" ]]
    return
  fi

  # Fallback: grep-based (less precise but works without yq)
  # Checks for 'ado:' section followed by 'enabled: true' within next 20 lines
  awk '/^ado:/{found=1} found && /enabled:/{print; exit}' "$config_file" | grep -q "true"
}

# ─────────────────────────────────────────────
# get_ado_config <key>
# Reads a key from the ado: section of hseos.config.yaml.
# Usage: get_ado_config "org" → "hideakisolutions"
# ─────────────────────────────────────────────
get_ado_config() {
  local key="$1"
  local project_root
  project_root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1

  local config_file="${project_root}/.hseos/config/hseos.config.yaml"
  [[ -f "$config_file" ]] || return 1

  if command -v yq &>/dev/null; then
    yq ".ado.${key} // empty" "$config_file" 2>/dev/null
    return
  fi

  # Fallback: awk-based extraction (works for simple string values)
  awk -v key="$key" '
    /^ado:/{in_ado=1; next}
    in_ado && /^[a-zA-Z]/{in_ado=0}
    in_ado && $0 ~ key ": " {
      sub(/.*: /, ""); gsub(/"/, ""); print; exit
    }
  ' "$config_file"
}

# ─────────────────────────────────────────────
# get_task_id_from_branch
# Extracts ADO Task ID from branch name pattern: ado-{ID}-{slug}
# Returns empty string if pattern not found.
# Usage: task_id=$(get_task_id_from_branch)
# ─────────────────────────────────────────────
get_task_id_from_branch() {
  local branch
  branch="$(git branch --show-current 2>/dev/null)" || return 0
  echo "$branch" | grep -oE 'ado-[0-9]+' | head -1 | tr -d 'ado-' || true
}

# ─────────────────────────────────────────────
# is_in_worktree
# Returns 0 if currently in a git worktree (not main repo).
# Worktree: .git is a file, not a directory.
# ─────────────────────────────────────────────
is_in_worktree() {
  local git_dir
  git_dir="$(git rev-parse --git-dir 2>/dev/null)" || return 1
  [[ -f "$git_dir" ]]
}

# ─────────────────────────────────────────────
# get_ado_mapping_file
# Finds the most recent ado-mapping.json in .hseos/runs/ado-ops/
# ─────────────────────────────────────────────
get_ado_mapping_file() {
  local project_root
  project_root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1

  local runs_dir="${project_root}/.hseos/runs/ado-ops"
  [[ -d "$runs_dir" ]] || return 1

  # Find most recent ado-mapping.json (by modification time)
  find "$runs_dir" -name "ado-mapping.json" -printf "%T@ %p\n" 2>/dev/null \
    | sort -rn | head -1 | awk '{print $2}'
}

# ─────────────────────────────────────────────
# ado_rest_comment <work_item_id> <comment_text>
# Adds a comment to an ADO work item via REST API.
# Used by hooks that can't use MCP (outside Claude session).
# Requires: ADO_PAT env var, org and project in config.
# ─────────────────────────────────────────────
ado_rest_comment() {
  local work_item_id="$1"
  local comment_text="$2"

  local pat="${ADO_PAT:-}"
  [[ -n "$pat" ]] || return 0  # fail silently if no PAT

  local org
  org="$(get_ado_config "org")" || return 0
  local project
  project="$(get_ado_config "project")" || return 0

  [[ -n "$org" && -n "$project" ]] || return 0

  local url="https://dev.azure.com/${org}/${project}/_apis/wit/workItems/${work_item_id}/comments?api-version=7.1-preview.3"

  curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$url" \
    -H "Authorization: Basic $(echo -n ":${pat}" | base64 -w0)" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"${comment_text}\"}" \
    2>/dev/null || true
}

# ─────────────────────────────────────────────
# ado_rest_update_state <work_item_id> <state>
# Updates the state of an ADO work item via REST API.
# state: "Active" | "Closed" | "New" | "Resolved"
# ─────────────────────────────────────────────
ado_rest_update_state() {
  local work_item_id="$1"
  local state="$2"

  local pat="${ADO_PAT:-}"
  [[ -n "$pat" ]] || return 0

  local org
  org="$(get_ado_config "org")" || return 0
  local project
  project="$(get_ado_config "project")" || return 0

  [[ -n "$org" && -n "$project" ]] || return 0

  local url="https://dev.azure.com/${org}/${project}/_apis/wit/workItems/${work_item_id}?api-version=7.1"

  curl -s -o /dev/null \
    -X PATCH "$url" \
    -H "Authorization: Basic $(echo -n ":${pat}" | base64 -w0)" \
    -H "Content-Type: application/json-patch+json" \
    -d "[{\"op\":\"add\",\"path\":\"/fields/System.State\",\"value\":\"${state}\"}]" \
    2>/dev/null || true
}

# ─────────────────────────────────────────────
# has_ado_mapping_in_plan <plan_file>
# Returns 0 if plan file has ADO mapping annotations.
# ─────────────────────────────────────────────
has_ado_mapping_in_plan() {
  local plan_file="${1:-PLAN.md}"
  [[ -f "$plan_file" ]] || return 1
  grep -qE "(## ADO Mapping|<!-- ado-mapping:)" "$plan_file"
}

# ─────────────────────────────────────────────
# is_trunk_branch <branch>
# Returns 0 if branch is a protected trunk branch.
# ─────────────────────────────────────────────
is_trunk_branch() {
  local branch="${1:-$(git branch --show-current 2>/dev/null)}"
  echo "$branch" | grep -qE "^(main|master|develop|trunk|staging|hmg)$"
}
