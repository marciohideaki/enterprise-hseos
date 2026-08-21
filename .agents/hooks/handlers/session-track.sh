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
HSEOS_BIN="$(command -v hseos 2>/dev/null || true)"
[[ -z "$HSEOS_BIN" ]] && exit 0

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

# Fully detached, capped, silent — the hook must never slow the session down.
( timeout 5s "$HSEOS_BIN" "${ARGS[@]}" >/dev/null 2>&1 ) &

exit 0
