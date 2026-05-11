#!/usr/bin/env bash
# HSEOS CLAUDE.md guard handler
#
# Event:   PreToolUse (matcher: Write|Edit)
# Blocking: true - denies direct writes to CLAUDE.md
#
# CLAUDE.md remains as the Claude Code entrypoint, but all durable agent
# governance must be maintained in AGENTS.md.

set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" && ! -t 0 ]]; then
  INPUT=$(cat 2>/dev/null || true)
  if [[ -n "$INPUT" ]] && command -v jq >/dev/null 2>&1; then
    TARGET=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // .file_path // ""' 2>/dev/null || echo "")
  fi
fi

[[ -n "$TARGET" ]] || exit 0

case "$(basename "$TARGET")" in
  CLAUDE.md) ;;
  *) exit 0 ;;
esac

REASON="Do not write or edit CLAUDE.md directly"
CONTEXT="HSEOS governance source is AGENTS.md. Keep CLAUDE.md as a minimal Claude Code pointer; write durable rules and directives in AGENTS.md instead."

if command -v jq >/dev/null 2>&1; then
  jq -nc \
    --arg reason "$REASON" \
    --arg context "$CONTEXT" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason,
        additionalContext: $context
      }
    }'
else
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s","additionalContext":"%s"}}\n' \
    "$REASON" "$CONTEXT"
fi

exit 0
