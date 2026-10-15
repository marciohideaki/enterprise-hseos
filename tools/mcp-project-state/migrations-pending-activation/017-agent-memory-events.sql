-- Migration 017 — W5-09 governed agent memory event catalog
-- PENDING ACTIVATION: this extends only the accepted fixture schema until the
-- ADR-0022/0023 compatibility gate and explicit operational cutover complete.

DROP TRIGGER execution_event_schemas_no_insert;

INSERT INTO execution_event_schemas (event_type, schema_version) VALUES
  ('memory.written', 1),
  ('memory.superseded', 1),
  ('memory.expired', 1),
  ('memory.deleted', 1);

CREATE TRIGGER execution_event_schemas_no_insert
BEFORE INSERT ON execution_event_schemas
BEGIN SELECT RAISE(ABORT, 'execution_event_schemas changes require a migration'); END;
