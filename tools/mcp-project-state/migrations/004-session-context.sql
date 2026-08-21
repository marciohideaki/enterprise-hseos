-- Migration 004 — Session context for always-on session tracking
-- Motivation: as_sessions was created in 003 as a multi-host fast-follow but
-- nothing ever fed it — only hseos-orchestrated runs appeared in the store,
-- so plain Claude/Codex terminal sessions were invisible to kanban/state-list.
-- Always-on hooks (session-track.sh) now register EVERY session; these columns
-- record where the session works so fleet views can group by project/tool.

ALTER TABLE as_sessions ADD COLUMN cwd TEXT;      -- working directory of the session
ALTER TABLE as_sessions ADD COLUMN service TEXT;  -- claude-code | codex-cli | ...

CREATE INDEX IF NOT EXISTS idx_as_sessions_cwd ON as_sessions(cwd);
