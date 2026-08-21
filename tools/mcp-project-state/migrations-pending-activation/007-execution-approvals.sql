-- Migration 007 — ADR-0022 immutable per-operation approvals
-- PENDING ACTIVATION alongside migrations 005 and 006.

CREATE TABLE IF NOT EXISTS execution_approvals (
  approval_id TEXT PRIMARY KEY CHECK(length(approval_id) > 0),
  operation_id TEXT NOT NULL CHECK(length(operation_id) > 0),
  authorizer_json TEXT NOT NULL CHECK(json_valid(authorizer_json) AND json_type(authorizer_json) = 'object'),
  resource_scope_json TEXT NOT NULL CHECK(json_valid(resource_scope_json) AND json_type(resource_scope_json) = 'object'),
  issued_at TEXT NOT NULL CHECK(
    issued_at GLOB '????-??-??T??:??:??.???Z'
    AND strftime('%Y-%m-%dT%H:%M:%fZ', issued_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ', issued_at) = issued_at
  ),
  expires_at TEXT NOT NULL CHECK(
    expires_at GLOB '????-??-??T??:??:??.???Z'
    AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) = expires_at
  ),
  decision TEXT NOT NULL CHECK(decision IN ('approved', 'denied')),
  policy_version TEXT NOT NULL CHECK(length(policy_version) > 0),
  evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) > 0),
  CHECK(expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_execution_approvals_operation
  ON execution_approvals(operation_id, decision, expires_at);

CREATE TABLE IF NOT EXISTS execution_approval_uses (
  approval_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  consumed_at TEXT NOT NULL CHECK(
    consumed_at GLOB '????-??-??T??:??:??.???Z'
    AND strftime('%Y-%m-%dT%H:%M:%fZ', consumed_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ', consumed_at) = consumed_at
  ),
  FOREIGN KEY (approval_id) REFERENCES execution_approvals(approval_id)
);

CREATE TRIGGER IF NOT EXISTS execution_approvals_no_update
BEFORE UPDATE ON execution_approvals
BEGIN SELECT RAISE(ABORT, 'execution_approvals is immutable'); END;

CREATE TRIGGER IF NOT EXISTS execution_approvals_no_replace
BEFORE INSERT ON execution_approvals
WHEN EXISTS (SELECT 1 FROM execution_approvals WHERE approval_id = NEW.approval_id)
BEGIN SELECT RAISE(ABORT, 'execution_approvals identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS execution_approvals_no_delete
BEFORE DELETE ON execution_approvals
BEGIN SELECT RAISE(ABORT, 'execution_approvals is immutable'); END;

CREATE TRIGGER IF NOT EXISTS execution_approval_uses_no_update
BEFORE UPDATE ON execution_approval_uses
BEGIN SELECT RAISE(ABORT, 'execution_approval_uses is immutable'); END;

CREATE TRIGGER IF NOT EXISTS execution_approval_uses_no_replace
BEFORE INSERT ON execution_approval_uses
WHEN EXISTS (
  SELECT 1 FROM execution_approval_uses
  WHERE approval_id = NEW.approval_id OR operation_id = NEW.operation_id
)
BEGIN SELECT RAISE(ABORT, 'execution_approval_uses identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS execution_approval_uses_no_delete
BEFORE DELETE ON execution_approval_uses
BEGIN SELECT RAISE(ABORT, 'execution_approval_uses is immutable'); END;
