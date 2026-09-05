# Managed Governance Shadow Readiness — Verification

**Scope:** T01–T13, `managed-shadow` only. `managed-enforced` remains a reserved, unavailable,
no-side-effect wire value.
**Authority:** ADR-0032; Git remains the published governance authority. The database owns relational
managed state and evidence; it never becomes a second authority.
**Excluded activation:** `managed-enforced` is not available. The shared-network profile's approved
deployment CIDR (`192.168.5.0/24`) is deployment state configured by T13 after every gate in this
document passes — it is never a package default.

"Passing" means executable evidence exists in this repository and was re-run as part of T13. "Not
activated" identifies an operational capability this feature deliberately excludes; it is not a
waiver or a claim of production readiness.

## Functional requirements

| Requirement | Status | Primary evidence |
| --- | --- | --- |
| FR-001 | Passing | `release-publication.test.js`: `planGovernanceRelease` rejects a source commit that is not the active imported catalog and an organization with no active catalog |
| FR-002 | Passing | `release-publication.test.js`: `planGovernanceRelease produces a byte-identical manifest for the same input` |
| FR-003 | Passing | `release-publication.test.js`: `requestExternalSignature` passes only the digest and public binding to the signer, never the manifest; the signer's own key is never received or stored |
| FR-004 | Passing | `http.test.js`: `release query and snapshot verification are backed by real repository state, not stubs`; `snapshot.test.js`: fails closed for a missing release |
| FR-005 | Passing | `snapshot.test.js`: `promotion is atomic, private and digest-verified`; `corrupt, expired and identity-mismatched snapshots are never valid` |
| FR-006 | Passing | `conformance.test.js`: `HTTP, CLI and MCP expose the same decision semantics from the shared application result`; `mcp.test.js` |
| FR-007 | Passing | `repository-contract.test.js`, `postgres.integration.test.js`: commits domain state, audit and outbox atomically with optimistic concurrency |
| FR-008 | Passing | `patch-bundle.test.js`: `generatePatchBundle never touches git state`; `the generated patch is a real unified diff that git apply accepts` |
| FR-009 | Passing | `readiness.test.js`: `recordShadowReceipt derives receipt_id from identity, independent of digests or status`; contains no governed document body |
| FR-010 | Passing | `readiness.test.js`: `evaluateShadowReadiness reports ready when every day has conclusive evidence` |
| FR-011 | Passing | `readiness.test.js`: `missing days are explicit and block readiness even when the aggregate ratio looks fine`; `remote-unavailable receipts are recorded and reported but never count as coverage or equivalence` |
| FR-012 | Passing | `console.test.js`: readiness, review queue and publication request state are shown through the versioned HTTP API only |
| FR-013 | Passing | `http.test.js`: `health carries distinct migration and projection readiness without flattening state` |
| FR-014 | Passing | `security.test.js`: `audit and outbox payloads are bounded to identifiers, never the record content, no matter how large or secret-shaped that content is` |
| FR-015 | Passing | `recovery-rehearsal.test.js`: operates only on a confirmed disposable target; proves tenant isolation, active catalog, release-signature and append-only survival |
| FR-016 | Passing | `readiness.test.js`: `stale supporting evidence (signer, recovery, threat-model, rollback) blocks readiness independently`; `authorizes_enforcement: false` is a contract invariant asserted throughout |
| FR-017 | Passing | `conformance.test.js`: `reserved managed enforcement remains an unavailable no-side-effect state` |
| FR-018 | Passing | `session-preflight.test.js`: `session preflight reports an unconfigured project without network access`; migrations are forward-only (no rollback path exists to reverse), so disabling the binding restores portable behavior without touching migrations or evidence |
| FR-019 | Passing | `network-admission.test.js`: default profile is loopback; `installation.test.js`: `a fresh install with no network section still enforces loopback-only binding through the full composition` (T13, exercising the real composed server, not only the isolated primitive) |
| FR-020 | Passing | `network-admission.test.js`: `assertNetworkProfile forbids an incomplete listener`; `createManagedGovernanceServer refuses to construct at all on an invalid shared-network profile` |
| FR-021 | Passing | `network-admission.test.js`: `assertNetworkProfile forbids an empty allowlist and a wildcard allow-all entry` |
| FR-022 | Passing | `network-security.test.js`: `an admin-scoped route accepts only the admin token, never the query token -- scope confusion fails both ways` |
| FR-023 | Passing | `network-security.test.js`: `resolveClientAddress ignores a forwarded claim from an untrusted direct peer entirely`; `fails closed on an ambiguous multi-hop chain, even behind a trusted proxy` |
| FR-024 | Passing | `adapter-readiness.test.js`: `the portable bootstrap emits a receipt for an adapter with no native session-start event, before any task action`; coverage evaluated per adapter and remains advisory |

## Non-functional requirements

| Requirement | Status | Primary evidence |
| --- | --- | --- |
| NFR-001 — Security | Passing | `threat-model.md` (T12): 8-step threat model; all 11 mandatory adversarial cases cited by test; one High finding (direct-tls declared but unenforced) identified and closed in the same task. Zero Critical/High remains open |
| NFR-002 — Data isolation | Passing | `postgres.integration.test.js`: `database roles and immutable records are enforced by PostgreSQL`; `security.test.js`: cross-tenant reads scoped and denied, including a SQL-injection-shaped organization id |
| NFR-003 — Resilience | Passing | `client.test.js`: bounded timeout/retry/circuit-breaker/last-known-good; `conformance.test.js`: `a total control-plane outage with no cached snapshot leaves the local decision authoritative and unblocked` |
| NFR-004 — Integrity | Passing | `snapshot.test.js`: substitution, replay-of-expired, not-yet-effective and untrusted-signer rejection with canonical digests throughout |
| NFR-005 — Observability | Passing | `rate-limit.js`/`network-security.test.js`: bounded-cardinality tracked keys; `security.test.js`: audit/outbox payloads carry only identifiers |
| NFR-006 — Performance | Passing | `performance.test.js`: cached preflight ≤250ms p95, online resolution ≤2s p95, and (T13-relevant) session preflight's real entry point ≤500ms p95 |
| NFR-007 — Accessibility | Passing | `console.test.js`: `DOM smoke has landmarks, labels, keyboard focus, errors and reduced-motion support` |
| NFR-008 — Compatibility | Passing | Contract suites: every schema rejects unsupported versions and unknown fields; full portable suite remains green throughout T01–T13 |
| NFR-009 — Recoverability | Passing | `recovery-rehearsal.test.js`: `measured_rto_seconds` comes from operator-supplied timestamps, `measured_rpo_seconds` is measured independently by HSEOS; never claims a value the deployment did not supply |
| NFR-010 — Deployment neutrality | Passing | `configuration.js`: every secret field is an environment-variable reference; `installation.test.js` (T13): the approved deployment CIDR is exercised only as literal test input, never a package default; `test-package-surface.js`: no `.env`, `managed-governance.json`, key or `.hseos/state/**` file is ever published |
| NFR-011 — Observation completeness | Passing | `readiness.test.js`: `the window must be exactly 30 consecutive completed UTC days`; `a window where every session is remote-unavailable is never ready, regardless of every other flag` |

## Packed-install and LAN-deployment closure (T13)

- A real `npm pack` tarball, extracted (never the live checkout) and given its own `npm install`,
  ships no `.hseos/state`, no default `.env`, and no default `managed-governance.json`; the extracted
  CLI runs standalone and its fresh install plan never selects a managed profile on its own
  (`installation.test.js`, `test-package-surface.js`).
- The shared-network profile is reachable through the real installed path, not only through
  hand-built test servers: `composition.js` now wires `configuration.network` into
  `createManagedGovernanceServer`, including scoped authentication, rate limiting, trusted-proxy
  CIDRs and a network-access audit sink — this wiring did not exist before T13 and is itself part of
  this task's closure, not a pre-existing capability.
- The approved deployment CIDR (`192.168.5.0/24`) is proven, through that same real composition, to
  admit an allowlisted client and deny one outside the allowlist, and is proven directly against the
  admission primitive with realistic non-loopback addresses a local test socket cannot originate from
  (`installation.test.js`).
- The 30-day observation window begins only after every gate in this document passes for the target
  deployment: packed-install rehearsal, LAN admission proof, and a threat model with zero open
  Critical/High finding (T12). `docs/MANAGED-GOVERNANCE.md` documents this as an explicit operator
  checklist; HSEOS records no fabricated "observation started" evidence on the deployment's behalf —
  the first conclusive readiness evaluation for the deployment's own 30-day window is that record.

## Adversarial closure

The T12 threat model exercises CIDR edge addresses, IPv4-mapped IPv6, spoofed forwarding headers,
proxy-chain ambiguity, token scope confusion, rate-limit cardinality exhaustion, signature
substitution, snapshot replay, patch path traversal, cross-tenant reads and restore-target aliasing.
One High-severity finding (direct-tls declared in schema but never enforced in the running server)
was identified and closed within T12 itself. No Critical or High finding remains open. The
shared-network profile's transport, admission and authentication controls are proven independent:
success in one never bypasses another.
