#!/usr/bin/env bash
# HSEOS Project State CLI
# Manages STATE.md and TASKS.md via SQLite.
#
# Usage:
#   project-state.sh state read
#   project-state.sh state write <key> <value>
#   project-state.sh tasks list [--status pending|done|blocked]
#   project-state.sh tasks add <id> <owner> "<description>"
#   project-state.sh tasks done <id>
#   project-state.sh tasks block <id> "<reason>"
#   project-state.sh history [n]

set -euo pipefail

DB="${HSEOS_STATE_DB:-.hseos/state/project.db}"

_require_sqlite() {
  if ! command -v sqlite3 &>/dev/null; then
    echo "[project-state] sqlite3 not found on PATH. Install sqlite3 or switch to skill-only mode." >&2
    exit 1
  fi
}

_sql_literal() {
  local value="${1-}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

_positive_integer() {
  [[ "${1-}" =~ ^[1-9][0-9]*$ ]] || {
    echo "[project-state] expected a positive integer, got: ${1-}" >&2
    exit 1
  }
}

_init_db() {
  mkdir -p "$(dirname "$DB")"
  sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  depends_on TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS state_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
SQL
}

cmd_state_read() {
  _require_sqlite
  _init_db
  sqlite3 -column -header "$DB" "SELECT key, value, updated_at FROM state ORDER BY key;"
}

cmd_state_write() {
  local key="$1" value="$2" agent="${3:-cli}"
  local sql_key sql_value sql_agent
  sql_key="$(_sql_literal "$key")"
  sql_value="$(_sql_literal "$value")"
  sql_agent="$(_sql_literal "$agent")"
  _require_sqlite
  _init_db
  sqlite3 "$DB" <<SQL
INSERT INTO state_history (key, old_value, new_value, changed_by)
  VALUES ($sql_key, (SELECT value FROM state WHERE key=$sql_key), $sql_value, $sql_agent);
INSERT INTO state (key, value, updated_at) VALUES ($sql_key, $sql_value, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
SQL
  echo "[project-state] state.$key = $value"
}

cmd_tasks_list() {
  local status_filter=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status)
        [[ "${2-}" =~ ^(pending|done|blocked)$ ]] || { echo "[project-state] invalid task status: ${2-}" >&2; exit 1; }
        status_filter="WHERE status = '$2'"
        shift 2
        ;;
      *) shift ;;
    esac
  done
  _require_sqlite
  _init_db
  sqlite3 -column -header "$DB" "SELECT id, owner, status, description, note FROM tasks $status_filter ORDER BY status, created_at;"
}

cmd_tasks_add() {
  local id="$1" owner="$2" description="$3" depends="${4:-}"
  local sql_id sql_owner sql_description sql_depends
  sql_id="$(_sql_literal "$id")"
  sql_owner="$(_sql_literal "$owner")"
  sql_description="$(_sql_literal "$description")"
  sql_depends="$(_sql_literal "$depends")"
  _require_sqlite
  _init_db
  sqlite3 "$DB" "INSERT OR IGNORE INTO tasks (id, owner, description, depends_on) VALUES ($sql_id, $sql_owner, $sql_description, $sql_depends);"
  echo "[project-state] task $id added (owner: $owner)"
}

cmd_tasks_done() {
  local id="$1"
  local sql_id
  sql_id="$(_sql_literal "$id")"
  _require_sqlite
  _init_db
  sqlite3 "$DB" "UPDATE tasks SET status='done', updated_at=datetime('now') WHERE id=$sql_id;"
  echo "[project-state] task $id marked done"
}

cmd_tasks_block() {
  local id="$1" reason="${2:-}"
  local sql_id sql_reason
  sql_id="$(_sql_literal "$id")"
  sql_reason="$(_sql_literal "$reason")"
  _require_sqlite
  _init_db
  sqlite3 "$DB" "UPDATE tasks SET status='blocked', note=$sql_reason, updated_at=datetime('now') WHERE id=$sql_id;"
  echo "[project-state] task $id blocked: $reason"
}

cmd_history() {
  local n="${1:-20}"
  _positive_integer "$n"
  _require_sqlite
  _init_db
  sqlite3 -column -header "$DB" "SELECT key, old_value, new_value, changed_by, changed_at FROM state_history ORDER BY changed_at DESC LIMIT $n;"
}

# ── Router ────────────────────────────────────────────────────────────────────

COMMAND="${1:-}"
SUBCOMMAND="${2:-}"
shift 2 || true

case "$COMMAND" in
  state)
    case "$SUBCOMMAND" in
      read)  cmd_state_read ;;
      write) cmd_state_write "$@" ;;
      *) echo "Usage: project-state.sh state read|write <key> <value>" >&2; exit 1 ;;
    esac
    ;;
  tasks)
    case "$SUBCOMMAND" in
      list)  cmd_tasks_list "$@" ;;
      add)   cmd_tasks_add "$@" ;;
      done)  cmd_tasks_done "$@" ;;
      block) cmd_tasks_block "$@" ;;
      *) echo "Usage: project-state.sh tasks list|add|done|block" >&2; exit 1 ;;
    esac
    ;;
  history) cmd_history "$@" ;;
  *)
    cat >&2 <<'USAGE'
HSEOS Project State CLI
  project-state.sh state read
  project-state.sh state write <key> <value>
  project-state.sh tasks list [--status pending|done|blocked]
  project-state.sh tasks add <id> <owner> "<description>"
  project-state.sh tasks done <id>
  project-state.sh tasks block <id> "<reason>"
  project-state.sh history [n]
USAGE
    exit 1
    ;;
esac
