CREATE SCHEMA IF NOT EXISTS hseos_governance;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hseos_governance_migrator') THEN
    CREATE ROLE hseos_governance_migrator NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hseos_governance_application') THEN
    CREATE ROLE hseos_governance_application NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hseos_governance_auditor') THEN
    CREATE ROLE hseos_governance_auditor NOLOGIN NOINHERIT;
  END IF;
END
$roles$;

CREATE TABLE IF NOT EXISTS hseos_governance.organizations (
  organization_pk uuid PRIMARY KEY,
  organization_id text NOT NULL UNIQUE CHECK (organization_id ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  display_name text NOT NULL CHECK (octet_length(display_name) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS hseos_governance.repositories (
  repository_pk uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  repository_id uuid NOT NULL,
  canonical_remote text NOT NULL CHECK (octet_length(canonical_remote) BETWEEN 1 AND 1024),
  active_batch_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, repository_id)
);

CREATE TABLE IF NOT EXISTS hseos_governance.subjects (
  subject_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  subject_type text NOT NULL CHECK (subject_type IN ('human', 'agent', 'automation', 'service')),
  pseudonymous_key text NOT NULL CHECK (octet_length(pseudonymous_key) BETWEEN 1 AND 512),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object' AND octet_length(attributes::text) <= 65536),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, subject_type, pseudonymous_key),
  UNIQUE (organization_id, subject_id)
);

CREATE TABLE IF NOT EXISTS hseos_governance.governance_artifacts (
  artifact_pk uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  artifact_id text NOT NULL CHECK (artifact_id ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  artifact_type text NOT NULL CHECK (artifact_type IN ('constitution', 'standard', 'policy', 'rule', 'restriction', 'pattern', 'stack-profile', 'contract', 'schema', 'adr', 'authority', 'capability', 'hook', 'workflow', 'skill', 'exception', 'unclassified')),
  namespace text NOT NULL CHECK (namespace ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,159}$'),
  title text NOT NULL CHECK (octet_length(title) BETWEEN 1 AND 512),
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('draft', 'published', 'deprecated', 'superseded', 'archived')),
  current_version integer CHECK (current_version IS NULL OR current_version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, artifact_id),
  UNIQUE (organization_id, namespace, slug)
);

CREATE TABLE IF NOT EXISTS hseos_governance.import_batches (
  import_batch_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  repository_id uuid NOT NULL,
  batch_key text NOT NULL CHECK (batch_key ~ '^sha256:[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (octet_length(idempotency_key) BETWEEN 1 AND 160),
  source_commit text NOT NULL CHECK (source_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  importer_version text NOT NULL CHECK (octet_length(importer_version) BETWEEN 1 AND 128),
  source_profile_digest text NOT NULL CHECK (source_profile_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('planned', 'applying', 'completed', 'failed', 'rolled-back')),
  active boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (organization_id, batch_key),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, import_batch_id),
  FOREIGN KEY (organization_id, repository_id) REFERENCES hseos_governance.repositories(organization_id, repository_id) ON DELETE RESTRICT
);

ALTER TABLE hseos_governance.repositories
  ADD CONSTRAINT repositories_active_batch_fk
  FOREIGN KEY (organization_id, active_batch_id) REFERENCES hseos_governance.import_batches(organization_id, import_batch_id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS hseos_governance.artifact_versions (
  artifact_version_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  artifact_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  raw_content text NOT NULL CHECK (octet_length(raw_content) <= 2097152),
  structured_content jsonb NOT NULL CHECK (jsonb_typeof(structured_content) = 'object' AND octet_length(structured_content::text) <= 1048576),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  source_repository_id uuid NOT NULL,
  source_path text NOT NULL CHECK (octet_length(source_path) BETWEEN 1 AND 1024 AND source_path !~ '(^/|\\|(^|/)\.\.(/|$))'),
  source_commit text NOT NULL CHECK (source_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  source_section text CHECK (source_section IS NULL OR octet_length(source_section) BETWEEN 1 AND 1024),
  classification_status text NOT NULL CHECK (classification_status IN ('classified', 'partial', 'unclassified')),
  import_batch_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, artifact_id) REFERENCES hseos_governance.governance_artifacts(organization_id, artifact_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_repository_id) REFERENCES hseos_governance.repositories(organization_id, repository_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, import_batch_id) REFERENCES hseos_governance.import_batches(organization_id, import_batch_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, artifact_version_id),
  UNIQUE (organization_id, artifact_id, version),
  UNIQUE (organization_id, artifact_id, content_digest)
);

CREATE TABLE IF NOT EXISTS hseos_governance.artifact_relations (
  relation_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  source_artifact_id text NOT NULL,
  target_artifact_id text NOT NULL,
  relation_kind text NOT NULL CHECK (relation_kind IN ('contains', 'implements', 'constrains', 'supersedes', 'references', 'applies-to', 'conflicts-with')),
  import_batch_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  CHECK (source_artifact_id <> target_artifact_id),
  FOREIGN KEY (organization_id, source_artifact_id) REFERENCES hseos_governance.governance_artifacts(organization_id, artifact_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, target_artifact_id) REFERENCES hseos_governance.governance_artifacts(organization_id, artifact_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, import_batch_id) REFERENCES hseos_governance.import_batches(organization_id, import_batch_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.governance_rules (
  rule_pk uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  rule_id text NOT NULL CHECK (rule_id ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  artifact_version_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('obligation', 'prohibition', 'permission', 'recommendation')),
  action text NOT NULL CHECK (action ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  resource jsonb NOT NULL CHECK (jsonb_typeof(resource) = 'object' AND octet_length(resource::text) <= 65536),
  conditions jsonb NOT NULL CHECK (jsonb_typeof(conditions) = 'array' AND octet_length(conditions::text) <= 262144),
  effect text NOT NULL CHECK (effect IN ('allow', 'deny', 'input_required')),
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 1000),
  obligations jsonb NOT NULL CHECK (jsonb_typeof(obligations) = 'array' AND octet_length(obligations::text) <= 262144),
  enforcement_points jsonb NOT NULL CHECK (jsonb_typeof(enforcement_points) = 'array' AND octet_length(enforcement_points::text) <= 65536),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, rule_id),
  FOREIGN KEY (organization_id, artifact_version_id) REFERENCES hseos_governance.artifact_versions(organization_id, artifact_version_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.rule_scopes (
  rule_scope_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  rule_id text NOT NULL,
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object' AND octet_length(scope::text) <= 262144),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, rule_id) REFERENCES hseos_governance.governance_rules(organization_id, rule_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.import_batch_items (
  import_batch_item_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  import_batch_id uuid NOT NULL,
  source_path text NOT NULL CHECK (octet_length(source_path) BETWEEN 1 AND 1024),
  artifact_id text,
  action text NOT NULL CHECK (action IN ('create', 'version', 'noop', 'rename', 'deactivate', 'review')),
  classification_status text NOT NULL CHECK (classification_status IN ('classified', 'partial', 'unclassified')),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  issues jsonb NOT NULL CHECK (jsonb_typeof(issues) = 'array' AND octet_length(issues::text) <= 262144),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, import_batch_id, source_path),
  UNIQUE (organization_id, import_batch_item_id),
  FOREIGN KEY (organization_id, import_batch_id) REFERENCES hseos_governance.import_batches(organization_id, import_batch_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.review_queue (
  review_item_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  import_batch_item_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  reason_code text NOT NULL CHECK (octet_length(reason_code) BETWEEN 1 AND 160),
  resolution jsonb CHECK (resolution IS NULL OR (jsonb_typeof(resolution) = 'object' AND octet_length(resolution::text) <= 65536)),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  FOREIGN KEY (organization_id, import_batch_item_id) REFERENCES hseos_governance.import_batch_items(organization_id, import_batch_item_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.drafts (
  draft_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  artifact_id text NOT NULL,
  base_artifact_version_id uuid,
  raw_content text NOT NULL CHECK (octet_length(raw_content) <= 2097152),
  structured_content jsonb NOT NULL CHECK (jsonb_typeof(structured_content) = 'object' AND octet_length(structured_content::text) <= 1048576),
  status text NOT NULL CHECK (status IN ('editing', 'in_review', 'changes_requested', 'approved', 'publication_requested', 'withdrawn')),
  optimistic_version integer NOT NULL DEFAULT 1 CHECK (optimistic_version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, artifact_id) REFERENCES hseos_governance.governance_artifacts(organization_id, artifact_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, base_artifact_version_id) REFERENCES hseos_governance.artifact_versions(organization_id, artifact_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES hseos_governance.subjects(organization_id, subject_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, draft_id)
);

CREATE TABLE IF NOT EXISTS hseos_governance.draft_reviews (
  draft_review_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  draft_id uuid NOT NULL,
  reviewer_subject_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  comment text CHECK (comment IS NULL OR octet_length(comment) <= 8192),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, draft_id) REFERENCES hseos_governance.drafts(organization_id, draft_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reviewer_subject_id) REFERENCES hseos_governance.subjects(organization_id, subject_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.publication_requests (
  publication_request_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  draft_id uuid NOT NULL,
  patch_digest text NOT NULL CHECK (patch_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('requested', 'published', 'rejected')),
  resulting_commit text CHECK (resulting_commit IS NULL OR resulting_commit ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (organization_id, draft_id) REFERENCES hseos_governance.drafts(organization_id, draft_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.governance_releases (
  release_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  release_name text NOT NULL CHECK (octet_length(release_name) BETWEEN 1 AND 160),
  release_digest text NOT NULL CHECK (release_digest ~ '^sha256:[a-f0-9]{64}$'),
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('draft', 'published', 'revoked')),
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  UNIQUE (organization_id, release_digest),
  UNIQUE (organization_id, release_id)
);

CREATE TABLE IF NOT EXISTS hseos_governance.release_items (
  release_item_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  release_id uuid NOT NULL,
  artifact_version_id uuid NOT NULL,
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  UNIQUE (organization_id, release_id, artifact_version_id),
  FOREIGN KEY (organization_id, release_id) REFERENCES hseos_governance.governance_releases(organization_id, release_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, artifact_version_id) REFERENCES hseos_governance.artifact_versions(organization_id, artifact_version_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.release_signatures (
  release_signature_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  release_id uuid NOT NULL,
  algorithm text NOT NULL CHECK (algorithm IN ('ed25519', 'ecdsa-p256-sha256')),
  key_id text NOT NULL CHECK (octet_length(key_id) BETWEEN 1 AND 160),
  signature text NOT NULL CHECK (octet_length(signature) BETWEEN 1 AND 1024),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, release_id, key_id),
  FOREIGN KEY (organization_id, release_id) REFERENCES hseos_governance.governance_releases(organization_id, release_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.project_assignments (
  assignment_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  repository_id uuid NOT NULL,
  release_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('portable', 'managed-shadow')),
  assigned_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, repository_id) REFERENCES hseos_governance.repositories(organization_id, repository_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, release_id) REFERENCES hseos_governance.governance_releases(organization_id, release_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, repository_id)
);

CREATE TABLE IF NOT EXISTS hseos_governance.acceptance_receipts (
  acceptance_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  repository_id uuid NOT NULL,
  release_digest text NOT NULL CHECK (release_digest ~ '^sha256:[a-f0-9]{64}$'),
  subject_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL,
  expires_at timestamptz,
  FOREIGN KEY (organization_id, repository_id) REFERENCES hseos_governance.repositories(organization_id, repository_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_id) REFERENCES hseos_governance.subjects(organization_id, subject_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.session_leases (
  lease_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  repository_id uuid NOT NULL,
  session_fingerprint text NOT NULL CHECK (octet_length(session_fingerprint) BETWEEN 1 AND 1024),
  binding_digest text NOT NULL CHECK (binding_digest ~ '^sha256:[a-f0-9]{64}$'),
  release_digest text NOT NULL CHECK (release_digest ~ '^sha256:[a-f0-9]{64}$'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (organization_id, repository_id) REFERENCES hseos_governance.repositories(organization_id, repository_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.revocations (
  revocation_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (target_type IN ('release', 'acceptance', 'lease', 'key')),
  target_id text NOT NULL CHECK (octet_length(target_id) BETWEEN 1 AND 1024),
  reason_code text NOT NULL CHECK (octet_length(reason_code) BETWEEN 1 AND 160),
  revoked_at timestamptz NOT NULL,
  UNIQUE (organization_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS hseos_governance.governance_exceptions (
  exception_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  rule_id text NOT NULL,
  approval_reference text NOT NULL CHECK (octet_length(approval_reference) BETWEEN 1 AND 1024),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object' AND octet_length(scope::text) <= 262144),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > starts_at),
  FOREIGN KEY (organization_id, rule_id) REFERENCES hseos_governance.governance_rules(organization_id, rule_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hseos_governance.audit_events (
  audit_event_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (octet_length(event_type) BETWEEN 1 AND 160),
  aggregate_type text NOT NULL CHECK (octet_length(aggregate_type) BETWEEN 1 AND 160),
  aggregate_id text NOT NULL CHECK (octet_length(aggregate_id) BETWEEN 1 AND 1024),
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor) = 'object' AND octet_length(actor::text) <= 65536),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144),
  occurred_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS hseos_governance.outbox_messages (
  outbox_message_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  topic text NOT NULL CHECK (octet_length(topic) BETWEEN 1 AND 256),
  aggregate_type text NOT NULL CHECK (octet_length(aggregate_type) BETWEEN 1 AND 160),
  aggregate_id text NOT NULL CHECK (octet_length(aggregate_id) BETWEEN 1 AND 1024),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144),
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0)
);

CREATE TABLE IF NOT EXISTS hseos_governance.projection_checkpoints (
  projection_checkpoint_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  projection_name text NOT NULL CHECK (octet_length(projection_name) BETWEEN 1 AND 160),
  checkpoint bigint NOT NULL CHECK (checkpoint >= 0),
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, projection_name)
);

CREATE TABLE IF NOT EXISTS hseos_governance.command_receipts (
  command_receipt_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES hseos_governance.organizations(organization_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (octet_length(idempotency_key) BETWEEN 1 AND 160),
  command_digest text NOT NULL CHECK (command_digest ~ '^sha256:[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 262144),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION hseos_governance.reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'immutable governance record cannot be changed' USING ERRCODE = '55000';
END
$function$;

DROP TRIGGER IF EXISTS artifact_versions_immutable ON hseos_governance.artifact_versions;
CREATE TRIGGER artifact_versions_immutable
BEFORE UPDATE OR DELETE ON hseos_governance.artifact_versions
FOR EACH ROW EXECUTE FUNCTION hseos_governance.reject_immutable_mutation();

DROP TRIGGER IF EXISTS audit_events_immutable ON hseos_governance.audit_events;
CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON hseos_governance.audit_events
FOR EACH ROW EXECUTE FUNCTION hseos_governance.reject_immutable_mutation();

DROP TRIGGER IF EXISTS command_receipts_immutable ON hseos_governance.command_receipts;
CREATE TRIGGER command_receipts_immutable
BEFORE UPDATE OR DELETE ON hseos_governance.command_receipts
FOR EACH ROW EXECUTE FUNCTION hseos_governance.reject_immutable_mutation();

CREATE OR REPLACE FUNCTION hseos_governance.protect_delivered_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.delivered_at IS NOT NULL THEN
    RAISE EXCEPTION 'delivered outbox record cannot be changed' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbox record cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF NEW.outbox_message_id IS DISTINCT FROM OLD.outbox_message_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.topic IS DISTINCT FROM OLD.topic
     OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
     OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.delivery_attempts < OLD.delivery_attempts THEN
    RAISE EXCEPTION 'outbox message content is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS outbox_messages_protected ON hseos_governance.outbox_messages;
CREATE TRIGGER outbox_messages_protected
BEFORE UPDATE OR DELETE ON hseos_governance.outbox_messages
FOR EACH ROW EXECUTE FUNCTION hseos_governance.protect_delivered_outbox();

DO $rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations', 'repositories', 'subjects', 'governance_artifacts', 'artifact_versions',
    'artifact_relations', 'governance_rules', 'rule_scopes', 'import_batches', 'import_batch_items',
    'review_queue', 'drafts', 'draft_reviews', 'publication_requests', 'governance_releases',
    'release_items', 'release_signatures', 'project_assignments', 'acceptance_receipts',
    'session_leases', 'revocations', 'governance_exceptions', 'audit_events', 'outbox_messages',
    'projection_checkpoints', 'command_receipts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE hseos_governance.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE hseos_governance.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON hseos_governance.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON hseos_governance.%I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), ''''))',
      table_name
    );
  END LOOP;
END
$rls$;

REVOKE ALL ON SCHEMA hseos_governance FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA hseos_governance FROM PUBLIC;
GRANT hseos_governance_application, hseos_governance_auditor TO CURRENT_USER;
GRANT USAGE ON SCHEMA hseos_governance TO hseos_governance_application, hseos_governance_auditor;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA hseos_governance TO hseos_governance_application;
REVOKE ALL ON hseos_governance.schema_migrations FROM hseos_governance_application, hseos_governance_auditor;
REVOKE UPDATE, DELETE ON hseos_governance.artifact_versions, hseos_governance.audit_events, hseos_governance.command_receipts FROM hseos_governance_application;
REVOKE DELETE ON hseos_governance.outbox_messages FROM hseos_governance_application;
GRANT SELECT ON hseos_governance.audit_events, hseos_governance.outbox_messages TO hseos_governance_auditor;
