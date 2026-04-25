-- Migration 003 — Session and worktree-claim tracking
-- Motivation: per-repo + per-branch + per-session + per-agent observability,
-- enabling resume by session and atomic worktree claim across concurrent sessions.

CREATE TABLE IF NOT EXISTS as_sessions (
  id TEXT PRIMARY KEY,                          -- UUID of Claude session/window
  parent_id TEXT,                               -- nested session (subagent dispatch)
  host TEXT,                                    -- machine identity (multi-host fast-follow)
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','completed','killed','orphaned'))
);

ALTER TABLE as_runs ADD COLUMN session_id TEXT;
ALTER TABLE as_runs ADD COLUMN repo_url TEXT;
ALTER TABLE as_runs ADD COLUMN base_branch TEXT;

ALTER TABLE as_worktree_state ADD COLUMN claimed_by_session TEXT;
ALTER TABLE as_worktree_state ADD COLUMN claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_as_sessions_status ON as_sessions(status);
CREATE INDEX IF NOT EXISTS idx_as_sessions_last_seen ON as_sessions(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_as_runs_session ON as_runs(session_id);

-- Atomic claim semantics: only one active worktree per branch_name globally.
-- Second session trying to claim the same branch fails on UNIQUE constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_as_worktree_branch_active
  ON as_worktree_state(branch_name) WHERE removed_at IS NULL;
