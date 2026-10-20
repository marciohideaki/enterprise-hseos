-- Migration 017 — W5-09 governed agent memory and environment event catalog
-- PENDING ACTIVATION: this extends only the accepted fixture schema until the
-- ADR-0022/0023 compatibility gate and explicit operational cutover complete.

DROP TRIGGER execution_event_schemas_no_insert;

INSERT INTO execution_event_schemas (event_type, schema_version) VALUES
  ('memory.written', 1),
  ('memory.superseded', 1),
  ('memory.expired', 1),
  ('memory.deleted', 1),
  ('environment.lsp.completed', 1),
  ('environment.lsp.refused', 1),
  ('environment.lsp.blocked', 1),
  ('environment.dap.completed', 1),
  ('environment.dap.refused', 1),
  ('environment.dap.blocked', 1),
  ('environment.browser.completed', 1),
  ('environment.browser.refused', 1),
  ('environment.browser.blocked', 1),
  ('environment.computer.refused', 1),
  ('environment.computer.blocked', 1),
  ('environment.computer.session_opened', 1),
  ('environment.computer.session_closed', 1),
  ('environment.computer.session_expired', 1),
  ('environment.computer.action_executed', 1),
  ('environment.computer.approval_outcome', 1),
  ('environment.computer.screenshot', 1);

CREATE TRIGGER execution_event_schemas_no_insert
BEFORE INSERT ON execution_event_schemas
BEGIN SELECT RAISE(ABORT, 'execution_event_schemas changes require a migration'); END;
