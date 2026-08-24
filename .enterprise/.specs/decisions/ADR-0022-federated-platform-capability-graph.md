# ADR-0022 - Federated Platform Capability Graph and Platform-First Intake

**Status:** Accepted (owner-authorized 2026-08-24)
**Date:** 2026-08-24
**Authors:** Platform Architecture Owners
**Affects Standards:** Enterprise Constitution v2.1, Core Standards index, specification consumption, automated validation, agent instruction cascade
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

Hideaki projects consume capabilities distributed across platform, backend, frontend,
mobile, design-system, shared-infrastructure, client, provider, and product repositories.
Contracts, packages, modules, request/response schemas, error catalogs, ownership, tests,
and adoption evidence are currently discoverable through several manifests and documents,
but there is no organization-wide typed relationship model that an engineer or agent must
query before creating a local implementation.

The established platform pattern is contract-neutral first, projection by stack,
conformance, registry, and discovery. The current registries are catalogs: they can list a
capability and its projections, but cannot reliably answer which module implements a
contract, which package version publishes it, which projects consume or extend it, which
tests prove conformance, or which exception permits a local implementation.

Without a canonical graph, `Platform First / Reuse Before Build` remains partly dependent
on repository familiarity and semantic search. Semantic retrieval is useful for finding
similar names and concepts, but similarity is probabilistic and cannot establish ownership,
compatibility, approval, or compliance.

## Decision

Adopt a versioned, federated Platform Capability Graph as mandatory organizational
governance, subject to approval of this ADR and the corresponding constitutional amendment.

### 1. Constitutional invariant

The Enterprise Constitution will require every project and agent to consult the canonical
capability graph before implementing a shared, platform, cross-cutting, provider, partner,
client, contract, schema, or error-catalog concern. Existing capability is consumed first,
extended through its declared extension point second, and promoted through governed intake
when the need is genuinely new. Local duplication requires a versioned exception with owner,
rationale, scope, and expiry.

The Constitution will contain only stable invariants. The graph vocabulary, lifecycle,
validation algorithm, projection technology, and migration mechanics remain in a core
standard and policy so they can evolve without frequent constitutional edits.

### 2. Federated source of truth

Git remains authoritative. The graph is composed from:

- an organization root registry owned by `enterprise-hseos`;
- repository-owned graph fragments stored with the contracts and implementations they
  describe;
- immutable references to evidence, schemas, packages, versions, ADRs, and exceptions.

The compiled graph is a derived artifact. FalkorDB, Qdrant, search indexes, dashboards, and
LLM context packs are projections and never sources of authority.

An existing registry such as `platform-capabilities.manifest.json` must be migrated or
adapted into the graph federation. It must not remain a competing canonical truth.

### 3. Typed graph model

The initial normative node vocabulary is:

- `Capability`
- `Contract`
- `Package`
- `ArtifactVersion`
- `Repository`
- `Project`
- `Module`
- `Consumer`
- `Adapter`
- `Provider`
- `PartnerApi`
- `ErrorCatalog`
- `Adr`
- `Owner`
- `Evidence`
- `TestSuite`
- `Exception`

The initial normative edge vocabulary is:

- `DEFINED_BY`
- `OWNED_BY`
- `IMPLEMENTED_BY`
- `CONSUMED_BY`
- `EXTENDED_BY`
- `VALIDATED_BY`
- `PUBLISHED_AS`
- `GOVERNED_BY`
- `DEPENDS_ON`
- `SUPERSEDES`
- `EXCEPTED_BY`

Nodes and edges have stable identifiers. Every edge declares source, target, type, owning
repository, and evidence when the relationship is not structurally derivable.

### 4. Three validation layers

Validation is layered and fail-closed for authoritative claims:

1. **Deterministic graph validation:** schema version, node/edge type, identifier uniqueness,
   referential integrity, ownership, forbidden dependency cycles, lifecycle state, contract
   references, evidence existence, and exception expiry.
2. **Repository reconciliation:** declared dependencies, imports, package manifests,
   OpenAPI/AsyncAPI documents, JSON Schemas, module boundaries, and conformance tests are
   compared with graph claims. Material drift fails CI.
3. **Semantic discovery:** embeddings and graph-assisted retrieval find probable duplicates,
   missing links, naming drift, and adjacent capabilities. Results are recorded only as
   `CandidateEdge` or `DriftFinding`. They cannot create, delete, or promote canonical nodes
   or edges without human review.

### 5. Intake and agent behavior

Before a new shared concern is implemented, the actor must produce evidence of:

1. exact graph lookup by identifier, contract, package, and owner;
2. semantic discovery for adjacent or duplicate capabilities;
3. decision to consume, extend, promote, or request an exception;
4. contract-first definition when promotion is selected;
5. implementation projection and conformance tests;
6. graph fragment update in the owning repository.

Agent adapters consume a compiled instruction projection that points to the Constitution,
the core standard, the policy, and the graph query command. Adapter files must not carry an
independently maintained copy of the rules.

### 6. Activation gate

The owner explicitly approved this ADR, the v2.2 constitutional amendment, and the global
implementation on 2026-08-24. The implementation remains subject to deterministic quality
gates and the prohibition on autonomous push, protected-branch merge, publication, or
deployment.

## Alternatives Considered

### Alternative A: Keep the existing central manifest only

The manifest is simple and already useful for capability-to-package discovery. It is
rejected as the target model because it cannot express ownership, consumption, module-level
implementation, evidence, exceptions, and typed cross-repository relationships without
becoming an implicit graph encoded as nested catalog fields.

### Alternative B: Use only semantic search over repositories

Semantic search has low authoring overhead and finds conceptual duplicates. It is rejected
as an authority mechanism because retrieval is nondeterministic, can miss exact legal or
compatibility constraints, and cannot prove that an edge was approved. It remains an
advisory discovery layer.

### Alternative C: Store one monolithic graph in `enterprise-hseos`

A single file makes global queries straightforward. It is rejected because package and
module owners would need cross-repository governance changes for every release, creating
stale data and centralized write contention. A root registry plus repository-owned
fragments preserves global composition and local ownership.

### Alternative D: Let every repository maintain an independent catalog

Local ownership is strong, but global discovery and integrity are weak. It is rejected
because identifiers, contracts, and relationships can diverge without a federation root,
common schema, and organization-wide validator.

## Consequences

### Positive

- Shared capabilities become discoverable and traceable from need to contract, package,
  module, consumer, evidence, and owner.
- Agents receive one global, versioned rule instead of manually duplicated directives.
- Duplicate local implementations become detectable before code is written.
- Semantic retrieval adds recall without receiving authority over canonical state.
- Each repository owns its fragment while the organization retains a single composed view.

### Negative / Trade-offs

- Repositories must maintain graph fragments alongside contract and package changes.
- Federation introduces schema evolution and cross-repository reconciliation work.
- Initial migration will expose incomplete ownership and adoption evidence.
- Strict CI can block delivery when graph metadata is stale, so rollout must be staged.
- FalkorDB/Qdrant projections add operational components, although they are optional for the
  deterministic validation path.

## Mitigations

- Introduce validation in report-only mode for legacy fragments, then enforce new and changed
  capabilities immediately, and finally enforce the complete graph after migration.
- Keep the source format reviewable YAML/JSON with JSON Schema and deterministic tests.
- Require stable IDs and explicit schema-version migration guides.
- Make semantic output advisory and review-gated by construction.
- Support scoped, expiring exceptions rather than bypass flags.
- Add negative fixtures proving that missing owners, dangling edges, invalid types, expired
  exceptions, and semantic auto-promotion are rejected.
- Protect constitutional changes with a CI diff gate, version-bump validation, ADR linkage,
  CODEOWNERS review, and branch protection requiring code-owner approval.

## Migration Plan

1. Ratify this ADR and the v2.2 constitutional invariant.
2. Add the Capability Graph core standard and operational policy.
3. Add the graph JSON Schema, root registry, validator, negative fixtures, and CI gate.
4. Compile the platform-first directive into vendor-neutral agent instructions.
5. Adapt `platform-capabilities.manifest.json` into a first federated fragment; designate the
   graph as successor to avoid dual authority.
6. Add repository reconciliation for package manifests and contract files.
7. Add FalkorDB and Qdrant projection jobs as disposable indexes.
8. Roll out fragments repository by repository, tracking completeness and expiring migration
   exceptions.

Rollback before organization-wide enforcement is removal of the proposed graph artifacts
and restoration of the existing manifest as the sole platform registry. After enforcement,
rollback requires a new ADR because consumers will depend on stable graph identifiers.

## Validation and Success Metrics

- 100% of graph fragments validate deterministically with zero dangling edges.
- 100% of shared capabilities have owner, contract or explicit contract exemption, package or
  implementation module, and validation evidence.
- 100% of new shared-capability pull requests include a graph query result and intake outcome.
- Zero canonical graph mutations originate directly from semantic retrieval.
- New duplicate shared implementations without an active exception are rejected in CI.
- All generated agent adapters resolve to the same constitutional directive and graph query
  contract.
- Constitutional diffs without a version bump, linked ADR, and code-owner review fail CI.

## References

- `../constitution/Enterprise-Constitution.md` §§2, 5, 7-10, 13-14
- `ADR-0016-capability-packaging.md`
- `../../policies/adr-policy.md`
- `../../policies/automated-validation.md`
- `../../policies/specification-consumption.md`
- `../../policies/shared-infrastructure.md`
- Hideaki Second Brain learning: `2026-06-25-platform-shared-capability-projection-pattern`
- Platform workspace registry: `docs/platform/platform-capabilities.manifest.json`
