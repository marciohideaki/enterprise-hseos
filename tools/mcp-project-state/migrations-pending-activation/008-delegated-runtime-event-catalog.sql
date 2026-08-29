-- Migration 008 — ADR-0024 delegated runtime event catalog
-- PENDING ACTIVATION: this extends only the accepted fixture schema until the
-- ADR-0022/0023 compatibility gate and explicit operational cutover complete.

DROP TRIGGER execution_event_schemas_no_insert;

INSERT INTO execution_event_schemas (event_type, schema_version) VALUES
  ('delegated.runtime.created', 1),
  ('delegated.runtime.bound', 1),
  ('delegated.turn.requested', 1),
  ('delegated.turn.dispatch_started', 1),
  ('delegated.cancel.requested', 1),
  ('delegated.runtime.failed', 1),
  ('delegated.runtime.outcome_uncertain', 1),
  ('delegated.runtime.event_recorded', 1);

CREATE TRIGGER execution_event_schemas_no_insert
BEFORE INSERT ON execution_event_schemas
BEGIN SELECT RAISE(ABORT, 'execution_event_schemas changes require a migration'); END;
