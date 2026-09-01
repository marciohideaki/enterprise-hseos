# Platform Capability Governance Standard

**Status:** Mandatory
**Version:** 1.1.0
**Effective:** 2026-08-24
**Scope:** All repositories, projects, modules, packages, contracts, and agents
**Authority:** Enterprise Constitution §2.6 and ADR-0033

## 1. Purpose

This standard makes Platform-First and Contract-First behavior executable. It defines the
minimum organizational model for discovering, owning, implementing, consuming, extending,
validating, and retiring shared capabilities without creating local competing truths.

## 2. Stable identifiers

Every graph entity and relationship MUST have an immutable, globally unique, lowercase
identifier. Renaming a display label MUST NOT change the identifier. Replacement uses a
`SUPERSEDES` edge and the deprecation lifecycle; identifiers are never recycled.

## 3. Canonical node types

The graph supports these canonical types:

`Capability`, `Contract`, `Package`, `ArtifactVersion`, `Repository`, `Project`, `Module`,
`Consumer`, `Adapter`, `Provider`, `PartnerApi`, `ErrorCatalog`, `Adr`, `Owner`, `Evidence`,
`TestSuite`, and `Exception`.

Every `Capability`, `Contract`, `Package`, `ArtifactVersion`, `Repository`, `Project`,
`Module`, `Adapter`, `Provider`, `PartnerApi`, `ErrorCatalog`, `Adr`, and `TestSuite` MUST
have exactly one canonical `OWNED_BY` edge. Shared stewardship is represented by an `Owner`
node that identifies the owning group, not by multiple ownership edges.

## 4. Canonical edge types

The graph supports `DEFINED_BY`, `OWNED_BY`, `IMPLEMENTED_BY`, `CONSUMED_BY`, `EXTENDED_BY`,
`VALIDATED_BY`, `PUBLISHED_AS`, `GOVERNED_BY`, `DEPENDS_ON`, `SUPERSEDES`, and `EXCEPTED_BY`.

Edges MUST reference existing nodes. `DEPENDS_ON` cycles are forbidden. Relationships that
cannot be derived directly from tracked repository structure MUST reference an `Evidence`
node.

Edge endpoints are typed: a capability is `DEFINED_BY` a contract or error catalog,
`IMPLEMENTED_BY` a package or module, `EXTENDED_BY` an adapter, and `CONSUMED_BY` a
consumer; `PUBLISHED_AS` links a package to an artifact version. `VALIDATED_BY` always
targets a test suite, `GOVERNED_BY` an ADR, and `EXCEPTED_BY` an exception.

`source-only`, local-path and local-tarball dependencies are compatibility evidence. They
MUST NOT carry `PUBLISHED_AS` or `CONSUMED_BY`. A `CONSUMED_BY` edge is valid only when the
consumer records `adoption_state=verified-install` plus the installed `ArtifactVersion`,
depends on the package, and that package publishes the same artifact version.

## 5. Lifecycle

Canonical lifecycle states are `proposed`, `available`, `deprecated`, and `retired`.

- `proposed`: discovery and contract design only; not consumable as a stable platform API.
- `available`: owner, contract or explicit exemption, implementation, and validation exist.
- `deprecated`: still consumable inside a declared migration window.
- `retired`: no new consumption; retained for audit and supersedence history.

An exception MUST declare owner, rationale, scope, expiry, and migration path. Expired
exceptions fail validation.

## 6. Federated ownership

`enterprise-hseos` owns the federation schema, root registry, constitutional directive, and
validator contract. Each repository owns the fragment describing the artifacts it controls.
The composed graph is canonical only when every included fragment passes deterministic
validation against its pinned schema version.

Existing catalogs MUST be migrated or represented by a governed adapter. Once a catalog is
declared superseded, it is a generated view and MUST NOT be edited as an independent source.

## 7. Mandatory intake

Before implementing a potentially shared concern, a human or agent MUST record:

1. exact lookup by identifier, contract, package, owner, and error catalog;
2. semantic discovery of adjacent or duplicate capabilities;
3. an outcome: `consume`, `extend`, `promote`, or `exception`;
4. the governing capability and contract when consuming or extending;
5. owner, neutral contract, projections, and conformance plan when promoting;
6. an approved exception when local duplication is unavoidable.

Lack of a semantic index does not authorize local implementation. Exact graph lookup and
the deterministic intake contract remain mandatory.

## 8. Validation

Authoritative validation MUST be fail-closed and verify schema conformance, global ID
uniqueness, referential integrity, ownership cardinality, dependency acyclicity, lifecycle,
evidence paths, exception expiry, and federation pinning.

Repository reconciliation compares graph claims to package manifests, imports, OpenAPI,
AsyncAPI, JSON Schema, module paths, and conformance tests. Material drift blocks changes to
the affected capability.

Semantic discovery is advisory. It may create reviewable `CandidateEdge` and `DriftFinding`
records but MUST NOT mutate canonical nodes or edges.

### 8.1 Portfolio reference corpus

Capability discovery MUST include the versioned portfolio reference corpus in
`.enterprise/governance/capabilities/reference-corpus.json`. Its mandatory product sentinels
are Poynt Hub, Cambio Real V3, LinkedOut, Cryptor, and SRM Asset. The corpus also includes
platform-core, backend-core, frontend-core, mobile-core, and design-system-core as contract
or projection sources.

Reference-corpus signals are candidate evidence only. A product sentinel never becomes a
canonical owner, package source, or verified consumer because a symbol, module, or semantic
match was found there. Promotion still requires intake, neutral contract, owner, repository
fragment, conformance evidence, and the applicable human gate. Adoption still requires a
published immutable artifact and verified installation.

Every corpus source MUST be pinned by full Git SHA and origin identity. Evidence paths MUST
be read from that Git object, not from an uncommitted working tree. Deterministic validation
MUST reject mutable revisions, path traversal, unknown capability IDs, false authority, and
incomplete combined coverage of the migration-view baseline.

## 9. Agent projection

Vendor-neutral agent instructions MUST point to the Constitution, this standard, the graph
policy, and the deterministic query/validation command. Tool-specific adapters are compiled
projections and MUST NOT maintain independent copies of this rule.

## 10. Evidence and compliance

A capability is not `available` solely because documentation or code exists. Availability
requires a versioned contract or approved exemption, an implementation surface, ownership,
and positive plus negative conformance evidence.

Violations require an ADR or a time-bounded exception. Silent local copies are
non-compliant.

## References

- Enterprise Constitution §§2.1, 2.5, 2.6, 5, 7-10, 13-14
- ADR-0016 Capability Packaging and Install Planning
- ADR-0033 Federated Platform Capability Graph and Platform-First Intake
- `.enterprise/policies/capability-graph.md`
- `.enterprise/policies/automated-validation.md`
