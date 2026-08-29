-- Migration 009 — ADR-0024 delegated worker lifecycle event catalog
-- PENDING ACTIVATION: fixture-only until G9 and explicit operational cutover.

DROP TRIGGER execution_event_schemas_no_insert;

INSERT INTO execution_event_schemas (event_type, schema_version) VALUES
  ('delegated.worker.attached', 1),
  ('delegated.worker.heartbeat', 1),
  ('delegated.worker.drain_requested', 1),
  ('delegated.worker.parked', 1),
  ('delegated.worker.orphaned', 1),
  ('delegated.worker.retired', 1);

CREATE TRIGGER execution_event_schemas_no_insert
BEFORE INSERT ON execution_event_schemas
BEGIN SELECT RAISE(ABORT, 'execution_event_schemas changes require a migration'); END;
