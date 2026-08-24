# Policy: Federated Platform Capability Graph

**Status:** Canonical
**Version:** 1.0.0
**Effective:** 2026-08-24
**Scope:** All Hideaki repositories, projects, and agents
**Authority:** Enterprise Constitution §2.6; Platform Capability Governance Standard; ADR-0022

## Rule

Every repository that owns or consumes a shared capability MUST participate in the
versioned capability-graph federation. Before creating a local implementation, the actor
MUST query the graph and record one intake outcome: `consume`, `extend`, `promote`, or
`exception`.

## Canonical artifacts

- Root registry: `.enterprise/governance/capabilities/registry.yaml`
- Graph schemas: `.enterprise/governance/capabilities/schemas/`
- HSEOS-owned fragment: `.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml`
- Validator: `scripts/governance/validate-capability-graph.js`
- Repository fragments: `.platform/capability-graph.yaml` by default

Repository policy MAY select another fragment path, but the root registry MUST declare it.
All paths are repository-relative and MUST reject traversal outside the owning checkout.

## Federation protocol

The root registry pins a graph schema version and lists each fragment by stable ID,
repository ID, source path, revision policy, and enforcement mode. A fragment owns only the
nodes and edges declared by its repository. Cross-repository edges are declared by the
consumer and require evidence or an explicit derivation rule.

During migration, `report-only` is allowed only for a registry entry with an active,
expiring exception. New or changed capabilities are `enforced` immediately.

## Query and intake

The deterministic query surface MUST support exact lookup by node ID, node type, capability,
contract, package, module, project, owner, and lifecycle. Semantic retrieval augments exact
lookup but never replaces it.

An intake record MUST contain:

- need and scope;
- exact-query evidence;
- semantic-query evidence or an explicit `unavailable` result;
- selected outcome;
- governing capability/contract or proposed owner;
- conformance and graph-update plan;
- exception reference when applicable.

## Semantic discovery boundary

Semantic systems MAY emit only advisory findings with kind `CandidateEdge` or
`DriftFinding`. Each finding records model/index provenance, score, source entities, reason,
and review status. Findings never satisfy ownership, implementation, validation, exception,
or compatibility requirements.

Promotion requires a human-reviewed canonical graph change through Git. Direct writes from
FalkorDB, Qdrant, embedding jobs, agents, or dashboards to canonical fragments are forbidden.

## Enforcement

CI MUST fail on:

- invalid or unsupported schema versions;
- duplicate IDs or dangling edges;
- missing or multiple canonical owners;
- dependency cycles;
- missing tracked evidence;
- expired exceptions;
- paths escaping a repository root;
- canonical semantic auto-promotion;
- registry/fragment revision drift in enforced mode.

Repository reconciliation is progressively enforced. Legacy gaps require explicit,
time-bounded migration exceptions; environment flags are not exceptions.

## Projections

The validated graph MAY be projected into FalkorDB for traversal and Qdrant for semantic
discovery. Projection jobs MUST be reproducible from Git and safe to rebuild from scratch.
Projection state has no authority and must expose the source commit and schema version.

## Change management

Schema-breaking changes require a new schema version, migration guide, and ADR. Vocabulary
extensions require review by Platform Architecture Owners. Fragment changes follow the
owning repository's normal PR lifecycle and quality gates.

## References

- `.enterprise/.specs/constitution/Enterprise-Constitution.md` §2.6
- `.enterprise/.specs/core/Platform Capability Governance Standard.md`
- `.enterprise/.specs/decisions/ADR-0022-federated-platform-capability-graph.md`
- `.enterprise/policies/automated-validation.md`
