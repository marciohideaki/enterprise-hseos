#!/usr/bin/env bash
# HSEOS code-index-guard handler — Wave 4 implementation slice (W4-T6)
#
# Event:   PreToolUse (matcher: Grep|Glob)
# Status:  active (replaces upstream ~/.claude/hooks/axon-guard.sh)
# Blocking: true — emits JSON permissionDecision when guard fires
#
# Refuses raw Grep/Glob calls when a code-index provider is available
# and indexed, redirecting the agent toward the provider's native MCP
# tools (which deliver -76-98% tokens vs sequential Read+Grep).
# Falls open (silent allow) when:
#   - No provider marker exists (.axon/, etc.) — graceful degradation
#   - Index not yet built (provider present but no index file)
#   - Bypass env var set: HSEOS_BYPASS_INDEX=1
#
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: same input → same output (allow or ask)
#   - Best-effort: errors fall through to allow (never breaks tool use)
#   - Project-scoped: walks marker dirs from cwd
#   - Config-aware: respects HSEOS_BYPASS_INDEX=1 escape hatch
#   - Fail-open: any failure path exits 0 (allow)
#
# Output contract (Claude Code blocking hook JSON):
#   { "hookSpecificOutput": {
#       "hookEventName": "PreToolUse",
#       "permissionDecision": "ask",
#       "permissionDecisionReason": "...",
#       "additionalContext": "..."
#   } }
#
# Tool name resolution:
#   - First positional arg ($1) — passed by the hook registry entry
#   - Falls back to stdin JSON .tool_name when arg missing

set -euo pipefail

# Bypass escape hatch — for legitimate raw Grep/Glob (logs, debug)
if [[ "${HSEOS_BYPASS_INDEX:-}" == "1" ]]; then
  exit 0
fi

# Resolve tool name
TOOL="${1:-}"
if [[ -z "$TOOL" && ! -t 0 ]]; then
  INPUT=$(cat 2>/dev/null || true)
  if [[ -n "$INPUT" ]] && command -v jq >/dev/null 2>&1; then
    TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo "")
  fi
fi

# Only act on Grep/Glob (matcher in registry already filters; defensive belt)
case "$TOOL" in
  Grep|Glob) ;;
  *) exit 0 ;;
esac

PROJECT_ROOT="$(pwd)"

# Provider detection — currently axon. Reserved branches for future providers.
PROVIDER=""
INDEX_PATH=""

if [[ -d "$PROJECT_ROOT/.axon" ]]; then
  PROVIDER="axon"
  INDEX_PATH="$PROJECT_ROOT/.axon/index.duckdb"
fi

# No provider → allow silently
if [[ -z "$PROVIDER" ]]; then
  exit 0
fi

# Provider present but index not built → silent allow.
# (We considered emitting an advisory hint here pointing at run_pipeline(),
# but the hook fires on every Grep/Glob — repeating the hint per call would
# be noisy. The first-prompt advisory in on-prompt-submit.sh covers the
# discoverability gap once per session.)
if [[ -n "$INDEX_PATH" && ! -f "$INDEX_PATH" ]]; then
  exit 0
fi

# Compose advisory + ask decision
case "$TOOL" in
  Grep)
    REASON="Use the code-index provider instead of raw Grep"
    CONTEXT="HSEOS code-index-guard: project has $PROVIDER index. Prefer mcp__${PROVIDER}__get_context_capsule(query) for semantic search (-76-98% tokens). Override with HSEOS_BYPASS_INDEX=1 for legitimate raw search (logs/debug)."
    ;;
  Glob)
    REASON="Use the code-index provider instead of raw Glob"
    CONTEXT="HSEOS code-index-guard: project has $PROVIDER index. Prefer mcp__${PROVIDER}__get_skeleton(files) for file structure or mcp__${PROVIDER}__get_context_capsule(query) for semantic context. Override with HSEOS_BYPASS_INDEX=1 if you genuinely need a filesystem-pattern match."
    ;;
esac

# Emit blocking hook JSON. Use jq when available for safe escaping; otherwise
# fall back to a minimal printf-based JSON (good enough — no embedded quotes
# beyond what we control).
if command -v jq >/dev/null 2>&1; then
  jq -nc \
    --arg reason "$REASON" \
    --arg context "$CONTEXT" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: $reason,
        additionalContext: $context
      }
    }'
else
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s","additionalContext":"%s"}}\n' \
    "$REASON" "$CONTEXT"
fi

exit 0
