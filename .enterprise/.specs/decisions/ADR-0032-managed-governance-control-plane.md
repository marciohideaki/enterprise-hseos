# ADR-0032: Managed Governance Control Plane with Signed Release Boundary

## Status

Accepted on 2026-09-01 by explicit human authorization for implementation in
`managed-shadow` mode. This approval does not authorize `managed-enforced`.

## Context

HSEOS publishes institutional governance as repository-owned files. This gives every installation a
portable, reviewable and recoverable authority, but it also makes organization-wide rollout,
assignment, drift detection, revocation, acceptance and lifecycle visibility depend on copies in
each consumer repository.

The current governance MCP reads local documents and exposes query tools. It does not own tenant,
binding, release, acceptance, lease or audit state. Session hooks do not provide a universal
blocking preflight across adapters. Using a live MCP-to-database query as the only source of policy
would therefore combine distribution, authority and enforcement in an adapter that ADR-0023 defines
as stateless.

The Constitution and ADR-0006/0026 currently make repository content the normative source. ADR-0003
requires mutable write-side state to be relational. ADR-0030 requires new operational surfaces to
declare lifecycle and authority. A managed control plane must satisfy all three boundaries without
silently changing the current v3 contract.

## Decision

HSEOS will add an optional managed governance bounded context with these authority boundaries:

1. Published Constitution, standards, policies, decisions and canonical catalogs remain normative
   in an institutional Git repository.
2. PostgreSQL is the relational source of truth for mutable control-plane state: organizations,
   repository bindings, imported catalog projections, drafts, reviews, publication requests,
   assignments, rollout, acceptance receipts, session leases, revocations, audit and outbox.
3. The current governance tree is imported through one deterministic, idempotent pipeline. The same
   pipeline performs initial seed and subsequent synchronization. It preserves exact source text,
   structured projection, source commit, path, section and digest.
4. Ambiguous content remains non-executable and enters a human review queue. Import cannot grant
   authority by interpreting prose heuristically.
5. An approved Git merge and tag are compiled into an immutable, content-addressed Governance
   Release. Signed releases and signed local snapshots are the distribution boundary.
6. CLI, hook, runtime and MCP adapters consume shared governance application and policy-decision
   ports. MCP remains stateless per request and exposes read-only governance tools in the first
   generation.
7. The administrative console is schema-driven. It authors PostgreSQL drafts, validates and
   simulates them, then produces a Git publication request. It cannot directly mutate published
   governance.
8. Modes are explicit: `portable`, `managed-shadow` and reserved `managed-enforced`. Portable remains
   the default. Shadow compares managed and local outcomes without changing authority.
9. `managed-enforced` activation requires a separate explicit activation record after threat-model,
   signature, adapter-conformance, offline and rollback gates pass. Merely accepting this ADR does
   not activate enforcement.
10. The managed client is an opt-in module; preflight is a pre-activation candidate; control plane
    and console are opt-in sidecars. The file governance reader remains an active portable
    compatibility surface throughout v3.

The first implementation may include contracts, migrations, importer, read-only query surfaces,
schema-driven drafting and shadow comparison. It must not remove or weaken existing portable
authority.

## Alternatives Considered

### PostgreSQL as the only normative content store

Rejected for the first generation because it conflicts with the current Constitution and
ADR-0006/0026, expands the control-plane blast radius and removes independent Git reconstruction
before operational evidence exists.

### Live PostgreSQL queries through MCP as authority

Rejected because MCP would become bootstrap, authority, distribution and enforcement at once;
non-MCP adapters would bypass it; policy could change during an operation; and loss of the service
would remove governance context.

### Continue copying governance into every repository

Rejected as the end state because it preserves rollout fragmentation, weak lifecycle visibility and
slow revocation. It remains the portable baseline and migration fallback.

### Central Git plus operational PostgreSQL and signed releases

Selected because it centralizes lifecycle and authoring while preserving reviewable normative
history, deterministic runtime inputs, offline snapshots and a reversible shadow migration.

## Consequences

### Positive

- Central catalog, authoring, rollout, acceptance, revocation and audit become structured.
- The current governance tree can seed the database without losing exact source provenance.
- Runtime decisions are pinned to immutable releases instead of mutable live rows.
- Portable mode remains usable without the control plane.
- MCP, CLI and hooks share decision semantics rather than implementing separate parsers.
- Console forms can cover rules, restrictions, patterns, stacks, standards and contracts through
  versioned schemas.

### Negative

- HSEOS gains a new PostgreSQL service, migration lifecycle, signer boundary and administrative UI.
- Two storage systems remain by design and require strict ownership boundaries.
- Import classification and semantic diff need ongoing conformance maintenance.
- Offline validity, key rotation, retention and disaster recovery become operational obligations.

### Risks and Mitigations

| Risk                                          | Mitigation                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Database or API compromise changes governance | Published authority requires Git workflow; runtime consumes signed immutable releases                 |
| Importer misclassifies prose                  | Preserve raw content; only deterministic structured sources become executable; review queue otherwise |
| Cross-tenant data exposure                    | `organization_id`, fail-closed RLS, separate roles and tenant isolation tests                         |
| Control-plane outage blocks work              | Portable default; shadow degrades to valid snapshot; enforced mode requires separate activation       |
| Adapter bypass                                | Per-adapter conformance and no enforced claim without blocking prelaunch evidence                     |
| Acceptance is confused with approval          | Separate contracts, scopes, reason codes and audit events                                             |
| Package surface expands baseline              | Opt-in module/sidecar classifications and package-surface tests                                       |
| Database and Git diverge                      | Source commit/digest, parity reports, immutable releases and reconciliation metrics                   |

## Affected Standards

| Standard or decision    | Section / rule                  | Change if accepted                                                             |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| Enterprise Constitution | Source and authority hierarchy  | Clarifies that managed published content remains Git normative                 |
| ADR-0001                | Hexagonal architecture          | Adds governance source, repository, query, command, signer and decision ports  |
| ADR-0003                | Relational write model          | Assigns mutable control-plane authority to PostgreSQL                          |
| ADR-0006                | Standalone and portable runtime | Adds an opt-in managed mode with portable fallback and local signed snapshot   |
| ADR-0007                | Compiler source adapters        | Adds a managed Governance Release source port                                  |
| ADR-0008                | Project-local MCP bundle        | Keeps project-local binding while allowing a configured remote service adapter |
| ADR-0023                | Stateless MCP adapter           | Confirms MCP is not governance state or enforcement authority                  |
| ADR-0026                | Canonical catalog source        | Preserves Git publication and adds relational import projection                |
| ADR-0027                | Explicit hooks/workflows        | Requires explicit preflight lifecycle and adapter capability                   |
| ADR-0030                | Surface lifecycle               | Classifies client, preflight, control plane, console and compatibility reader  |
| ADR-0031                | v3 migration boundary           | Makes shadow additive and reserves authority removal for a later major         |

## Mitigations

- Start with deterministic import and `managed-shadow` only.
- Keep all new surfaces opt-in and loopback-only by default.
- Require threat modeling before non-loopback or enforced activation.
- Require valid/invalid fixtures, PostgreSQL isolation tests and portable regression tests.
- Keep publication, merge and activation as distinct human decisions.
- Define explicit backup, restore, key rotation and revocation runbooks before production rollout.

## Compliance

- [x] Approved by explicit designated human authority on 2026-09-01 for `managed-shadow`
- [ ] Threat model reviewed with no critical or high finding open
- [ ] Affected standards updated to reference this ADR
- [ ] Managed surface lifecycle entries accepted
- [ ] Activation date recorded separately
- [ ] Review date set after the managed-shadow observation window

## References

- `.enterprise/.specs/features/managed-governance-control-plane/spec.md`
- `.enterprise/.specs/features/managed-governance-control-plane/design.md`
- `.enterprise/.specs/features/managed-governance-control-plane/tasks.md`
- `_pipeline/rfc-managed-governance-control-plane.md`
- `ADR-0001-hexagonal-architecture-mandatory.md`
- `ADR-0003-cqrs-with-relational-source-of-truth.md`
- `ADR-0006-standalone-architecture.md`
- `ADR-0008-mcp-project-local-bundle-policy.md`
- `ADR-0023-mcp-2026-stateless-adapter.md`
- `ADR-0026-canonical-capability-catalog-source.md`
- `ADR-0030-surface-lifecycle-contract.md`
- `ADR-0031-v3-contract-migration-boundary.md`
