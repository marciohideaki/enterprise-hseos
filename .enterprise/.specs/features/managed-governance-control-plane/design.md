# Managed Governance Control Plane — Design

**Status:** Approved for `managed-shadow` implementation on 2026-09-01
**Date:** 2026-09-01
**Specification:** `spec.md`
**ADR:** `.enterprise/.specs/decisions/ADR-0032-managed-governance-control-plane.md`

## Bounded Context

`Managed Governance` owns the structured catalog, authoring lifecycle, publication requests,
assignments, acceptance records, shadow resolution and audit of centrally managed governance. It
does not own governed execution, repository identity, Git merge authority or the local compiler.

The context is divided into six modules:

1. **Catalog** — artifacts, immutable versions, relations and source provenance.
2. **Authoring** — drafts, validation, review and publication requests.
3. **Policy Resolution** — rules, scopes, precedence and explanations.
4. **Release Management** — manifests, content digests, assignments and revocations.
5. **Session Governance** — bindings, snapshots, acceptance receipts and leases.
6. **Audit** — append-only audit records, outbox and projection checkpoints.

References to execution use `repository_id`, `operation_id`, `release_id` and digests. No table or
transaction is shared with the governed execution ledger.

## Architecture Approach

The implementation follows Hexagonal Architecture per ADR-0001:

```text
                        Admin Console
                             |
                         HTTP Adapter
                             |
CLI Adapter ---- Governance Application Ports ---- MCP Read Adapter
                             |
          +------------------+------------------+
          |                  |                  |
       Catalog          Policy Resolver      Authoring
          |                  |                  |
          +---------- Domain Contracts ----------+
                             |
                  GovernanceRepositoryPort
                    /                  \
            PostgreSQL Adapter      In-memory Fake
                    |
           migrations + RLS + outbox

Git Source Adapter -> Import Planner -> Import Application Service
                                        |
                                  Catalog + Audit
```

The write model uses transactional CRUD with immutable versions, not Event Sourcing. This follows
ADR-0002 and ADR-0003: PostgreSQL is the relational source of truth for mutable control-plane state;
query responses are projections that can be rebuilt. Every mutation writes audit and outbox rows in
the same transaction.

The system uses ports instead of importing PostgreSQL, HTTP or MCP concerns into the domain:

- `GovernanceRepositoryPort`;
- `GovernanceSourcePort`;
- `GovernanceQueryPort`;
- `GovernanceCommandPort`;
- `PolicyDecisionPort`;
- `PublicationPort`;
- `SignerPort`;
- `ClockPort` and `IdGeneratorPort`.

## Repository and Package Topology

```text
packages/managed-governance-contracts/
  index.js
  schemas.js
  canonical-json.js
  package.json
  README.md

packages/managed-governance-client/
  index.js
  client.js
  snapshot-store.js
  package.json
  README.md

tools/managed-governance-control-plane/
  package.json
  server.js
  composition.js
  lib/
    configuration.js
    application/
    domain/
    infrastructure/postgres/
    infrastructure/git/
    interfaces/http/
  migrations/
  public/

tools/cli/lib/managed-governance/
  commands.js
  output.js

test/managed-governance/
  contracts.test.js
  catalog.test.js
  import.test.js
  policy-resolution.test.js
  http.test.js
  console.test.js
  postgres.integration.test.js
```

`packages/managed-governance-contracts` has no infrastructure dependency other than Zod.
`packages/managed-governance-client` depends on contracts but not on the server. The sidecar owns the
PostgreSQL dependency and does not enter the baseline core activation path.

## Domain Model

### GovernanceArtifact

Identity shared across versions.

| Field              | Invariant                                                    |
| ------------------ | ------------------------------------------------------------ |
| `artifact_id`      | Stable scoped identifier, never reused                       |
| `organization_id`  | Required tenant boundary                                     |
| `artifact_type`    | Closed v1 vocabulary                                         |
| `namespace`        | Stable logical grouping                                      |
| `slug`             | Unique within organization and namespace                     |
| `lifecycle_status` | `draft`, `published`, `deprecated`, `superseded`, `archived` |

### ArtifactVersion

Immutable content and provenance.

| Field                   | Invariant                               |
| ----------------------- | --------------------------------------- |
| `artifact_version_id`   | UUID                                    |
| `artifact_id`           | Existing artifact                       |
| `version`               | Monotonic integer per artifact          |
| `raw_content`           | Exact imported or authored text         |
| `structured_content`    | Valid JSON object for the artifact type |
| `content_digest`        | SHA-256 of canonical content envelope   |
| `source_repository_id`  | Repository contract identity            |
| `source_path`           | Project-relative normalized path        |
| `source_commit`         | Full Git object ID                      |
| `source_section`        | Optional heading or rule locator        |
| `classification_status` | `classified`, `partial`, `unclassified` |

Published versions are immutable. Corrections create another version.

### GovernanceRule

```yaml
schema_version: 1
rule_id: git.protected-branch.no-direct-write
organization_id: hideaki-solutions
kind: prohibition
subject:
  actor_types: [human, agent, automation]
action: git.commit
resource:
  type: git-branch
scope:
  repositories: ['*']
  branches: [main, master, develop]
conditions: []
effect: deny
priority: 900
obligations: []
enforcement_points: [preflight, hook, cli]
source:
  artifact_id: enterprise-constitution
  artifact_version: 1
  locator: git-rules
```

Rules can only restrict a higher-precedence layer unless an explicit, valid exception references an
approval. The first delivery evaluates pure data predicates only; arbitrary scripts and expressions
are forbidden.

### ImportBatch

An import batch is identified by:

```text
sha256(repository_id + source_commit + importer_version + source_profile_digest)
```

States: `planned`, `applying`, `completed`, `failed`, `rolled-back`. Rollback marks versions and
relations introduced by the batch as inactive projections; it does not delete provenance or audit.

### Draft and PublicationRequest

A draft references an optional base artifact version and contains raw/structured proposed content.
States:

```text
editing -> in_review -> changes_requested -> in_review -> approved -> publication_requested
        \-> withdrawn
```

Approval is an explicit recorded transition. A publication request renders a deterministic patch
against the central Git source. `published` is recorded only after an operator supplies and verifies
the resulting Git commit and release digest.

### GovernanceRelease

Immutable manifest of artifact versions and policy rules. Its digest is calculated from canonical
JSON excluding the detached signature. Releases are not required for the initial import but are
required before project assignment.

### Binding, Acceptance and Lease

- A binding references `repository-contract/v1`, organization, mode, trusted issuers and snapshot
  policy.
- Acceptance binds subject + repository + release digest; it is not an operational approval.
- A lease binds a session fingerprint to release, binding and policy digests.
- In the first delivery, leases and `managed-enforced` are contract-only and cannot activate.

## Contract Design

All JavaScript contract schemas are strict on write and return frozen parsed objects. Readers may
add an explicit version adapter later, but v1 rejects unknown fields at authority boundaries.

### Exported schemas

- `GovernanceArtifactSchema`;
- `ArtifactVersionSchema`;
- `GovernanceRelationSchema`;
- `GovernanceRuleSchema`;
- `ManagedGovernanceBindingSchema`;
- `GovernanceReleaseSchema`;
- `GovernanceSnapshotSchema`;
- `GovernanceAcceptanceSchema`;
- `GovernanceSessionLeaseSchema`;
- `GovernanceDecisionSchema`;
- `ImportPlanSchema` and `ImportReportSchema`.

Every top-level object carries `schema_version: 1`. Digests use `sha256:<64 lowercase hex>`.
Timestamps use RFC 3339 with offset. IDs are bounded to 160 bytes and content sizes are validated
before parsing nested structures.

### HTTP API v1

The sidecar binds to `127.0.0.1` by default.

| Method  | Path                                      | Behavior                                   |
| ------- | ----------------------------------------- | ------------------------------------------ |
| `GET`   | `/health`                                 | Liveness, readiness and migration state    |
| `GET`   | `/api/v1/artifacts`                       | Filtered, cursor-paginated artifact list   |
| `GET`   | `/api/v1/artifacts/{id}`                  | Artifact with selected immutable version   |
| `GET`   | `/api/v1/artifacts/{id}/versions`         | Version history                            |
| `GET`   | `/api/v1/rules`                           | Filtered rule list                         |
| `GET`   | `/api/v1/context`                         | Effective read-only governance context     |
| `GET`   | `/api/v1/releases/{id}`                   | Immutable release manifest                 |
| `POST`  | `/api/v1/releases/diff`                   | Deterministic read-only release comparison |
| `POST`  | `/api/v1/snapshots/verify`                | Read-only snapshot integrity result        |
| `GET`   | `/api/v1/session/status`                  | Managed-shadow readiness and status        |
| `POST`  | `/api/v1/policy/evaluate`                 | Structured shadow decision and explanation |
| `POST`  | `/api/v1/imports/plan`                    | Read-only deterministic import plan        |
| `POST`  | `/api/v1/imports`                         | Apply an idempotent import batch           |
| `POST`  | `/api/v1/drafts`                          | Create a draft                             |
| `PATCH` | `/api/v1/drafts/{id}`                     | Optimistic-concurrency update              |
| `POST`  | `/api/v1/drafts/{id}/submit`              | Move to review                             |
| `POST`  | `/api/v1/drafts/{id}/review`              | Record review decision                     |
| `POST`  | `/api/v1/drafts/{id}/publication-request` | Render publication artifact                |
| `GET`   | `/api/v1/audit`                           | Authorized cursor-paginated audit query    |

All responses use:

```json
{
  "schema_version": 1,
  "ok": true,
  "data": {},
  "error": null,
  "evidence": [],
  "warnings": []
}
```

Stable errors include `invalid_request`, `not_found`, `conflict`, `unauthorized`, `policy_denied`,
`database_unavailable`, `migration_required`, `import_failed` and `internal_error`.

Administrative endpoints require an `ActorContext` supplied by an authentication adapter. The local
development adapter accepts an explicit test identity only when `HSEOS_GOVERNANCE_DEV_AUTH=true`.
There is no anonymous mutation mode.

### CLI

```text
hseos governance catalog import --plan --source .enterprise --json
hseos governance catalog import --apply --source .enterprise --json
hseos governance catalog status --json
hseos governance artifact list --type policy --json
hseos governance policy evaluate --context context.json --json
hseos governance server start --bind 127.0.0.1 --port 4319
hseos governance setup install --database-config .hseos/config/managed-governance-sidecar.json --actor operator --json
```

`--plan` performs no writes. `--apply` requires an explicit database configuration and actor
identity. Output uses the same envelope as HTTP/MCP.

### Operational setup contract

The distributed package has no infrastructure-specific defaults. A strict project-local JSON
document supplies only portable metadata and environment-variable references:

```json
{
  "schema_version": 1,
  "mode": "managed-shadow",
  "database": {
    "migration_connection_string_env": "HSEOS_GOVERNANCE_MIGRATION_DATABASE_URL",
    "runtime_connection_string_env": "HSEOS_GOVERNANCE_RUNTIME_DATABASE_URL",
    "max_connections": 10,
    "connection_timeout_ms": 5000,
    "idle_timeout_ms": 30000,
    "statement_timeout_ms": 15000,
    "ssl": false
  },
  "organization": {
    "id": "example-organization",
    "display_name": "Example Organization"
  },
  "control_plane": {
    "host": "127.0.0.1",
    "port": 4319,
    "authentication_token_env": "HSEOS_GOVERNANCE_TOKEN"
  },
  "binding": {
    "issuer": "example-issuer",
    "trusted_key_ids": ["example-key"]
  }
}
```

Names and endpoint values above are illustrative, not package defaults. The setup command resolves
the database URL and development token from the named environment variables, validates the current
repository identity, applies immutable migrations, seeds through `ImportCatalogService`, and writes
the binding plus `.hseos/config/managed-governance.json` atomically. No secret value is persisted.

The sidecar composition loads the same document, creates the PostgreSQL pool and repository adapter,
and wires health, catalog, audit, session-status and read-only policy/query services into the HTTP
router. Loopback is the only accepted first-generation network profile. Database creation is an
operator-owned prerequisite because the package cannot infer whether PostgreSQL is local, shared,
cluster-managed or externally managed.

### MCP evolution

The current five tools remain. New read-only tools are backed by `GovernanceQueryPort`:

- `get_effective_governance_context`;
- `evaluate_governed_action`;
- `explain_governance_decision`;
- `get_governance_artifact`;
- `get_governance_release`;
- `diff_governance_releases`;
- `verify_governance_snapshot`;
- `get_governance_session_status`.

No MCP tool invokes the command port in v1.

## Data Model

Migration files are ordered and immutable.

### Core tables

```text
organizations
repositories
subjects
governance_artifacts
artifact_versions
artifact_relations
governance_rules
rule_scopes
import_batches
import_batch_items
review_queue
drafts
draft_reviews
publication_requests
governance_releases
release_items
release_signatures
project_assignments
acceptance_receipts
session_leases
revocations
governance_exceptions
audit_events
outbox_messages
projection_checkpoints
schema_migrations
```

### Required database invariants

- UUID primary keys generated by the application or `gen_random_uuid()`.
- `organization_id NOT NULL` on every tenant table.
- unique artifact slug per `(organization_id, namespace, slug)`.
- unique version and content digest per artifact.
- unique import batch key and idempotency key.
- immutable published versions enforced by trigger or revoked update privilege.
- foreign keys are restrictive by default; no cascade from organization or artifact history.
- JSONB check constraints validate top-level object shape and bounded serialized size.
- `audit_events` and delivered outbox messages cannot be updated or deleted by application role.
- Row-level security requires a transaction-local `app.organization_id`.
- separate database roles for migrator, application and read-only audit.

### Transaction boundaries

Each command transaction writes:

1. domain state;
2. one audit event;
3. one outbox message;
4. optimistic version increment where applicable.

An import batch uses a staging transaction per bounded chunk and promotes the complete batch with an
atomic active-batch pointer. Readers never observe a partially promoted batch.

## Import and Seed Design

### Source profiles

The initial `enterprise-hseos/v1` profile allowlists:

- `.enterprise/.specs/constitution/**/*.md`;
- `.enterprise/.specs/core/**/*.md`;
- `.enterprise/.specs/cross/**/*.md`;
- `.enterprise/.specs/{CSharp,Cpp,Flutter,Go,Java,PHP,ReactNative}/**/*.md`;
- `.enterprise/.specs/decisions/ADR-*.md`;
- `.enterprise/policies/**/*.md`;
- `.enterprise/governance/capabilities/**/*.{yaml,yml,json}`;
- `.enterprise/governance/hooks/**/*.{yaml,yml,sh,js}`;
- `.hseos/workflows/registry.yaml` and `.hseos/workflows/**/workflow.md`;
- `.enterprise/governance/agent-skills/**/SKILL.md`.

Generated `.agents/`, logs, worktrees, archives and external paths are excluded.

### Pipeline

```text
discover -> secure-read -> normalize -> classify -> extract -> validate
         -> canonicalize -> digest -> diff -> plan -> apply -> parity-report
```

- Markdown frontmatter and headings provide deterministic structure.
- YAML/JSON is parsed with safe schemas and preserved in canonical JSON.
- Shell/JavaScript hook bodies are preserved as content, not executed.
- Rules are extracted only from allowlisted structured sources or exact deterministic patterns.
- Any uncertainty produces a review item, never an executable rule.
- The parity report accounts for every discovered source as classified, partial or unclassified.

### Seed command

The seed is the import command applied to an empty schema; there is no divergent SQL data fixture.
Reference fixture data exists only for tests. This ensures production seed and ongoing synchronization
share one code path.

## Policy Resolution

Precedence, lowest number first:

1. Constitution;
2. organization standard;
3. organization policy;
4. portfolio/product;
5. project/repository;
6. environment;
7. protected branch/ref;
8. agent authority;
9. activated skill/workflow;
10. valid approved exception.

The resolver:

1. selects rules matching subject, action, resource and scope;
2. validates rule source and lifecycle;
3. orders by precedence and priority;
4. folds restrictions monotonically;
5. rejects same-level contradictions with `input_required` or `deny` per action class;
6. returns the selected rules and explanation tree.

Managed-shadow runs the catalog resolver and current local resolver independently. The local result
remains authoritative; mismatch creates audit evidence and a metric.

## Console Design

The first console is a static sidecar UI served by the control-plane HTTP adapter. It has no database
credentials and applies a strict Content Security Policy.

Screens:

- **Overview:** catalog coverage, active source commit, unclassified items, parity and health.
- **Artifacts:** type/status filters, provenance and version history.
- **Rule editor:** schema-driven fields for kind, subject, action, resource, scope, effect, priority,
  obligations and enforcement points.
- **Standards and contracts:** raw/structured split view with validation.
- **Stack profiles:** language, runtime, version bounds, required/allowed/forbidden dependencies,
  build/test/lint commands and security/observability requirements.
- **Review queue:** classification gaps and draft review transitions.
- **Diff and simulation:** textual diff, semantic diff and policy context preview.
- **Publication:** render and download a review artifact; no browser-side Git push.
- **Audit:** authorized immutable timeline.

Forms use JSON-schema-like metadata exported from the Zod contract definitions through an explicit
UI schema, avoiding hand-coded field drift.

Accessibility target is WCAG 2.1 AA for keyboard navigation, focus, labels, contrast, error summary
and reduced motion.

## Security Considerations

- Trust boundaries exist at browser/API, CLI/API, Git/importer, control plane/PostgreSQL and
  release/client.
- Imported content is untrusted data: never executed, dynamically required or interpolated into SQL.
- All identifiers are validated before use in paths or queries.
- SQL uses parameterized statements only.
- Import reads reject special files, symlink escape and file-size overflow.
- Mutation requires authenticated actor context, authorization and CSRF protection for browser
  sessions.
- Content Security Policy denies inline script except hashed assets.
- Audit metadata is allowlisted and redacted.
- Snapshot/signature verification uses constant-time digest comparison where applicable.
- Production signing keys remain outside the application database.

A formal threat model is required before non-loopback or managed-enforced activation.

## Resilience

- Database calls have configurable statement and acquisition timeouts.
- Idempotent reads may retry with bounded exponential backoff and jitter.
- Writes retry only on safe serialization failures under the same idempotency key.
- Circuit-breaker state is process-local and observable; it never converts a failed write into
  success.
- Shadow clients fall back to a valid local snapshot and mark the result degraded.
- Import failures preserve the prior active batch.
- Graceful shutdown stops accepting writes, drains in-flight transactions and closes the pool.

## Observability Plan

Structured events:

- `governance.import.planned|completed|failed|rolled_back`;
- `governance.artifact.versioned`;
- `governance.draft.created|submitted|reviewed`;
- `governance.publication.requested|confirmed`;
- `governance.policy.evaluated`;
- `governance.shadow.mismatch`;
- `governance.outbox.dispatched|failed`;
- `governance.database.circuit_changed`.

Metrics:

- `hseos_governance_import_duration_seconds`;
- `hseos_governance_import_items_total{classification,result}`;
- `hseos_governance_policy_duration_seconds`;
- `hseos_governance_shadow_mismatch_total`;
- `hseos_governance_unclassified_items`;
- `hseos_governance_outbox_pending`;
- `hseos_governance_database_errors_total{code}`.

No raw governance content, secret, session lease or direct personal identifier is logged.

## Migration and Rollback

1. Apply migrations with the migrator role.
2. Run import `--plan` and store the report.
3. Apply the seed with an idempotency key.
4. Verify coverage and deterministic re-import.
5. Enable the read-only console on loopback.
6. Enable CLI/API shadow queries.
7. Leave all assignments non-blocking.
8. Generate and verify the project-local managed-shadow binding and MCP endpoint configuration.
9. Start the database-backed sidecar and require ready health plus catalog parity before handoff.

Rollback disables the sidecar and managed binding. Database migrations use forward fixes; data
rollback deactivates an import batch while retaining audit. Portable execution is unaffected.

## Compatibility

- Existing MCP tools retain names and output semantics.
- Managed packages and sidecars are opt-in and omitted from baseline activation.
- `repository-contract/v1` is unchanged.
- A new `managed-governance-binding/v1` is additive.
- Current `.agents/manifest.yaml` remains authoritative for portable mode.
- Any future removal of local authority requires another major-version ADR.

## Testing Strategy

- contract tests with valid, invalid, boundary and unknown-field fixtures;
- deterministic canonicalization golden tests;
- domain tests for lifecycle and policy conflicts;
- importer tests for unchanged, changed, renamed, deleted, ambiguous and symlink inputs;
- repository contract tests using a fake port;
- PostgreSQL integration tests for migrations, RLS, transactions, idempotency and rollback;
- HTTP/CLI/MCP parity tests against the same application port;
- console DOM/accessibility smoke tests;
- portable regression suite with managed mode absent;
- documentation-neutrality and package-surface tests.
- strict configuration tests for unknown fields, inline secrets, unsafe files and missing env refs;
- end-to-end setup tests proving migration/seed/binding idempotency and database-backed health;
- package-install smoke using only public CLI entrypoints and an operator-supplied PostgreSQL URL.

## ADRs

- `ADR-0032-managed-governance-control-plane.md` — Accepted for `managed-shadow` implementation.
- ADR-0001 — Hexagonal boundary.
- ADR-0002/0003 — transactional CRUD and relational authority.
- ADR-0006/0007/0008 — standalone, compiler and project-local MCP boundaries.
- ADR-0022/0023/0024 — execution port, stateless MCP and runtime neutrality.
- ADR-0026/0027/0030/0031 — source, contracts, lifecycle and v3 compatibility.

## Design Exit Criteria

- Every FR maps to a component or task.
- No open specification question blocks implementation.
- PostgreSQL and Git have non-overlapping authority.
- The seed and ongoing import share one idempotent path.
- The console cannot bypass review or publication authority.
- Managed-enforced cannot activate while ADR-0032 is unaccepted.
