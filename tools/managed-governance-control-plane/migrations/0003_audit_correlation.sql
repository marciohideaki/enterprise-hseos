ALTER TABLE hseos_governance.audit_events
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS causation_id uuid;

UPDATE hseos_governance.audit_events
SET correlation_id = audit_event_id
WHERE correlation_id IS NULL;

ALTER TABLE hseos_governance.audit_events
  ALTER COLUMN correlation_id SET NOT NULL;
