#!/usr/bin/env bash
# =============================================================================
# HSEOS State Emit Hook — bash shim invoked by .claude/hooks.json
# Authority: Enterprise Constitution > observability
# Best-effort write: never blocks tool execution. Failure is silent.
#
# Env vars (passed by Claude Code):
#   CLAUDE_TOOL_NAME           Tool that fired the hook (Edit, Bash, ...)
#   CLAUDE_TOOL_FILE_PATH      Edited file (when applicable)
#   CLAUDE_HOOK_EVENT          PreToolUse | PostToolUse | SessionStart | Stop
#
# Env vars (set by skill/CLI on enter):
#   HSEOS_CURRENT_RUN_ID       Active run id
#   HSEOS_CURRENT_TASK         Active task id
#   HSEOS_CURRENT_AGENT        Active agent name
#   HSEOS_HOOK_KIND_OVERRIDE   Force a specific event kind
# =============================================================================

set -u  # strict on undefined; allow non-zero exits to fall through silently

HOOK_EVENT="${CLAUDE_HOOK_EVENT:-${1:-unknown}}"
TOOL_NAME="${CLAUDE_TOOL_NAME:-${2:-unknown}}"
RUN_ID="${HSEOS_CURRENT_RUN_ID:-}"
TASK_ID="${HSEOS_CURRENT_TASK:-}"
AGENT="${HSEOS_CURRENT_AGENT:-}"

# Skip silently if no run context — emission only meaningful inside a tracked run.
[[ -z "$RUN_ID" ]] && exit 0

# Map hook event → state-emit kind
KIND="${HSEOS_HOOK_KIND_OVERRIDE:-}"
if [[ -z "$KIND" ]]; then
  case "$HOOK_EVENT" in
    SessionStart) KIND="start" ;;
    PostToolUse)  KIND="tool_call" ;;
    PreToolUse)   KIND="tool_call" ;;
    Stop)         KIND="complete" ;;
    *)            KIND="checkpoint" ;;
  esac
fi

# Build payload
PAYLOAD=$(printf '{"event":"%s","tool":"%s"}' "$HOOK_EVENT" "$TOOL_NAME")

# Locate hseos CLI: prefer global, then npx as fallback.
HSEOS_BIN="$(command -v hseos 2>/dev/null || true)"
if [[ -z "$HSEOS_BIN" ]]; then
  HSEOS_BIN="npx --yes hseos"
fi

# Best-effort, fully detached, suppress all output. 5s soft cap.
ARGS=(state-emit "$KIND" --silent --run "$RUN_ID" --agent "${AGENT:-unknown}" --payload "$PAYLOAD")
[[ -n "$TASK_ID" ]] && ARGS+=(--task "$TASK_ID")

# shellcheck disable=SC2086
( timeout 5s $HSEOS_BIN "${ARGS[@]}" >/dev/null 2>&1 ) &

# Always exit 0 — hook never blocks the tool that triggered it.
exit 0
