# Managed Governance Control Plane — Feature Specification

**Status:** Approved for `managed-shadow` implementation on 2026-09-01
**Owner:** Platform Governance
**Date:** 2026-09-01
**Related RFC:** `_pipeline/rfc-managed-governance-control-plane.md`
**Decision gate:** Satisfied by explicit human acceptance of ADR-0032 on 2026-09-01

## Purpose

Provide an optional HSEOS governance control plane that imports the current institutional
governance into a structured relational catalog, supports schema-driven authoring and review, and
distributes deterministic governance releases without making a live database or MCP server the sole
enforcement authority.

The first delivery proves structured catalog parity and managed-shadow operation. Git remains the
normative source for published governance, while PostgreSQL owns mutable control-plane state.

## Scope

The first delivery includes:

- versioned contracts for governance artifacts, rules, bindings, releases, snapshots, decisions,
  acceptance receipts and session leases;
- a PostgreSQL schema for organizations, repositories, artifacts, versions, relations, rules,
  drafts, reviews, releases, assignments, audit events and outbox messages;
- an idempotent importer that seeds the catalog from the current `.enterprise/` governance tree;
- preservation of source content, source path, commit, section, digest and import batch;
- explicit review queues for content that cannot be structured deterministically;
- a read-only governance application port and HTTP/CLI adapters;
- a schema-driven administrative console for artifact, rule, restriction, pattern, stack profile,
  standard and contract drafts;
- semantic and textual diff, validation and preview before publication;
- a publication-request workflow that produces a reviewable Git change rather than mutating
  published authority directly;
- managed-shadow bindings and parity reporting;
- audit and outbox records for every control-plane mutation;
- migration, seed, rollback and conformance tests.

## Out of Scope

The first delivery does not:

- replace Git as the normative source for published governance;
- mark ADR-0032 as accepted or activate it without human approval;
- enable `managed-enforced` for any adapter;
- remove local governance files or the portable compatibility reader;
- expose PostgreSQL directly to agents, browsers or MCP tools;
- permit MCP runtime tools to mutate governance;
- implement automatic interpretation of ambiguous prose as executable policy;
- implement production identity federation, KMS/HSM custody or multi-region disaster recovery;
- migrate execution-ledger tables into the governance database;
- provide a breaking replacement for the current five governance MCP tools.

## Actors

| Actor             | Responsibility                                                      |
| ----------------- | ------------------------------------------------------------------- |
| Governance author | Creates and edits drafts through schema-driven forms                |
| Reviewer          | Reviews content, structured projection and semantic diff            |
| Approver          | Authorizes a publication request; never implicit                    |
| Operator          | Assigns a published release to a shadow cohort                      |
| Auditor           | Reads provenance, decisions, acceptance and audit history           |
| HSEOS importer    | Imports canonical Git sources idempotently                          |
| Governance client | Resolves a binding and reads a signed or local shadow snapshot      |
| MCP adapter       | Projects read-only governance queries through the application port  |
| Portable runtime  | Continues using local compiled governance without the control plane |

## Functional Requirements

### Contracts and catalog

- **FR-001:** The system MUST reject governance contracts with an unsupported `schema_version`,
  unknown required semantics or invalid identifiers.
- **FR-002:** The system MUST represent each governance artifact with a stable ID, closed type,
  lifecycle status, version, content digest, source provenance and structured content.
- **FR-003:** The system MUST initially support `constitution`, `standard`, `policy`, `rule`,
  `restriction`, `pattern`, `stack-profile`, `contract`, `schema`, `adr`, `authority`, `capability`,
  `hook`, `workflow`, `skill`, `exception` and `unclassified` artifact types.
- **FR-004:** The system MUST preserve the exact source text independently from its structured
  projection.
- **FR-005:** The system MUST represent relations including `contains`, `implements`, `constrains`,
  `supersedes`, `references`, `applies-to` and `conflicts-with` without embedding relational foreign
  keys in free-form content.
- **FR-006:** The system MUST represent executable rules with subject, action, resource, scope,
  conditions, effect, priority, obligations, enforcement points and normative source.
- **FR-007:** The system MUST fail closed when two effective rules at the same precedence conflict.

### Import and seed

- **FR-008:** The importer MUST discover only allowlisted canonical roots and MUST reject paths
  outside the repository root or through symbolic-link escape.
- **FR-009:** The importer MUST calculate deterministic SHA-256 digests from normalized bytes and
  MUST identify a batch by repository ID, source commit and importer version.
- **FR-010:** Re-running an unchanged import batch MUST create no new artifact versions, rules or
  relations.
- **FR-011:** A changed source MUST create an immutable artifact version and MUST retain the previous
  version.
- **FR-012:** Deleted or renamed sources MUST be reported explicitly and MUST NOT be hard-deleted by
  the importer.
- **FR-013:** Ambiguous or unsupported content MUST be stored as `unclassified`, linked to its source
  and placed in a review queue; it MUST NOT become an executable rule automatically.
- **FR-014:** The importer MUST support `plan`, `apply` and `rollback-batch` operations and MUST emit
  a machine-readable parity report.
- **FR-015:** The initial seed MUST cover the current Constitution, standards, policies, ADRs,
  capabilities, hooks, workflows and skills without writing to their source files.

### Authoring and publication

- **FR-016:** The console MUST derive forms from versioned schemas for every supported authoring
  type and MUST validate drafts before submission.
- **FR-017:** A draft MUST remain non-normative until a publication request is approved and merged
  through the institutional Git workflow.
- **FR-018:** The console MUST display raw content, structured content, provenance, validation
  issues and textual/semantic diff.
- **FR-019:** The policy preview MUST resolve the effective rule set for organization, repository,
  environment, branch, actor and capability without persisting an assignment.
- **FR-020:** Publication MUST require an authenticated human decision and MUST record author,
  reviewer, approver, source version, resulting commit and release digest.
- **FR-021:** The first delivery MUST generate a publication request artifact or patch; it MUST NOT
  push or merge Git changes automatically.

### Managed shadow and adapters

- **FR-022:** A managed binding MUST reference, but MUST NOT replace, `repository-contract/v1`.
- **FR-023:** The system MUST expose `portable` and `managed-shadow` modes; `managed-enforced` MUST
  parse as a reserved value but MUST fail activation while ADR-0032 lacks an accepted activation
  record.
- **FR-024:** CLI, HTTP and MCP read paths MUST use the same governance query and decision ports.
- **FR-025:** The MCP adapter MUST remain stateless per request and MUST expose no administrative
  mutation tools in the first delivery.
- **FR-026:** The managed-shadow resolver MUST compare local and catalog-derived decisions and MUST
  record parity without changing the local outcome.
- **FR-027:** A session MUST be pinnable to a release digest, but shadow mode MUST NOT block the first
  prompt because of control-plane unavailability.

### Audit and lifecycle

- **FR-028:** Every mutation MUST append an audit event and an outbox message in the same database
  transaction as the mutation.
- **FR-029:** Audit events MUST include organization, actor reference, action, target, correlation,
  causation, timestamp and redacted metadata.
- **FR-030:** The system MUST support additive database migrations and MUST never edit an applied
  migration.
- **FR-031:** The system MUST classify the managed client as an opt-in module, preflight as a
  candidate, and control plane and console as opt-in sidecars.
- **FR-032:** The portable governance path MUST pass its existing conformance suite with the managed
  feature disabled.

## Non-Functional Requirements

### Security and privacy

- **NFR-001:** Per Security & Identity Standard, all database access MUST be through an application
  port with least privilege; direct browser, agent and MCP database credentials are forbidden.
- **NFR-002:** PostgreSQL tenant tables MUST carry `organization_id` and enforce fail-closed row-level
  security in production profiles.
- **NFR-003:** Bindings, snapshots, logs and audit metadata MUST contain secret references only, never
  secret values or bearer credentials.
- **NFR-004:** Content size, recursion depth, relation count and rule complexity MUST be bounded before
  persistence or evaluation.
- **NFR-005:** Personal identifiers in audit data MUST be pseudonymous where possible and governed by
  an explicit retention policy under the Data Governance & LGPD Standard.

### Contracts and compatibility

- **NFR-006:** Per Data Contracts & Schema Evolution Standard DC-01–DC-16 and DC-34–DC-49, contract
  evolution MUST be additive-first, versioned and covered by valid/invalid fixtures.
- **NFR-007:** The control plane MUST preserve v3 portable behavior and current MCP tool responses
  while managed mode is disabled.
- **NFR-008:** Deterministic re-import of the same commit MUST produce identical canonical JSON and
  digests on Node.js 20 and later.

### Resilience and performance

- **NFR-009:** Per Resilience Patterns Standard RP-08–RP-25, external calls MUST have configurable
  timeouts, bounded retry with jitter for idempotent reads and typed circuit-breaker outcomes.
- **NFR-010:** Cached shadow preflight MUST complete at p95 <= 250 ms and online shadow resolution at
  p95 <= 2 s under the reference dataset.
- **NFR-011:** Database writes MUST use idempotency keys and transactions; retrying an import or
  publication request MUST not duplicate state.
- **NFR-012:** A failed import MUST leave the previously completed catalog batch queryable.

### Observability

- **NFR-013:** Per Observability Playbook, structured logs MUST include service, environment,
  correlation ID, trace ID when present and operation, with content and subject data redacted.
- **NFR-014:** Metrics MUST cover import duration/results, validation failures, unclassified count,
  parity mismatch, query latency, database errors, outbox backlog and publication lifecycle.
- **NFR-015:** Health MUST be non-green when migrations are pending, outbox lag exceeds threshold or
  the active catalog projection is incomplete.

### Testability and operations

- **NFR-016:** Unit and contract tests MUST run without a database using ports/fakes; PostgreSQL
  integration tests MUST run against an ephemeral database when configured.
- **NFR-017:** Seed, migration, rollback and restore procedures MUST be executable through documented
  non-interactive commands.
- **NFR-018:** The control plane MUST bind to loopback by default and require an explicit secure
  profile for non-loopback exposure.

## Constraints

- Node.js >=20 and CommonJS compatibility with the current repository.
- Zod is the runtime validation library for public JavaScript contracts.
- PostgreSQL is the managed operational store; SQLite remains the project-local operational store
  for existing HSEOS state.
- The control-plane bounded context MUST NOT share tables with the governed execution ledger.
- Git remains normative for published governance during this feature generation.
- `.enterprise/` remains the canonical repository source; `.agents/` remains compiler output.
- No runtime asset may depend on global home directories or external vault paths.
- All implementation work uses isolated task worktrees and one task per commit.

## Resolved Decisions for the First Delivery

| Topic                | Decision                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Normative repository | This repository's `.enterprise/` tree is the seed source and reference implementation                                       |
| Deployment topology  | Implement contracts and client in this repository; control-plane service and console remain separate deployable surfaces    |
| Authoring authority  | Drafts live in PostgreSQL; publication produces a Git review artifact                                                       |
| Role separation      | Roles are explicit; a single-maintainer profile may assign multiple roles but every transition remains explicit and audited |
| Signature custody    | Define a signer port and test signer only; production KMS/HSM integration is deferred                                       |
| Offline policy       | Shadow reads may use a 24-hour last-known-good snapshot; managed mutations are unavailable offline                          |
| Acceptance scope     | Subject + repository + release digest                                                                                       |
| Audit retention      | Configurable; reference profile uses 365 days, without implementing destructive purge in this delivery                      |
| Adapter activation   | Shadow only; no adapter may claim enforced support                                                                          |
| Revocation objective | Assignment/revocation propagation target <= 5 minutes in the reference profile                                              |

## Open Questions

None block design. Production identity provider, key custodian, regional topology and final retention
period remain deployment decisions outside this delivery and are represented by explicit ports or
configuration.

## Acceptance Summary

The feature generation is complete only when every FR and NFR above has direct test or operational
evidence, the current portable suite remains green, the managed surfaces remain opt-in, and no
authority change is activated without an accepted ADR and explicit human approval.
