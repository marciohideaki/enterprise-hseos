-- Migration 006 — ADR-0022 rebuildable execution projections
-- PENDING ACTIVATION with migration 005 under ADR-0022.

CREATE TABLE IF NOT EXISTS execution_projection_generations (
  projection_name TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  status TEXT NOT NULL CHECK(status IN ('building', 'active', 'retired', 'failed')),
  source_high_water INTEGER NOT NULL DEFAULT 0 CHECK(source_high_water >= 0),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  activated_at TEXT,
  retired_at TEXT,
  PRIMARY KEY (projection_name, generation)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_projection_one_active
  ON execution_projection_generations(projection_name)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS execution_projection_checkpoints (
  projection_name TEXT NOT NULL,
  generation INTEGER NOT NULL,
  last_position INTEGER NOT NULL DEFAULT 0 CHECK(last_position >= 0),
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (projection_name, generation),
  FOREIGN KEY (projection_name, generation)
    REFERENCES execution_projection_generations(projection_name, generation)
);

CREATE TABLE IF NOT EXISTS execution_run_projection (
  generation INTEGER NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL CHECK(aggregate_version > 0),
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('authorized', 'running', 'succeeded', 'failed', 'cancelled', 'in_doubt', 'compensated', 'compensation_failed')),
  last_event_type TEXT NOT NULL,
  last_occurred_at TEXT NOT NULL,
  last_position INTEGER NOT NULL CHECK(last_position > 0),
  PRIMARY KEY (generation, aggregate_type, aggregate_id)
);

CREATE INDEX IF NOT EXISTS idx_execution_run_projection_status
  ON execution_run_projection(generation, status, last_position);
