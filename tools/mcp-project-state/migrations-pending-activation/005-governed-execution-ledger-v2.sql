-- Migration 005 — ADR-0022 governed execution ledger (schema v2)
-- PENDING ACTIVATION: the accepted ADR requires 30 consecutive zero-legacy
-- days and migration evidence before an activation release may run this file.

CREATE TABLE IF NOT EXISTS execution_event_schemas (
  event_type TEXT NOT NULL CHECK(length(event_type) > 0),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  PRIMARY KEY (event_type, schema_version)
);

INSERT INTO execution_event_schemas (event_type, schema_version) VALUES
  ('ExecutionAuthorized', 1),
  ('ExecutionStarted', 1),
  ('ExecutionSucceeded', 1),
  ('ExecutionFailed', 1),
  ('ExecutionCancelled', 1),
  ('ExecutionOutcomeUncertain', 1),
  ('ExecutionCompensated', 1),
  ('ExecutionCompensationFailed', 1);

CREATE TRIGGER IF NOT EXISTS execution_event_schemas_no_insert
BEFORE INSERT ON execution_event_schemas
BEGIN SELECT RAISE(ABORT, 'execution_event_schemas changes require a migration'); END;

CREATE TRIGGER IF NOT EXISTS execution_event_schemas_no_update
BEFORE UPDATE ON execution_event_schemas
BEGIN SELECT RAISE(ABORT, 'execution_event_schemas changes require a migration'); END;

CREATE TRIGGER IF NOT EXISTS execution_event_schemas_no_delete
BEFORE DELETE ON execution_event_schemas
BEGIN SELECT RAISE(ABORT, 'execution_event_schemas changes require a migration'); END;

CREATE TABLE IF NOT EXISTS execution_events (
  position INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE CHECK(
    length(event_id) = 36
    AND substr(event_id, 9, 1) = '-'
    AND substr(event_id, 14, 1) = '-'
    AND substr(event_id, 19, 1) = '-'
    AND substr(event_id, 24, 1) = '-'
    AND length(replace(event_id, '-', '')) = 32
    AND lower(replace(event_id, '-', '')) NOT GLOB '*[^0-9a-f]*'
  ),
  event_type TEXT NOT NULL CHECK(length(event_type) > 0),
  aggregate_id TEXT NOT NULL CHECK(length(aggregate_id) > 0),
  aggregate_type TEXT NOT NULL CHECK(length(aggregate_type) > 0),
  stream_sequence INTEGER NOT NULL CHECK(stream_sequence > 0),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  occurred_at TEXT NOT NULL CHECK(
    occurred_at GLOB '????-??-??T??:??:??.???Z'
    AND strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at) = occurred_at
  ),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) > 0),
  causation_id TEXT NOT NULL CHECK(length(causation_id) > 0),
  actor_json TEXT NOT NULL CHECK(json_valid(actor_json) AND json_type(actor_json) = 'object'),
  operation_id TEXT NOT NULL CHECK(length(operation_id) > 0),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]'
    CHECK(json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array'),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(aggregate_type, aggregate_id, stream_sequence),
  FOREIGN KEY (event_type, schema_version) REFERENCES execution_event_schemas(event_type, schema_version)
);

CREATE INDEX IF NOT EXISTS idx_execution_events_stream
  ON execution_events(aggregate_type, aggregate_id, stream_sequence);
CREATE INDEX IF NOT EXISTS idx_execution_events_operation
  ON execution_events(operation_id, position);
CREATE INDEX IF NOT EXISTS idx_execution_events_correlation
  ON execution_events(correlation_id, position);

CREATE TRIGGER IF NOT EXISTS execution_events_registered_schema
BEFORE INSERT ON execution_events
WHEN NOT EXISTS (
  SELECT 1 FROM execution_event_schemas schema
  WHERE schema.event_type = NEW.event_type AND schema.schema_version = NEW.schema_version
)
BEGIN
  SELECT RAISE(ABORT, 'execution event type/schema is not registered');
END;

CREATE TRIGGER IF NOT EXISTS execution_events_no_update
BEFORE UPDATE ON execution_events
BEGIN
  SELECT RAISE(ABORT, 'execution_events is append-only');
END;

-- SQLite's INSERT OR REPLACE resolves a uniqueness collision by deleting the
-- old row and then inserting the replacement. DELETE triggers for that implicit
-- removal depend on a connection-local recursive_triggers setting, so reject
-- every identity/stream collision before conflict resolution instead.
CREATE TRIGGER IF NOT EXISTS execution_events_no_replace
BEFORE INSERT ON execution_events
WHEN EXISTS (
  SELECT 1 FROM execution_events existing
  WHERE existing.position = NEW.position
     OR existing.event_id = NEW.event_id
     OR (
       existing.aggregate_type = NEW.aggregate_type
       AND existing.aggregate_id = NEW.aggregate_id
       AND existing.stream_sequence = NEW.stream_sequence
     )
)
BEGIN
  SELECT RAISE(ABORT, 'execution_events identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS execution_events_no_delete
BEFORE DELETE ON execution_events
BEGIN
  SELECT RAISE(ABORT, 'execution_events is append-only');
END;
