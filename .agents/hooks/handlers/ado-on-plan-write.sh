#!/usr/bin/env bash
# ADO Plan Write Advisory — warns when PLAN.md is written without ADO mapping
# Event: PostToolUse(Write|Edit) — non-blocking advisory
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_ado-lib.sh"

# Skip if ADO not enabled
is_ado_enabled || exit 0

# Get the file that was written/edited
FILE_PATH="${CLAUDE_TOOL_FILE_PATH:-}"

# Only process PLAN.md files
case "$(basename "$FILE_PATH")" in
  PLAN.md|MASTER-PLAN.md) ;;
  *) exit 0 ;;
esac

[[ -f "$FILE_PATH" ]] || exit 0

# Check if the plan has ADO mapping
if ! has_ado_mapping_in_plan "$FILE_PATH"; then
  echo "[ADO-ADVISORY] 📋 $FILE_PATH sem mapeamento ADO." >&2
  echo "[ADO-ADVISORY] Execute '/atlas plan' para criar os work items antes do dev-squad." >&2
fi

exit 0
