#!/usr/bin/env bash
# HSEOS session-track handler — always-on as_sessions feed (any agent session)
#
# Events:    SessionStart, UserPromptSubmit, Stop, SessionEnd
# Matcher:   * (all)
# Blocking:  false (background write; exit 0 always)
# Status:    active (self-suppresses when the hseos CLI or jq is absent)
#
# Purpose:
#   Register EVERY Claude Code session in the machine-wide agent-state store
#   ($HOME/.hseos/state/project.db, table as_sessions) — hseos-launched or not —
#   so kanban/fleet views and the Jinx brain-bridge see all live activity.
#   Unlike state-emit-hook.sh this does NOT require HSEOS_CURRENT_RUN_ID:
#   plain terminal sessions are exactly the ones that were invisible before.
#
# Event mapping:
#   SessionStart            -> state-session register
#   UserPromptSubmit / Stop -> state-session heartbeat (turn boundaries)
#   SessionEnd              -> state-session end
#
# Authoring rules (per handlers/README.md):
#   - Idempotent: register/heartbeat are the same upsert; re-firing is safe
#   - Best-effort: never blocks the triggering action; exit 0 always
#   - Fail-open: any error → exit 0 silently

set -u

command -v jq >/dev/null 2>&1 || exit 0
HSEOS_COMMAND=()
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || true)"
LOCAL_CLI="$REPO_ROOT/tools/cli/hseos-cli.js"
LOCAL_BIN="$REPO_ROOT/node_modules/.bin/hseos"
if [[ -n "$REPO_ROOT" && -f "$LOCAL_CLI" ]]; then
  HSEOS_COMMAND=(node "$LOCAL_CLI")
elif [[ -n "$REPO_ROOT" && -x "$LOCAL_BIN" ]]; then
  RESOLVED_BIN="$(realpath -e "$LOCAL_BIN" 2>/dev/null || true)"
  [[ "$RESOLVED_BIN" == "$REPO_ROOT/node_modules/"* ]] && HSEOS_COMMAND=("$LOCAL_BIN")
elif [[ "${HSEOS_CLI_PATH:-}" == /* && -f "${HSEOS_CLI_PATH:-}" ]]; then
  RESOLVED_CLI="$(realpath -e "$HSEOS_CLI_PATH" 2>/dev/null || true)"
  CLI_OWNER="$(stat -c '%u' "$RESOLVED_CLI" 2>/dev/null || true)"
  CLI_MODE="$(stat -c '%a' "$RESOLVED_CLI" 2>/dev/null || true)"
  CURRENT_UID="$(id -u)"
  if [[ -n "$RESOLVED_CLI" && ( "$CLI_OWNER" == "$CURRENT_UID" || "$CLI_OWNER" == "0" ) ]] &&
    [[ "$CLI_MODE" =~ ^[0-7]+$ ]] && (( (8#$CLI_MODE & 022) == 0 )); then
    if [[ "$RESOLVED_CLI" == *.js ]]; then HSEOS_COMMAND=(node "$RESOLVED_CLI"); elif [[ -x "$RESOLVED_CLI" ]]; then HSEOS_COMMAND=("$RESOLVED_CLI"); fi
  fi
fi
[[ ${#HSEOS_COMMAND[@]} -eq 0 ]] && exit 0

INPUT="$(cat 2>/dev/null || true)"
SESSION_ID="$(jq -r '.session_id // empty' <<<"$INPUT" 2>/dev/null || true)"
[[ -z "$SESSION_ID" ]] && exit 0
EVENT="$(jq -r '.hook_event_name // empty' <<<"$INPUT" 2>/dev/null || true)"
CWD="$(jq -r '.cwd // empty' <<<"$INPUT" 2>/dev/null || true)"

case "$EVENT" in
  SessionStart) ACTION="register" ;;
  SessionEnd)   ACTION="end" ;;
  *)            ACTION="heartbeat" ;;  # UserPromptSubmit, Stop, unknown
esac

ARGS=(state-session "$ACTION" --silent --session "$SESSION_ID" --service claude-code)
[[ -n "$CWD" ]] && ARGS+=(--cwd "$CWD")

# Fully detached, capped, silent — survive hosts that terminate the hook's
# process group while never slowing the triggering session down.
nohup timeout 5s "${HSEOS_COMMAND[@]}" "${ARGS[@]}" </dev/null >/dev/null 2>&1 &

exit 0
