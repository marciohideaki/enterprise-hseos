#!/usr/bin/env bash
# ADO Inbox Check — alerts on pending tag-close events at session start
# Event: SessionStart — advisory, non-blocking
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_ado-lib.sh"

is_ado_enabled || exit 0

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
[[ -n "$PROJECT_ROOT" ]] || exit 0

INBOX_DIR="${PROJECT_ROOT}/.hseos/runs/ado-ops/inbox"
[[ -d "$INBOX_DIR" ]] || exit 0

PENDING=$(find "$INBOX_DIR" -name "tag-*.json" -newer "$INBOX_DIR" 2>/dev/null | wc -l | tr -d ' ')
[[ "$PENDING" -gt 0 ]] || exit 0

echo "[ADO-INBOX] ⚠️  ${PENDING} evento(s) de tag pendente(s) em ${INBOX_DIR}" >&2
echo "[ADO-INBOX] Execute '/atlas close' para fechar os itens ADO associados." >&2

# List pending events for visibility
find "$INBOX_DIR" -name "tag-*.json" 2>/dev/null | while read -r f; do
  TAG=$(python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('tag','?'))" 2>/dev/null || basename "$f")
  echo "[ADO-INBOX]   › tag: ${TAG}" >&2
done

exit 0
