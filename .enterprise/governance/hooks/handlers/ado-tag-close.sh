#!/usr/bin/env bash
# ADO Tag Close — emits event when git tag pushed, for ATLAS to process
# Event: PostToolUse(Bash) — non-blocking, best-effort
# Note: does NOT call ADO directly; emits event for ATLAS async processing
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_ado-lib.sh"

# Skip if ADO not enabled
is_ado_enabled || exit 0

# Only process git push --tags or git push with tag reference
COMMAND="${CLAUDE_TOOL_COMMAND:-}"
if ! echo "$COMMAND" | grep -qE "git\s+push.*(--tags|refs/tags|v[0-9]+\.|wave-w[0-9]+)"; then
  exit 0
fi

# Extract tag name
TAG_NAME=""
if echo "$COMMAND" | grep -qE "git\s+tag\s+"; then
  TAG_NAME="$(echo "$COMMAND" | grep -oE '\b(v[0-9]+\.[0-9]+\.[0-9]+|wave-w[0-9]+-\w+)\b' | head -1)"
fi
if [[ -z "$TAG_NAME" ]]; then
  TAG_NAME="$(git describe --tags --exact-match HEAD 2>/dev/null || echo "")"
fi

[[ -n "$TAG_NAME" ]] || exit 0

# Create inbox event for ATLAS to process asynchronously
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
[[ -n "$PROJECT_ROOT" ]] || exit 0

INBOX_DIR="${PROJECT_ROOT}/.hseos/runs/ado-ops/inbox"
mkdir -p "$INBOX_DIR"

TIMESTAMP="$(date -u +"%Y%m%d-%H%M%S")"
EVENT_FILE="${INBOX_DIR}/tag-${TAG_NAME}-${TIMESTAMP}.json"

cat > "$EVENT_FILE" << EOF
{
  "event": "tag_pushed",
  "tag": "${TAG_NAME}",
  "sha": "$(git rev-parse HEAD 2>/dev/null || echo "unknown")",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "action": "close_wave_items",
  "status": "pending"
}
EOF

echo "[ADO-TAG-CLOSE] 🏷️  Tag '${TAG_NAME}' detectada. Evento emitido para ATLAS." >&2
echo "[ADO-TAG-CLOSE] Execute '/atlas close' para fechar os itens ADO associados." >&2
echo "[ADO-TAG-CLOSE] Evento: ${EVENT_FILE}" >&2

exit 0
