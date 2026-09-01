# Managed Governance Verification Matrix

**Scope:** First delivery approved for `managed-shadow` on 2026-09-01  
**Authority:** Repository-owned governance remains authoritative  
**Excluded activation:** The reserved enforcement mode is not available

“Passing” means executable evidence exists in the repository. “Not activated” identifies an
operational capability deliberately excluded from this delivery; it is not a waiver or a claim of
production readiness.

## Functional requirements

| Requirement | Status | Primary evidence |
| --- | --- | --- |
| FR-001 | Passing | `contracts.test.js`: schema version, strict semantics and identifier rejection |
| FR-002 | Passing | `contracts.test.js`: artifact/version identity, lifecycle, digest, provenance and content |
| FR-003 | Passing | `contracts.test.js`: closed artifact type catalog |
| FR-004 | Passing | `import-plan.test.js`, `import-apply.test.js`: raw and structured content retained separately |
| FR-005 | Passing | `contracts.test.js`: closed relation kinds and explicit endpoints |
| FR-006 | Passing | `contracts.test.js`, `policy-resolution.test.js`: executable rule structure |
| FR-007 | Passing | `policy-resolution.test.js`: same-precedence conflicts fail closed |
| FR-008 | Passing | `import-plan.test.js`, `security.test.js`: allowlist, traversal, symlink and special-file rejection |
| FR-009 | Passing | `import-plan.test.js`: normalized SHA-256 and commit-pinned batch identity |
| FR-010 | Passing | `import-apply.test.js`, `seed-current-governance.test.js`: unchanged retry is a no-op |
| FR-011 | Passing | `import-apply.test.js`: immutable version history for changed content |
| FR-012 | Passing | `import-plan.test.js`: deletion/rename actions are explicit and non-destructive |
| FR-013 | Passing | `import-plan.test.js`: ambiguous content remains review-only and non-executable |
| FR-014 | Passing | `import-apply.test.js`, `postgres.integration.test.js`: plan/apply/rollback and parity report |
| FR-015 | Passing | `seed-current-governance.test.js`: all canonical governance families are seeded without source writes |
| FR-016 | Passing | `console.test.js`: versioned schemas and bounded validation for supported draft types |
| FR-017 | Not activated | Draft lifecycle port exists, but no production draft-store composition is active |
| FR-018 | Passing | `console.test.js`: raw/structured/provenance/issues/diff views are present |
| FR-019 | Passing | `policy-resolution.test.js`, `http.test.js`: pure policy preview without assignment mutation |
| FR-020 | Not activated | Authenticated publication port is tested; durable human workflow composition is not active |
| FR-021 | Passing | `http.test.js`, `console.test.js`: publication request surface has no push or merge operation |
| FR-022 | Passing | `client.test.js`: binding is proven against `repository-contract/v1` identity |
| FR-023 | Passing | `conformance.test.js`, `client.test.js`: portable/shadow supported; enforcement returns unavailable |
| FR-024 | Passing | `conformance.test.js`: HTTP, CLI and MCP preserve one application decision |
| FR-025 | Passing | `mcp.test.js`: request-local adapter and read-only tool catalog |
| FR-026 | Passing | `shadow-parity.test.js`, `client.test.js`: parity cannot change local outcome |
| FR-027 | Passing | `snapshot.test.js`, `client.test.js`: digest-pinned cache and non-blocking degradation |
| FR-028 | Passing | `repository-contract.test.js`, `postgres.integration.test.js`: mutation/audit/outbox atomicity |
| FR-029 | Passing | `repository-contract.test.js` and migration `0003`: scoped actor/action/aggregate/correlation/causation/time and bounded metadata |
| FR-030 | Passing | `repository-contract.test.js`, `postgres.integration.test.js`: ordered immutable migrations |
| FR-031 | Passing | `test-capability-catalog.js`: opt-in module, candidate preflight and sidecar classifications |
| FR-032 | Passing | Full enforced quality gates include the portable suite with no managed profile selected |
| FR-033 | Passing | `installation.test.js`: strict project configuration resolves credentials only through named environment variables |
| FR-034 | Passing | `installation.test.js`, `postgres.integration.test.js`: setup orders migration, role grant, seed and binding generation |
| FR-035 | Passing | `installation.test.js`: setup writes stable binding and query configuration artifacts with private permissions |
| FR-036 | Passing | `installation.test.js`, `composition.js`: setup and server share one strict configuration loader |
| FR-037 | Passing | `installation.test.js`, `http.test.js`: database-backed health and catalog projections are served through HTTP |
| FR-038 | Passing | `docs/MANAGED-GOVERNANCE.md` and `docs/pt-br/governanca-gerenciada.md`: reproducible end-to-end validation procedure |

## Non-functional requirements

| Requirement | Status | Primary evidence |
| --- | --- | --- |
| NFR-001 | Passing | Repository port contract; browser/MCP surfaces have no database credentials |
| NFR-002 | Passing | `postgres.integration.test.js`: tenant columns and fail-closed RLS |
| NFR-003 | Passing | `client.test.js`, `snapshot.test.js`, package-surface tests: secret values rejected/excluded |
| NFR-004 | Passing | `contracts.test.js`, `http.test.js`, `security.test.js`: bounded content, rules, collections and I/O |
| NFR-005 | Not activated | Production personal-data profile and retention schedule require separate approval; `docs/MANAGED-GOVERNANCE.md` records the boundary |
| NFR-006 | Passing | `contracts.test.js` valid/invalid fixtures and strict versioned schemas |
| NFR-007 | Passing | Portable full suite plus `mcp.test.js` response compatibility |
| NFR-008 | Passing | `import-plan.test.js` deterministic canonical plan on supported Node versions |
| NFR-009 | Passing | `client.test.js`: timeout, bounded retry/jitter and typed circuit outcomes |
| NFR-010 | Passing | `performance.test.js`: cached and online p95 reference budgets |
| NFR-011 | Passing | `repository-contract.test.js`, `security.test.js`, `postgres.integration.test.js`: transactions and replay protection |
| NFR-012 | Passing | `postgres.integration.test.js`: failed import retains prior active catalog |
| NFR-013 | Not activated | Production structured-log integration is required before deployment; local shell makes no readiness claim |
| NFR-014 | Not activated | Production metrics exporter is outside the unactivated sidecar composition and remains an activation prerequisite |
| NFR-015 | Passing | `http.test.js`: health distinguishes migration/projection readiness and never flattens non-green state |
| NFR-016 | Passing | Unit/contract suites use memory ports; PostgreSQL suite is configuration-gated |
| NFR-017 | Not activated | Migration/seed/rollback are executable; production backup/restore awaits an approved database profile and runbook |
| NFR-018 | Passing | `security.test.js`, `cli.test.js`, `server.js`: loopback-only binding |
| NFR-019 | Passing | `installation.test.js`, `test-package-surface.js`: no deployment-specific host, database, organization or credential is distributed |
| NFR-020 | Passing | `installation.test.js`: generated files are private, deterministic and contain no resolved secret value |
| NFR-021 | Passing | `configuration.js`, capability catalog tests: PostgreSQL is operator-supplied and the sidecar remains opt-in |
| NFR-022 | Passing | `installation.test.js`, `postgres.integration.test.js`: repeated setup and migration are idempotent |

## Adversarial closure

The final review exercises tenant separation, idempotency replay and conflict, path traversal,
symbolic-link escape, identifier/SQL-shaped input, malformed and oversized HTTP input, response and
snapshot bounds, endpoint restrictions, timeouts, circuit degradation and unavailable enforcement.
No critical or high-severity exploitable finding remains in the activated `managed-shadow` scope.
A formal threat model is still required by ADR-0032 before any non-loopback or enforcement proposal.
