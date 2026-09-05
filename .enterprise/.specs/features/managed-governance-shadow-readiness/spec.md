# Managed Governance Shadow Readiness — Feature Specification

**Status:** Specified — human decisions resolved on 2026-09-01
**Target:** first feature release after the v3.3.x correction line
**Authority posture:** `managed-shadow` only; repository governance remains authoritative
**Related decision:** ADR-0032

## Purpose

Complete the operational and release boundaries that turn the optional managed-governance control
plane from a validated local integration into an evidence-producing shadow service. The feature
must make release provenance, parity observation, draft publication handoff and recovery behavior
verifiable without activating managed enforcement or weakening the portable file path.

The v3.3.x line remains the correction line. The packaging/state-isolation correction is a patch
candidate; this specification describes the next feature line and does not change that patch's
scope.

## Scope

- Complete the database-backed Governance Release read model and the currently unavailable release
  lookup, release diff and snapshot-verification composition ports.
- Produce immutable, content-addressed release manifests from an approved Git commit and tag, with
  signature verification through operator-supplied key references.
- Persist and serve signed last-known-good shadow snapshots without storing signing secrets in the
  package, repository, browser or MCP configuration.
- Complete PostgreSQL-backed draft, review and publication-request application ports. Publication
  must end in a reviewable Git artifact or request; it must never merge or activate itself.
- Aggregate session-preflight and shadow-comparison receipts into bounded, tenant-isolated
  observation evidence suitable for a time-boxed readiness review.
- Add deployment-neutral health, metrics and structured audit export contracts for the control
  plane, importer, release verifier and session preflight.
- Add operator-verifiable backup/restore rehearsal contracts and runbook templates without claiming
  ownership of the PostgreSQL service.
- Add an opt-in authenticated shared-network profile with explicit bind address, deny-by-default
  client allowlist and separate administrative and read-only access policies.
- Define the evidence bundle and explicit human gates required before any later proposal may request
  `managed-enforced` activation.

## Out of Scope

- Activating, implementing or silently approximating `managed-enforced`.
- Treating PostgreSQL, MCP responses, drafts or unsigned snapshots as normative governance.
- Removing repository-owned Constitution, policies, standards, ADRs, skills or portable adapters.
- Public-Internet exposure, implicit LAN trust, an empty or wildcard client allowlist, and an
  HSEOS-owned production ingress profile.
- Installing or operating PostgreSQL, a secret manager, PKI, backup infrastructure, telemetry
  backend or Git hosting service.
- Holding private signing keys or database credentials in HSEOS-managed files.
- Automatically approving, merging, tagging, assigning or revoking published governance.
- Defining the separate major-version migration that could retire the v3 portable compatibility
  reader.

## Actors

- **Governance author:** creates and submits a structured draft.
- **Governance reviewer:** reviews drafts and explicitly requests publication.
- **Repository maintainer:** reviews and merges the generated Git publication artifact.
- **Release publisher:** creates and signs a Governance Release from an approved Git commit/tag.
- **Repository agent:** runs advisory session preflight and consumes read-only shadow decisions.
- **Platform operator:** supplies PostgreSQL, key references, process supervision, backup and
  telemetry integrations.
- **Auditor:** queries immutable provenance, parity, acceptance and recovery evidence.

## Functional Requirements

- **FR-001:** The system MUST materialize a Governance Release only from a repository identity,
  immutable Git commit and approved tag that pass the existing source and parity checks.
- **FR-002:** A Governance Release MUST bind every included artifact version, source path, content
  digest, schema version and minimum compatible runtime into one deterministic release digest.
- **FR-003:** The release publisher MUST attach a signature created outside HSEOS through an
  operator-supplied signing port; HSEOS MUST persist only the signature, algorithm and key reference.
- **FR-004:** Release lookup and diff MUST return versioned, tenant-isolated contracts from the
  PostgreSQL repository and MUST fail closed for missing, revoked or identity-mismatched releases.
- **FR-005:** Snapshot promotion MUST verify release signature, repository binding, release digest,
  validity interval and snapshot digest before atomically replacing the last-known-good snapshot.
- **FR-006:** MCP release and snapshot tools MUST remain read-only, stateless per request and backed
  by the same application ports used by CLI and HTTP adapters.
- **FR-007:** Draft create, update, submit, review and publication request MUST use optimistic
  concurrency, explicit actor context and one transactional audit/outbox boundary.
- **FR-008:** A publication request MUST produce a deterministic, reviewable Git change artifact and
  MUST stop before commit, push, pull request, merge, tag or activation unless each action receives
  its normal independent authorization.
- **FR-009:** Every session preflight MUST emit a bounded receipt containing repository identity,
  local and remote digests, release digest when available, status, reason code and timestamp without
  including governed document bodies or secrets.
- **FR-010:** The control plane MUST aggregate receipts by bounded technical dimensions and MUST
  expose exact counts for equivalent, drifted, unavailable, invalid-contract and unconfigured
  outcomes over a configurable observation window.
- **FR-011:** Observation evidence MUST distinguish missing samples from successful equivalence and
  MUST NOT infer readiness from sparse heartbeats.
- **FR-012:** The console MUST show release provenance, parity status, review queue, publication
  request state and observation coverage using the versioned HTTP API only.
- **FR-013:** Health MUST separately report database migration, catalog projection, release verifier,
  outbox and observation freshness states; a degraded component MUST NOT be reported as ready.
- **FR-014:** The system MUST export structured audit/outbox events through an opt-in adapter with
  bounded payload size, stable schemas and no secret or governance-body fields.
- **FR-015:** A backup/restore rehearsal command MUST validate configuration, operate only on an
  operator-supplied disposable target and produce evidence that tenant isolation, active catalog,
  release signatures and append-only audit history survived restoration.
- **FR-016:** The readiness report MUST enumerate threat-model status, adapter conformance, release
  signature coverage, parity coverage, recovery rehearsal and rollback evidence, and MUST remain
  non-authorizing.
- **FR-017:** `managed-enforced` MUST continue returning `enforcement_unavailable` before network,
  snapshot, database or policy effects.
- **FR-018:** Disabling the managed binding or sidecar MUST restore portable-only operation without
  reversing migrations or deleting managed evidence.
- **FR-019:** Portable and managed-shadow installations MUST bind to loopback unless an operator
  explicitly selects the shared-network profile.
- **FR-020:** The shared-network profile MUST require an explicit listen address, non-empty IP/CIDR
  client allowlist, authentication, transport-protection contract, bounded rate limits and audit.
- **FR-021:** Binding to all interfaces MUST fail closed unless every FR-020 control is valid; an empty,
  malformed or wildcard allowlist MUST never degrade to allow-all.
- **FR-022:** Administrative console mutations and read-only MCP/query traffic MUST have separate
  access-policy scopes, even when they use the same allowlisted source address.
- **FR-023:** A reverse proxy MUST be ignored as a source-identity authority unless its address and
  forwarding contract are explicitly trusted; untrusted forwarding headers MUST NOT affect access.
- **FR-024:** Every enabled adapter MUST emit a preflight receipt through either a native session-start
  event or the portable bootstrap before its first task action. Coverage MUST be calculated per
  adapter and MUST remain advisory in `managed-shadow`.

## Non-Functional Requirements

- **NFR-001 — Security:** Threat modeling MUST cover the signer boundary, tenant isolation, console
  authentication, network allowlist, trusted-proxy boundary, publication artifact handoff, snapshot
  substitution and observation poisoning. No Critical or High finding may remain open before the
  shared-network profile is activated.
- **NFR-002 — Data isolation:** Every new mutable tenant table MUST contain `organization_id`, enforce
  PostgreSQL RLS and pass cross-tenant denial tests using the runtime role.
- **NFR-003 — Resilience:** Online shadow queries MUST preserve the existing bounded timeout, retry,
  circuit-breaker and last-known-good behavior. Outage MUST degrade shadow evidence without blocking
  portable execution.
- **NFR-004 — Integrity:** Release, signature, snapshot and readiness evidence MUST use canonical
  serialization and cryptographic digests with substitution, replay, expiry and rollback tests.
- **NFR-005 — Observability:** Metrics and audit events MUST use bounded-cardinality identifiers and
  expose latency, failure, drift, freshness, outbox lag and recovery-rehearsal results without
  document bodies or secret values.
- **NFR-006 — Performance:** Session preflight latency MUST remain at or below 500 ms at p95 during
  the readiness window. Release lookup and every response MUST retain explicit latency and size
  budgets defined in design.
- **NFR-007 — Accessibility:** New console surfaces MUST preserve keyboard operation, visible focus,
  error summaries and WCAG 2.1 AA contrast requirements.
- **NFR-008 — Compatibility:** Portable mode and all existing v3 public contracts MUST remain
  backward compatible. Every new wire contract MUST be versioned and reject unknown versions.
- **NFR-009 — Recoverability:** Backup and restore remain operator-owned; HSEOS MUST verify evidence
  without claiming an RPO or RTO not supplied by the deployment profile.
- **NFR-010 — Deployment neutrality:** Secret fields MUST contain environment-variable or external
  key references only. Bind addresses, ports, tenant identifiers, allowed clients and operational
  targets MUST be explicit deployment configuration; none may be hard coded as package defaults for
  the current environment.
- **NFR-011 — Observation completeness:** Readiness MUST require 30 consecutive days, receipts from
  at least 95% of eligible sessions, daily evidence from every active repository and zero unresolved
  drift or invalid-contract outcome. Remote unavailability MUST NOT count as equivalence.

## Constraints

- Node.js `>=20`, PostgreSQL and the existing hexagonal application/repository ports.
- ADR-0032 keeps approved Git publication normative and `managed-shadow` observational.
- ADR-0023 keeps MCP stateless and outside mutable governance authority.
- ADR-0006 requires portable operation with no home-directory or external-vault dependency.
- ADR-0030 requires every new surface to declare lifecycle, authority and rollback.
- Heavy build, database, package, publish and rollout validation remains sequential by default.
- Shared-network access changes transport reachability only; it does not change governance authority.
- The current deployment intends to configure `192.168.5.0/24`; this value is deployment state and
  MUST NOT become a package default, fixture assumption or portable artifact requirement.

## Acceptance Evidence for the Feature

- PostgreSQL integration proves migrations, release publication, signature persistence, draft flow,
  receipt aggregation, RLS and transactional rollback on an ephemeral database.
- Contract and conformance suites prove identical semantics through application, CLI, HTTP and MCP
  adapters, including invalid and adversarial fixtures.
- A packed-install rehearsal proves the optional client and sidecar remain absent unless selected and
  that `.hseos/state/**` is absent from the package surface.
- Restore rehearsal proves the declared evidence set on a disposable database.
- Portable regression proves managed configuration and service outages never block local authority.
- A readiness report remains advisory and explicitly states that it cannot authorize enforcement or
  broaden its own network allowlist.
- Shared-network security tests prove default loopback, CIDR denial, authentication, scope separation,
  trusted-proxy handling, rate limiting and audit before the deployment enables its LAN profile.

## Resolved Decisions

1. Signing uses a plug-in external signer port. HSEOS never receives or stores the private key.
2. Readiness uses the NFR-006 and NFR-011 latency, duration, coverage and parity thresholds.
3. Each deployment owns and declares RPO, RTO, retention and the disposable restore target; HSEOS
   validates the declaration and evidence without operating the production database.
4. Publication initially emits only a deterministic patch bundle with manifest, changed files,
   digests, provenance, application instructions and rollback instructions.
5. This feature includes an opt-in authenticated shared-network profile under FR-019 through FR-023.
   Loopback remains the default and public-Internet exposure remains out of scope.
6. Every enabled adapter must provide evidence. Claude Code uses its native session-start hook;
   Codex and adapters without a native event use the portable pre-task bootstrap. Coverage is
   evaluated per adapter and remains advisory.

## Proposed Release Sequence

1. **v3.3.x correction:** isolate test runtime state and exclude `.hseos/state/**` from the package.
2. **Next feature release:** design and implement this resolved shadow-readiness specification.
3. **Observation gate:** run the approved evidence window with no authority change.
4. **Future decision:** evaluate a separate ADR for enforcement; successful shadow observation and
   authenticated LAN access do not imply enforcement authority.
