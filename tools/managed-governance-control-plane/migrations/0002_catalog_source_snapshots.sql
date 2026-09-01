ALTER TABLE hseos_governance.import_batches
  ADD COLUMN previous_batch_id uuid,
  ADD COLUMN plan jsonb,
  ADD COLUMN report jsonb,
  ADD CONSTRAINT import_batches_previous_batch_fk
    FOREIGN KEY (organization_id, previous_batch_id)
    REFERENCES hseos_governance.import_batches(organization_id, import_batch_id)
    ON DELETE RESTRICT;

ALTER TABLE hseos_governance.import_batches
  ADD CONSTRAINT import_batches_plan_shape CHECK (plan IS NULL OR (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 8388608)),
  ADD CONSTRAINT import_batches_report_shape CHECK (report IS NULL OR (jsonb_typeof(report) = 'object' AND octet_length(report::text) <= 8388608));

CREATE TABLE hseos_governance.catalog_source_snapshots (
  catalog_source_snapshot_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  repository_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_path text NOT NULL CHECK (octet_length(source_path) BETWEEN 1 AND 1024 AND source_path !~ '(^/|\\|(^|/)\.\.(/|$))'),
  artifact_id text,
  artifact_type text NOT NULL CHECK (artifact_type IN ('constitution', 'standard', 'policy', 'rule', 'restriction', 'pattern', 'stack-profile', 'contract', 'schema', 'adr', 'authority', 'capability', 'hook', 'workflow', 'skill', 'exception', 'unclassified')),
  classification_status text NOT NULL CHECK (classification_status IN ('classified', 'partial', 'unclassified')),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  artifact_version_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, import_batch_id, source_path),
  FOREIGN KEY (organization_id, repository_id) REFERENCES hseos_governance.repositories(organization_id, repository_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, import_batch_id) REFERENCES hseos_governance.import_batches(organization_id, import_batch_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, artifact_id) REFERENCES hseos_governance.governance_artifacts(organization_id, artifact_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, artifact_version_id) REFERENCES hseos_governance.artifact_versions(organization_id, artifact_version_id) ON DELETE RESTRICT
);

ALTER TABLE hseos_governance.catalog_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE hseos_governance.catalog_source_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hseos_governance.catalog_source_snapshots
  USING (organization_id = nullif(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), ''));

DROP TRIGGER IF EXISTS catalog_source_snapshots_immutable ON hseos_governance.catalog_source_snapshots;
CREATE TRIGGER catalog_source_snapshots_immutable
BEFORE UPDATE OR DELETE ON hseos_governance.catalog_source_snapshots
FOR EACH ROW EXECUTE FUNCTION hseos_governance.reject_immutable_mutation();

REVOKE ALL ON hseos_governance.catalog_source_snapshots FROM PUBLIC;
GRANT SELECT, INSERT ON hseos_governance.catalog_source_snapshots TO hseos_governance_application;
GRANT SELECT ON hseos_governance.catalog_source_snapshots TO hseos_governance_auditor;
