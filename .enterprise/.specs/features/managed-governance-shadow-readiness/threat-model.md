# Managed Governance Shadow Readiness — Threat Model

**Status:** Complete — no open Critical or High finding
**Specification:** `spec.md`
**Design:** `design.md` (Security Considerations)
**Task:** T12 — Execute adversarial threat and conformance validation
**Evaluated against:** `tools/managed-governance-control-plane`, `packages/managed-governance-client`,
`packages/managed-governance-contracts`, `tools/cli/lib/managed-governance`,
`tools/mcp-hseos-governance` as of this task's branch point (T11 merged, `origin/master`).

This document is the closed finding register `design.md` requires before the shared-network profile
may activate. It follows the mandatory structure: scope, trust boundaries, assets, the adversarial
case matrix, additional invariants validated beyond the mandatory list, the finding register, residual
risks/non-goals, and the sign-off gate.

## 1. Scope and Authority Boundary

In scope: the managed-governance control-plane sidecar (HTTP interface, network admission,
authentication, rate limiting), its application ports (policy evaluation, release publication,
shadow receipts, readiness evaluation, recovery rehearsal), its PostgreSQL and in-memory repository
adapters, the shared-network profile and transport-protection contract, the CLI/MCP/console adapters
that consume the same ports, and the session-preflight entry point every adapter's hook calls.

Out of scope: the authority of Git itself (Git remains the published governance authority; this
feature never moves that authority into the database), the correctness of an external signer's key
material (only the substitution/verification boundary at the signature evidence contract is in
scope), and `managed-enforced` mode's actual enforcement behavior (it remains a reserved,
unavailable, no-side-effect state for this feature — see §5).

## 2. Trust Boundaries

Per `design.md` §Security Considerations, six trust boundaries apply:

| # | Boundary | Description |
|---|----------|-------------|
| 1 | Git-to-release-planning | The release planner reads only committed, tagged Git state; it never trusts working-tree or staged content. |
| 2 | Core-to-external-signer | The core never holds a private signing key; only a signature/key reference crosses this boundary. |
| 3 | Network-to-sidecar | Any peer that can open a TCP connection to the sidecar's listener, before HTTP or TLS is established. |
| 4 | Browser-to-admin-API | The console's admin-scoped requests, including CSRF and same-origin exposure. |
| 5 | Sidecar-to-PostgreSQL | The repository adapter's SQL boundary — injection, tenant scoping, append-only evidence. |
| 6 | Outbox-to-telemetry | Audit events and outbox messages leaving the transactional boundary toward external consumers. |

## 3. Assets

- **Governance decisions and policy evaluation results** — must never be forged, replayed across
  tenants, or served stale without an honest degraded status.
- **Release signatures and manifests** — must never be substituted, reused across releases, or
  verified against the wrong published release.
- **Shadow receipts and readiness evidence** — must never be fabricated, double-counted, or allowed
  to count inconclusive evidence as coverage.
- **Bearer credentials (query/admin tokens), CSRF tokens** — must never cross scope, leak in logs,
  audit payloads, or outbox payloads, or be guessable via timing.
- **TLS private key material** (`direct-tls` transport) — must never be logged, must fail closed if
  missing or mismatched with its certificate.
- **Operational PostgreSQL data** — must never be mutated by a recovery rehearsal or a disposable
  restore-target check.
- **Tenant boundaries** (`organization_id`) — no read or write may cross from one organization's data
  into another's.

## 4. Adversarial Case Matrix

Every case `design.md` marks mandatory has a real, executing test. Citations are `file:line` for the
test name; each was independently re-run as part of this task (see §7 Verification).

| Adversarial case | Control | Test citation |
|---|---|---|
| CIDR edge addresses | `buildAllowlist`/`parseCidr` reject malformed CIDRs and fail closed on unparseable peers | `network-admission.test.js:41` (`parseCidr accepts valid IPv4 and IPv6 CIDRs and rejects malformed ones`), `network-admission.test.js:72` (`buildAllowlist fails closed on an unparseable peer address instead of throwing`) |
| IPv4-mapped IPv6 | `net.BlockList` canonicalizes `::ffff:a.b.c.d` against IPv4 rules; family isolation elsewhere | `network-admission.test.js:49` (`ipFamily classifies IPv4, IPv6 and IPv4-mapped IPv6 addresses, and rejects garbage`), `network-admission.test.js:57` (`buildAllowlist matches an IPv4 CIDR against the IPv4-mapped IPv6 form of the same address`), `network-admission.test.js:65` (family isolation), `network-admission.test.js:167` (mapped form reaches the real handler end to end) |
| Spoofed forwarding headers | Forwarding headers carry zero authority unless the direct TCP peer is itself a trusted proxy | `network-security.test.js:179` (`end to end: a spoofed X-Forwarded-For from an untrusted real peer never escapes its own rate-limit bucket`), `network-security.test.js:232` (`resolveClientAddress ignores a forwarded claim from an untrusted direct peer entirely`) |
| Proxy-chain ambiguity | Multi-hop `X-Forwarded-For` behind a trusted proxy fails closed instead of guessing which hop is real | `network-security.test.js:209` (`end to end: a multi-hop X-Forwarded-For behind a trusted proxy is denied outright, not guessed at`), `network-security.test.js:244` (`resolveClientAddress fails closed on an ambiguous multi-hop chain, even behind a trusted proxy`) |
| Token scope confusion | Query and admin tokens are mutually exclusive in both directions; CSRF issued only to admin scope | `network-security.test.js:47`, `network-security.test.js:61` (scope confusion fails both ways), `network-security.test.js:106` (CSRF only ever issued to admin scope) |
| Rate-limit cardinality exhaustion | Bounded-cardinality LRU eviction caps tracked keys regardless of distinct claimed identities | `network-security.test.js:259` (`createRateLimiter bounds tracked-key cardinality regardless of how many distinct keys are seen`) |
| Signature substitution | Recovery rehearsal and release verification compare against the exact operational published release, not merely "a" release | `recovery-rehearsal.test.js:283` (`release signature verification compares the disposable target against the operational published release`), `recovery-rehearsal.test.js:327` (unexpected published release fails verification) |
| Snapshot replay | Replayed commands are idempotent by identity and rejected on injected divergence; expired snapshot replay is rejected | `security.test.js:82` (tenant isolation and replay protection), `snapshot.test.js:154` (`verifyGovernanceSnapshot rejects replay of an expired release`) |
| Patch path traversal | Traversal, absolute paths and duplicate paths rejected before bundle generation; source/contract reads reject traversal and symlinks | `patch-bundle.test.js:178` (`generatePatchBundle rejects path traversal, absolute paths and duplicate paths`), `security.test.js:106` (`source and contract paths reject traversal, symbolic links and external content`) |
| Cross-tenant reads | Every repository read requires an explicit `organization_id` and is scoped by a composite key; a second tenant's data and a nonexistent tenant both return empty | `security.test.js:82` (asserts `listAuditEvents('tenant-a')`, `('tenant-b')` and `('tenant-missing')` each return exactly their own scoped count, plus a SQL-injection-shaped organization id is rejected) |
| Restore-target aliasing | A disposable restore target that aliases the operational connection identity (including loopback synonyms and default ports) is rejected before the inspector ever runs | `recovery-rehearsal.test.js:174` (`runRecoveryRehearsal rejects an operational-target alias before ever calling the inspector`), `recovery-rehearsal.test.js:206` (`connectionIdentity normalizes loopback hosts and default ports`) |

All eleven mandatory cases have a passing, independently re-run test. None were newly written by this
task except where noted in §6 (the TLS-enforcement gap required new tests because it required a code
fix).

## 5. Additional Invariants Validated

Beyond the mandatory list, this task added coverage `design.md`'s acceptance criteria require but
which had no single, direct test before T12:

- **Transport protection is actually enforced, not merely declared** (new in T12 — see §6 finding
  MGSR-T12-01). `security.test.js` (`a direct-tls shared-network profile actually wraps its listener
  in TLS, not merely declares it`, `direct-tls fails closed before any socket opens when the
  certificate or key is missing or invalid`, `terminated-upstream deliberately keeps this server on
  plain HTTP`).
- **Admission and authentication are independent controls; a valid credential never substitutes for
  network admission.** `security.test.js` (`a perfectly valid admin credential never substitutes for
  network admission -- the two controls are independent`).
- **Outbox and audit payloads are structurally bounded** to `{kind, record_id}` /
  `{audit_event_id, record_id}`, never the record body, regardless of what the record contains (large
  document bodies, secret-shaped strings). `security.test.js` (`audit and outbox payloads are bounded
  to identifiers, never the record content, no matter how large or secret-shaped that content is`).
- **Portable outage never blocks the local decision** (NFR-003). `conformance.test.js` (`a total
  control-plane outage with no cached snapshot leaves the local decision authoritative and
  unblocked`).
- **Managed enforcement remains an unavailable, no-side-effect state** (design.md's second failure
  axis, alongside portable outage). `conformance.test.js` (`reserved managed enforcement remains an
  unavailable no-side-effect state`).
- **Session preflight — the real entry point every adapter's hook calls, not just the lower-level
  client transport — meets the NFR-006 p95 budget.** `performance.test.js` (`session preflight stays
  below the 500 ms p95 budget on the reference fixture`).

## 6. Finding Register

| ID | Severity | Description | Status |
|---|---|---|---|
| MGSR-T12-01 | High | `ManagedNetworkProfileSchema`'s `transport.mode: 'direct-tls'` was validated structurally (T02 schema) but had no runtime effect: the sidecar always listened on plain HTTP regardless of declared transport mode. A `direct-tls`-configured shared-network deployment would have transmitted bearer tokens, CSRF tokens and response bodies in clear text. | **Closed.** `server.js` now resolves the certificate/private key from the environment variables the profile names (never a literal — NFR-010), validates the pair via `tls.createSecureContext` before any socket opens, and switches the listener to `https.createServer` for `direct-tls`. `terminated-upstream` is unchanged (TLS is deliberately terminated by an external reverse proxy for that mode). Verified by the three new tests cited in §5. |

No other Critical or High finding was identified. This satisfies the T12 constraint "No Critical/High
open" and the design-level gate: "The shared-network profile cannot activate while a Critical or High
threat-model finding is open."

## 7. Verification

Full command re-run after the MGSR-T12-01 fix and the new tests in this task:

```
node --test test/managed-governance/http.test.js test/managed-governance/network-admission.test.js \
  test/managed-governance/network-security.test.js test/managed-governance/console.test.js \
  test/managed-governance/security.test.js
node --test test/managed-governance/security.test.js test/managed-governance/conformance.test.js \
  test/managed-governance/performance.test.js
```

All suites passed with 0 failures. No test in this task issues a live mutation against an operational
database (constraint: "No live operational database mutation") and no shared-network listener was
started against a real interface outside of `127.0.0.1`/`::1` test sockets (constraint: "No network
activation").

## 8. Residual Risks and Non-Goals

- **`managed-enforced` mode's actual enforcement path is out of scope** for this feature; it remains
  a reserved, unavailable state by design (§5), not a partially-implemented control.
- **Multi-hop reverse-proxy topologies are explicitly unsupported** — the trusted-proxy resolver
  fails closed on any ambiguous chain rather than attempting best-effort hop selection. This is a
  deliberate scope boundary, not an open finding.
- **TLS certificate provisioning and rotation are an operational concern outside this feature** — the
  contract only guarantees the sidecar fails closed on a missing or invalid pair at construction
  time; issuing, renewing or distributing the certificate is a deployment-time (T13) responsibility.
- **This finding register reflects the code at T12's completion.** Any subsequent change to
  `tools/managed-governance-control-plane`, `packages/managed-governance-client`, or the network/
  authentication layer requires re-running the verification in §7 before the shared-network profile
  is considered still cleared.

## Sign-off Gate

- [x] All eleven mandatory adversarial cases have a passing, cited test.
- [x] Zero open Critical or High findings (one High finding was identified and closed within this
      task — MGSR-T12-01).
- [x] `p95 preflight budget passes` (acceptance criterion) — verified in `performance.test.js`.
- [x] `portable outage and enforcement-unavailable invariants pass` (acceptance criterion) — verified
      in `conformance.test.js`.
- [x] No live operational database mutation, no network activation (constraints) — verified in §7.

This threat model authorizes the shared-network profile to proceed to T13's LAN deployment
configuration, subject to the residual risks and non-goals in §8.
