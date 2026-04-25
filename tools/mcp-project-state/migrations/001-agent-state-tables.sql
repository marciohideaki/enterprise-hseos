-- Migration 001 — Agent State Tracking tables
-- All tables prefixed `as_` to avoid collision with existing `tasks`/`state`/`state_history`.
-- Source-of-truth ADR: _decisions/2026-04-25-agent-state-tracking-proposal.md (Proposta 5)

CREATE TABLE IF NOT EXISTS as_runs (
  id TEXT PRIMARY KEY,                          -- {YYYYMMDD-HHMM}-{slug}
  workflow_id TEXT NOT NULL,                    -- 'dev-squad' | 'epic-delivery' | ...
  project TEXT NOT NULL,                        -- repo path or canonical project key
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  phase TEXT NOT NULL DEFAULT 'intake'
    CHECK(phase IN ('intake','study','plan','execute','consolidate')),
  gate_status TEXT NOT NULL DEFAULT 'PENDING_G2',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','completed','aborted','orphaned'))
);

CREATE TABLE IF NOT EXISTS as_tasks (
  id TEXT PRIMARY KEY,                          -- T1, T2, T3 within run, namespaced if cross-run
  run_id TEXT NOT NULL REFERENCES as_runs(id),
  wave INTEGER NOT NULL,
  effort TEXT CHECK(effort IN ('trivial','small','medium','large')),
  model_tier TEXT CHECK(model_tier IN ('haiku','sonnet-low','sonnet-medium','sonnet-high','opus')),
  status TEXT NOT NULL DEFAULT 'PENDING_G2'
    CHECK(status IN ('PENDING_G2','PENDING_EXECUTION','IN_PROGRESS','OK','BLOCKED','FAILED')),
  goal TEXT,
  branch TEXT,
  worktree_path TEXT,
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS as_agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL,                     -- 'SWARM' | 'GHOST' | 'subagent-T1' | ...
  task_id TEXT REFERENCES as_tasks(id),
  run_id TEXT NOT NULL REFERENCES as_runs(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat_at TEXT,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','checkpointed','completed','aborted','orphaned','killed')),
  exit_reason TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd REAL
);

CREATE TABLE IF NOT EXISTS as_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_run_id INTEGER REFERENCES as_agent_runs(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL
    CHECK(kind IN ('start','heartbeat','checkpoint','complete','abort','tool_call','gate')),
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS as_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src_task TEXT REFERENCES as_tasks(id),
  dst_task TEXT REFERENCES as_tasks(id),
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS as_wave_executions (
  wave_id TEXT NOT NULL,                        -- {run-id}#W{n}
  task_id TEXT REFERENCES as_tasks(id),
  commit_sha TEXT,
  status TEXT NOT NULL CHECK(status IN ('OK','BLOCKED','FAILED')),
  logs_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (wave_id, task_id)
);

CREATE TABLE IF NOT EXISTS as_worktree_state (
  task_id TEXT PRIMARY KEY REFERENCES as_tasks(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_as_agent_runs_status ON as_agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_as_agent_runs_heartbeat ON as_agent_runs(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_as_events_run ON as_events(agent_run_id, ts);
CREATE INDEX IF NOT EXISTS idx_as_events_kind ON as_events(kind, ts);
CREATE INDEX IF NOT EXISTS idx_as_tasks_run ON as_tasks(run_id, wave);
CREATE INDEX IF NOT EXISTS idx_as_tasks_status ON as_tasks(status);
CREATE INDEX IF NOT EXISTS idx_as_handoffs_dst ON as_handoffs(dst_task);
