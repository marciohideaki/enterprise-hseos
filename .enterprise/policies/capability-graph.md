# Policy: Federated Platform Capability Graph

**Status:** Canonical
**Version:** 2.0.0-draft
**Effective:** 2026-08-24
**Scope:** All Hideaki repositories, projects, and agents
**Authority:** Enterprise Constitution §2.6; Platform Capability Governance Standard; ADR-0033

> PCCP is accepted by ADR-0036 (2026-09-05); enforcement is pending the separate,
> explicit schema-2.0 human activation gate.

## Rule

Every repository that owns or consumes a shared capability MUST participate in the
versioned capability-graph federation. Before creating a local implementation, the actor
MUST query the graph and record one intake outcome: `consume`, `extend`, `promote`,
`keep-local`, or `exception`.

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
- any deferred or unreachable registered fragment in official CI/release composition;
- invalid edge endpoint types or untracked semantic relationships;
- source-only packages presented as published or adopted;
- `CONSUMED_BY` claims without a package, published artifact version and verified-install
  evidence.
- reference sources with mutable revisions, mismatched origin, missing pinned evidence,
  unknown capabilities, or authority/adoption claims.
- PCCP projections without a canonical contract dependency;
- adapters without an implemented port contract;
- packages/modules/adapters without their mandatory role/kind classifier;
- reference implementations presented as production-ready;
- official conformance gates that pass or skip when a canonical schema is unavailable;
- product-to-core or Platform-Core-to-stack-adapter dependency inversion;
- immutable-artifact consumption without an exact version;
- breaking contract changes without a major version, migration guide, compatibility
  evidence, and rollback.
- changed JSON Schema contracts without an authenticated immutable baseline and automatic
  compatibility diff; author-declared `change_kind` alone is insufficient.
- initial Contract claims without immutable immediate-parent evidence proving the exact ID
  was absent from the same fragment immediately before the authoritative revision.

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
- `.enterprise/.specs/decisions/ADR-0033-federated-platform-capability-graph.md`
- `.enterprise/policies/automated-validation.md`
