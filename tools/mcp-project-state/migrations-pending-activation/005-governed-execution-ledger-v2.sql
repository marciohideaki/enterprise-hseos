-- Migration 005 — ADR-0022 governed execution ledger (schema v2)
-- PENDING ACTIVATION: production migration runners do not scan this directory.
-- G2 applies it only through the temporary-fixture gate. Moving it into the
-- operational migrations directory requires separate human authorization.

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
  UNIQUE(aggregate_type, aggregate_id, stream_sequence)
);

CREATE INDEX IF NOT EXISTS idx_execution_events_stream
  ON execution_events(aggregate_type, aggregate_id, stream_sequence);
CREATE INDEX IF NOT EXISTS idx_execution_events_operation
  ON execution_events(operation_id, position);
CREATE INDEX IF NOT EXISTS idx_execution_events_correlation
  ON execution_events(correlation_id, position);

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
