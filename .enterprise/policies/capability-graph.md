# Policy: Federated Platform Capability Graph

**Status:** Canonical
**Version:** 1.1.0
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
- Discovery-only reference corpus: `.enterprise/governance/capabilities/reference-corpus.json`
- Reference corpus validator: `scripts/governance/validate-capability-reference-corpus.js`
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

Before broad repository search, discovery MUST query the pinned portfolio corpus. The five
mandatory product sentinels are Poynt Hub, Cambio Real V3, LinkedOut, Cryptor, and SRM Asset;
the five mandatory core sources are platform-core, backend-core, frontend-core, mobile-core,
and design-system-core. Use:

```bash
node scripts/governance/validate-capability-reference-corpus.js --query <capability-id>
```

The corpus is not a graph fragment and does not assert ownership, implementation,
publication, or adoption. It only bounds reproducible discovery and records candidates for
intake or repository-owned fragment work.

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
- invalid edge endpoint types or untracked semantic relationships;
- source-only packages presented as published or adopted;
- `CONSUMED_BY` claims without a package, published artifact version and verified-install
  evidence.
- reference sources with mutable revisions, mismatched origin, missing pinned evidence,
  unknown capabilities, or authority/adoption claims.

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
