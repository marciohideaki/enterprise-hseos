# Managed Governance Shadow Readiness — Design

**Status:** Proposed for review
**Specification:** `spec.md`
**Authority:** ADR-0032; `managed-shadow` remains advisory

## Bounded Context

The existing managed-governance bounded context owns relational catalog projection, drafts,
publication requests, immutable releases, shadow receipts and audit/outbox evidence. Git remains the
published authority. MCP, CLI, HTTP, hooks and console remain adapters around shared application
ports; none receives direct database authority.

The feature extends the existing `tools/managed-governance-control-plane` sidecar and
`packages/managed-governance-contracts`. It does not create a second control plane or move managed
state into MCP.

## Architecture Approach

The implementation keeps the current hexagonal and CQRS boundaries:

```text
Git commit/tag ──> release planner ──> external signer port ──> release repository
                                              │
                                              └── signature/key reference only

session hook/bootstrap ──> preflight port ──> receipt repository ──> readiness projector

console/CLI ──> draft/review ports ──> PostgreSQL + audit/outbox ──> patch-bundle exporter

LAN client ──> network gate ──> authentication/scope gate ──> existing HTTP application ports
```

- Commands mutate through transactional application ports and emit audit/outbox facts atomically.
- Queries read immutable releases, catalog projections and aggregated receipts.
- Release and patch-bundle construction are deterministic pure planners before any write.
- Network admission is transport reachability only and cannot change governance policy outcomes.
- Offline operation consumes only a verified last-known-good snapshot and remains degraded shadow.

## Domain Model Changes

### Aggregates and value objects

- `GovernanceRelease`: immutable release manifest, Git provenance, runtime compatibility, digest,
  lifecycle and signatures.
- `ReleaseSignature`: algorithm, external key reference, signature and verification evidence; never a
  private key.
- `PatchPublicationBundle`: deterministic manifest, file operations, patch, digests, application and
  rollback instructions.
- `ShadowReceipt`: bounded session/preflight result keyed by organization, repository, adapter and
  observation time.
- `ReadinessWindow`: 30-day projection with session, repository and adapter coverage.
- `NetworkAdmissionPolicy`: profile, listen endpoint, allowed clients, trusted proxies, transport
  posture, authentication scopes and rate limits.
- `RecoveryRehearsal`: deployment-declared targets and measured restore evidence.

### Domain events

- `governance.release.published.v1`
- `governance.release.revoked.v1`
- `governance.patch_bundle.generated.v1`
- `governance.shadow_receipt.recorded.v1`
- `governance.readiness_evaluated.v1`
- `governance.network_access_denied.v1`
- `governance.recovery_rehearsed.v1`

Every event uses bounded identifiers and digests. Document bodies, bearer tokens, private keys,
database URLs and certificate material are forbidden.

## Application Ports

### Release ports

- `planGovernanceRelease(input, context)` produces a deterministic manifest from a verified commit
  and approved tag without persistence.
- `requestExternalSignature(digest, signerBinding, context)` passes only the digest and public binding
  metadata to an injected signer.
- `publishGovernanceRelease(manifest, signature, context)` verifies and persists atomically.
- `getGovernanceRelease(id, context)` and `diffGovernanceReleases(input, context)` replace the current
  unavailable production composition stubs.
- `verifyGovernanceSnapshot(snapshot, context)` verifies signature, binding, digest and validity.

### Publication ports

- `generatePatchBundle(publicationRequest, destination, context)` writes only to a new private
  destination supplied by the caller and refuses overwrite, links or repository-internal output.
- The result contains no commit, branch, push, pull request, merge, tag or activation operation.

### Receipt and readiness ports

- `recordShadowReceipt(receipt, context)` is idempotent by receipt ID and adapter/session identity.
- `evaluateShadowReadiness(query, context)` projects exact coverage and missing evidence.
- `runRecoveryRehearsal(profile, disposableTarget, context)` verifies a deployment-operated restore;
  it cannot accept the operational database as the target.

## Contract Design

All contracts are strict, versioned and added to `packages/managed-governance-contracts`:

- `GovernanceReleaseManifest/v1`
- `ExternalSignerBinding/v1`
- `ExternalSignatureEvidence/v1`
- `PatchPublicationBundleManifest/v1`
- `ShadowReceipt/v1`
- `ReadinessReport/v1`
- `ManagedNetworkProfile/v1`
- `RecoveryProfile/v1`
- `RecoveryRehearsalEvidence/v1`

Unknown versions and fields fail closed. Canonical JSON and SHA-256 remain the content-addressing
boundary. Signature algorithms are selected by an allowlisted signer adapter; the core contract does
not silently choose or downgrade an algorithm.

## Shared-Network Profile

### Configuration

Loopback remains the default. Shared-network access requires explicit selection:

```yaml
network:
  profile: shared-network
  listen_host: 192.168.5.70
  port: 4319
  allowed_clients:
    - 192.168.5.0/24
  trusted_proxies: []
  transport:
    mode: direct-tls
    certificate_ref_env: HSEOS_GOVERNANCE_TLS_CERTIFICATE
    private_key_ref_env: HSEOS_GOVERNANCE_TLS_PRIVATE_KEY
  authentication:
    query_token_env: HSEOS_GOVERNANCE_QUERY_TOKEN
    admin_token_env: HSEOS_GOVERNANCE_ADMIN_TOKEN
  rate_limits:
    query_requests_per_minute: 120
    admin_requests_per_minute: 30
```

The example CIDR is deployment input, not a default. `listen_host`, port, CIDRs, token environment
names and transport references are explicit. Secret values are resolved only at process start and
never serialized.

### Admission sequence

1. Validate the complete configuration before opening a socket.
2. Reject shared-network mode when `allowed_clients` is empty, contains an allow-all network, has
   invalid CIDR, or transport/authentication is incomplete.
3. Derive the peer from the socket. Forwarding headers have no authority unless the direct peer is in
   `trusted_proxies`; ambiguous forwarding chains fail closed.
4. Match the canonical peer address against the allowlist.
5. Apply bounded per-peer and per-scope rate limits.
6. Authenticate with the query or admin credential and authorize the route scope.
7. Append a bounded access audit fact, then invoke the existing HTTP application port.

Binding to `0.0.0.0` is accepted only after the same complete validation. It never weakens allowlist
or authentication. The database port is never exposed.

### Browser boundary

- Console assets and API remain same-origin.
- Wildcard CORS is forbidden.
- State-changing routes require admin scope and an anti-CSRF request token bound to the authenticated
  browser session.
- Security headers remain strict; host and origin are validated against configured public origins.

## Data Model

Forward-only migrations add tenant-scoped tables:

- `release_publication_attempts`
- `patch_publication_bundles`
- `shadow_receipts`
- `readiness_evaluations`
- `recovery_rehearsals`
- `network_access_audit`

Every table contains `organization_id`, enables and forces RLS, has bounded unique/idempotency keys
and forbids destructive application-role updates to immutable evidence. Raw IP addresses are retained
only when the deployment retention profile explicitly permits them; otherwise audit uses a keyed,
rotatable pseudonymous client identifier plus the matched allowlist rule ID.

## Integration Points

- Git source adapter supplies immutable commit/tag bytes and repository identity.
- External signer adapter owns private-key access and returns signature evidence.
- PostgreSQL repository owns mutable managed state and immutable evidence.
- Existing governance MCP exposes read-only release, snapshot and readiness queries.
- Session hooks and portable CLI bootstrap emit the same receipt contract.
- Outbox exporter integrates with operator telemetry without making it required for portable mode.
- Process supervisor or reverse proxy may terminate transport only through an explicit trusted
  deployment profile.

## Adapter Evidence

- Claude Code emits through its native session-start hook.
- Codex runs the portable bootstrap before the first task action.
- Other adapters declare either a native start event or the portable bootstrap capability.
- Readiness is calculated independently per enabled adapter. Missing adapter evidence cannot be
  relabeled as equivalence and does not block a session in shadow mode.

## Readiness Algorithm

A report is ready only when all are true:

- the window contains 30 consecutive completed UTC days;
- at least 95% of eligible sessions have valid receipts;
- every active repository has evidence on every active day;
- every enabled adapter meets its coverage requirement;
- preflight p95 is at most 500 ms;
- no unresolved drift or invalid-contract outcome exists;
- remote-unavailable samples are reported and never counted as equivalent;
- signer, recovery, threat-model and rollback evidence are current.

The report contains `authorizes_enforcement: false` as a contract invariant.

## Security Considerations

Trust boundaries are Git-to-release planning, core-to-external signer, network-to-sidecar,
browser-to-admin API, sidecar-to-PostgreSQL and outbox-to-telemetry. Mandatory adversarial cases
include CIDR edge addresses, IPv4-mapped IPv6, spoofed forwarding headers, proxy-chain ambiguity,
token scope confusion, rate-limit cardinality exhaustion, signature substitution, snapshot replay,
patch path traversal, cross-tenant reads and restore-target aliasing.

The shared-network profile cannot activate while a Critical or High threat-model finding is open.
Authentication, allowlisting and transport protection are independent controls; success in one never
bypasses another.

## Observability Plan

- Counters: admission allow/deny by bounded reason, authentication failures, drift outcomes, receipt
  coverage, signer results, outbox backlog and recovery outcomes.
- Histograms: preflight, release verification, database and signer latency.
- Gauges: observation freshness, active repositories/adapters and outbox lag.
- Traces: correlation IDs across adapter, application port, database and external signer without
  content bodies or secret-bearing attributes.
- Audit: append-only actor, route scope, matched allowlist rule, outcome and evidence digest.

## Recovery and Rollback

The deployment profile declares RPO, RTO and retention. HSEOS verifies those values and measures a
restore rehearsal against a disposable target. It never invokes restore against the operational
database. Rollback disables the network profile, managed binding or sidecar and returns to portable
authority without reversing migrations or deleting evidence.

## ADR Impact

- ADR-0032 requires an amendment because this feature admits authenticated non-loopback shadow access
  while preserving the same authority boundary.
- ADR-0030 surface lifecycle must add the shared-network profile as opt-in and reversible.
- No ADR may mark `managed-enforced` active as part of this feature.

## Implementation Sequence

1. Amend ADR/surface lifecycle and add strict contracts.
2. Implement release repository, external signer port and snapshot verification.
3. Implement patch-bundle planner/exporter.
4. Implement receipts, readiness projection and recovery evidence.
5. Implement network configuration and admission gate before changing server binding behavior.
6. Add scoped authentication, browser protections, audit and telemetry.
7. Add CLI/MCP/console surfaces and adapter bootstrap evidence.
8. Execute threat model, PostgreSQL, package, adversarial network and packed-install validation.
9. Configure `192.168.5.0/24` only in the target deployment after all activation gates pass.

## Design Exit Criteria

- Every specification requirement maps to an application port, contract or validation stage.
- Network exposure remains deny-by-default and cannot widen governance authority.
- The package contains no environment-specific host, CIDR, credential or topology default.
- All database writes preserve RLS, idempotency, audit and outbox atomicity.
- Tasks can be decomposed into isolated, independently verifiable units.
