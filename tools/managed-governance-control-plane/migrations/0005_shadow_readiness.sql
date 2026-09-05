-- Shadow-readiness evidence tables (T03). Every table is tenant-scoped, RLS-forced and
-- append-only: application role gets SELECT+INSERT only, mutation/deletion is rejected by
-- both the missing grant and the shared hseos_governance.reject_immutable_mutation() trigger.

CREATE TABLE IF NOT EXISTS hseos_governance.release_publication_attempts (
  release_publication_attempt_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  source_repository_id uuid NOT NULL,
  release_id text NOT NULL CHECK (release_id ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  sequence integer NOT NULL CHECK (sequence > 0),
  source_commit text NOT NULL CHECK (source_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  approved_tag text NOT NULL CHECK (octet_length(approved_tag) BETWEEN 1 AND 1024),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  previous_release_digest text CHECK (previous_release_digest IS NULL OR previous_release_digest ~ '^sha256:[a-f0-9]{64}$'),
  stage text NOT NULL CHECK (stage IN ('planned', 'signed', 'published', 'rejected')),
  signer_id text CHECK (signer_id IS NULL OR octet_length(signer_id) BETWEEN 1 AND 160),
  signature_algorithm text CHECK (signature_algorithm IS NULL OR signature_algorithm IN ('ed25519', 'ecdsa-p256-sha256')),
  signed_digest text CHECK (signed_digest IS NULL OR signed_digest ~ '^sha256:[a-f0-9]{64}$'),
  rejection_reason text CHECK (rejection_reason IS NULL OR octet_length(rejection_reason) BETWEEN 1 AND 2048),
  attempted_at timestamptz NOT NULL,
  UNIQUE (organization_id, release_publication_attempt_id),
  UNIQUE (organization_id, manifest_digest, stage),
  FOREIGN KEY (organization_id, source_repository_id) REFERENCES hseos_governance.repositories(organization_id, repository_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.patch_publication_bundles (
  patch_publication_bundle_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  publication_request_ref text NOT NULL CHECK (octet_length(publication_request_ref) BETWEEN 1 AND 1024),
  source_repository_id uuid NOT NULL,
  base_commit text NOT NULL CHECK (base_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  patch_digest text NOT NULL CHECK (patch_digest ~ '^sha256:[a-f0-9]{64}$'),
  file_operations jsonb NOT NULL CHECK (jsonb_typeof(file_operations) = 'array' AND octet_length(file_operations::text) <= 1048576),
  application_instructions text NOT NULL CHECK (octet_length(application_instructions) BETWEEN 1 AND 1048576),
  rollback_instructions text NOT NULL CHECK (octet_length(rollback_instructions) BETWEEN 1 AND 1048576),
  generated_by text NOT NULL CHECK (octet_length(generated_by) BETWEEN 1 AND 160),
  generated_at timestamptz NOT NULL,
  UNIQUE (organization_id, patch_publication_bundle_id),
  UNIQUE (organization_id, manifest_digest),
  FOREIGN KEY (organization_id, source_repository_id) REFERENCES hseos_governance.repositories(organization_id, repository_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.shadow_receipts (
  shadow_receipt_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  repository_id uuid NOT NULL,
  adapter text NOT NULL CHECK (adapter ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  session_fingerprint text NOT NULL CHECK (session_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  local_digest text CHECK (local_digest IS NULL OR local_digest ~ '^sha256:[a-f0-9]{64}$'),
  remote_digest text CHECK (remote_digest IS NULL OR remote_digest ~ '^sha256:[a-f0-9]{64}$'),
  release_digest text CHECK (release_digest IS NULL OR release_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('equivalent', 'drift_detected', 'remote_unavailable', 'invalid_local_contract', 'not_configured')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  observed_at timestamptz NOT NULL,
  UNIQUE (organization_id, shadow_receipt_id),
  FOREIGN KEY (organization_id, repository_id) REFERENCES hseos_governance.repositories(organization_id, repository_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.readiness_evaluations (
  readiness_evaluation_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  window_days integer NOT NULL CHECK (window_days = 30),
  eligible_sessions integer NOT NULL CHECK (eligible_sessions >= 0),
  covered_sessions integer NOT NULL CHECK (covered_sessions >= 0 AND covered_sessions <= eligible_sessions),
  repositories_covered jsonb NOT NULL CHECK (jsonb_typeof(repositories_covered) = 'array'),
  repositories_missing_evidence jsonb NOT NULL CHECK (jsonb_typeof(repositories_missing_evidence) = 'array'),
  adapters_covered jsonb NOT NULL CHECK (jsonb_typeof(adapters_covered) = 'array'),
  adapters_missing_evidence jsonb NOT NULL CHECK (jsonb_typeof(adapters_missing_evidence) = 'array'),
  preflight_latency_p95_ms double precision NOT NULL CHECK (preflight_latency_p95_ms >= 0),
  open_drift_count integer NOT NULL CHECK (open_drift_count >= 0),
  open_invalid_contract_count integer NOT NULL CHECK (open_invalid_contract_count >= 0),
  remote_unavailable_samples integer NOT NULL CHECK (remote_unavailable_samples >= 0),
  signer_evidence_current boolean NOT NULL,
  recovery_evidence_current boolean NOT NULL,
  threat_model_evidence_current boolean NOT NULL,
  rollback_evidence_current boolean NOT NULL,
  ready boolean NOT NULL,
  authorizes_enforcement boolean NOT NULL CHECK (authorizes_enforcement = false),
  evaluated_at timestamptz NOT NULL,
  UNIQUE (organization_id, readiness_evaluation_id),
  CHECK (window_end >= window_start)
);

CREATE TABLE IF NOT EXISTS hseos_governance.recovery_rehearsals (
  recovery_rehearsal_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  recovery_profile_digest text NOT NULL CHECK (recovery_profile_digest ~ '^sha256:[a-f0-9]{64}$'),
  disposable_target_ref text NOT NULL CHECK (octet_length(disposable_target_ref) BETWEEN 1 AND 1024),
  disposable_target_confirmed boolean NOT NULL CHECK (disposable_target_confirmed = true),
  measured_rpo_seconds double precision NOT NULL CHECK (measured_rpo_seconds >= 0),
  measured_rto_seconds double precision NOT NULL CHECK (measured_rto_seconds >= 0),
  tenant_isolation_verified boolean NOT NULL,
  active_catalog_verified boolean NOT NULL,
  release_signatures_verified boolean NOT NULL,
  audit_history_append_only_verified boolean NOT NULL,
  within_declared_profile boolean NOT NULL,
  rehearsed_at timestamptz NOT NULL,
  UNIQUE (organization_id, recovery_rehearsal_id)
);

-- Populated by the network-admission gate (T09/T10); persistence lands here so evidence
-- exists once that gate is built. Raw client IPs are nullable by design: retained only when
-- the deployment retention profile explicitly permits them (Data Model, design.md).
CREATE TABLE IF NOT EXISTS hseos_governance.network_access_audit (
  network_access_audit_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  client_identifier text NOT NULL CHECK (octet_length(client_identifier) BETWEEN 1 AND 256),
  raw_client_ip inet,
  route_scope text NOT NULL CHECK (route_scope IN ('query', 'admin')),
  matched_allowlist_rule text CHECK (matched_allowlist_rule IS NULL OR octet_length(matched_allowlist_rule) BETWEEN 1 AND 256),
  outcome text NOT NULL CHECK (outcome IN ('allow', 'deny')),
  deny_reason text CHECK (deny_reason IS NULL OR octet_length(deny_reason) BETWEEN 1 AND 256),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (organization_id, network_access_audit_id),
  CHECK (outcome = 'allow' OR deny_reason IS NOT NULL),
  CHECK (outcome = 'deny' OR deny_reason IS NULL)
);

DO $shadow_readiness_rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'release_publication_attempts', 'patch_publication_bundles', 'shadow_receipts',
    'readiness_evaluations', 'recovery_rehearsals', 'network_access_audit'
  ]
  LOOP
    EXECUTE format('ALTER TABLE hseos_governance.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE hseos_governance.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON hseos_governance.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON hseos_governance.%I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), ''''))',
      table_name
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON hseos_governance.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON hseos_governance.%I FOR EACH ROW EXECUTE FUNCTION hseos_governance.reject_immutable_mutation()',
      table_name, table_name
    );
    EXECUTE format('REVOKE ALL ON hseos_governance.%I FROM PUBLIC', table_name);
    EXECUTE format('GRANT SELECT, INSERT ON hseos_governance.%I TO hseos_governance_application', table_name);
    EXECUTE format('GRANT SELECT ON hseos_governance.%I TO hseos_governance_auditor', table_name);
  END LOOP;
END
$shadow_readiness_rls$;
