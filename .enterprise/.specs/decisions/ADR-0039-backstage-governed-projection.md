# ADR-0039 — Backstage as a governed projection of the Platform Capability Graph

**Status:** Accepted
**Date:** 2026-09-13
**Authors:** Platform Governance
**Affects Standards:** Platform Capability Governance Standard (§3, §4, §5, §6), Engineering Governance Standard, API Management & Versioning Standard, Code & API Documentation Standard
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

An internal developer portal (Backstage) was deployed in April 2026 with a hand-written
static catalog of 80 entities stored in `platform-gitops/backstage/catalog/`. That
deployment lived on the `.90` cluster and was decommissioned on 2026-07-08; the
application repository, its published image and its GitOps manifests survived intact.
Reactivation on the `.70` cluster is now planned, with a wider scope: the portal must
also expose the shared cores, the reference applications, the API contracts and the
engineering specifications.

Between that deployment and today, ADR-0033 established the federated Platform Capability
Graph and ADR-0036 established the Platform Capability Contract Pattern. The Platform
Capability Governance Standard §6 states that existing catalogs MUST be migrated or
represented by a governed adapter, and that once a catalog is declared superseded it is a
generated view that MUST NOT be edited as an independent source. A hand-curated portal
catalog is therefore a competing local truth, which the standard forbids.

The empirical case is equally strong. Measured on 2026-09-13:

| Fact | Value |
|---|---|
| GitHub organizations | 19 |
| Repositories | 180 |
| Repositories carrying `repository-contract.yaml` | 68 |
| Repositories carrying `catalog-info.yaml` | 2 |
| OpenAPI / AsyncAPI specifications | 53 |
| Workloads running on the `.70` cluster | 195 deployments across 25+ namespaces |
| Portfolio coverage of the April catalog | approximately 20% |
| `kind: API` entities in the April catalog | 0 |
| Scaffolder templates in the April catalog | 0 |

The April catalog also contains entities for systems that no longer exist, and three of
five sampled `github.com/project-slug` annotations point at repositories that were never
created. Hand curation did not merely lag behind reality — it encoded facts that were
never true. At this portfolio size, manual curation cannot converge.

---

## Decision

We will treat Backstage as a **generated, read-only projection** of the Platform
Capability Graph and its adjacent authoritative sources. Concretely:

1. **No catalog entity is authored by hand.** Every entity under
   `platform-gitops/backstage/catalog/` is emitted by a deterministic adapter. Manual
   edits to generated entities are a governance violation, not a shortcut.

2. **Each class of fact has exactly one authoritative source:**

   | Fact | Authoritative source |
   |---|---|
   | Repository identity | `repository-contract.yaml` (`repository_id`) |
   | Capability, Contract, Package, Owner, lifecycle | capability graph fragments |
   | Runtime placement (namespace, workload, ArgoCD app) | the target cluster |
   | API contracts | OpenAPI / AsyncAPI artifacts referenced by a `Contract` |
   | Repository metadata (language, visibility, archival) | GitHub API |

3. **Node and edge mapping is fixed** (see *Entity mapping* below). The adapter does not
   invent entity kinds outside this mapping.

4. **`repository_id` is the stable key.** Display names and Backstage entity names may
   change; the identifier never changes and is never recycled, consistent with
   Platform Capability Governance Standard §2.

5. **Generation is fail-loud.** A repository without a resolvable contract or without a
   single canonical `OWNED_BY` edge is reported in an exceptions report. It is never
   silently omitted and never given a synthesized owner.

6. **The graph wins conflicts.** When the projection disagrees with the graph, the output
   is a finding against the source, not an edit in the catalog.

7. **The April 2026 catalog is declared superseded** on activation of this ADR. From that
   point it is a generated view.

8. **No reverse writes.** Backstage never emits facts back into the graph. Repositories
   created by the scaffolder ship a `repository-contract.yaml` and a capability graph
   fragment, and enter the graph through the normal federated path — not through the portal.

9. **Lifecycle is projected, not reinterpreted.** The canonical states `proposed`,
   `available`, `deprecated` and `retired` map directly onto `spec.lifecycle`.

10. **Ownership is mandatory.** The single canonical `OWNED_BY` edge becomes `spec.owner`.
    An entity with no owner does not reach the catalog; it reaches the exceptions report.

### Entity mapping

| Graph node | Backstage entity | Notes |
|---|---|---|
| `Owner` | `Group` | one per GitHub organization, under a root group |
| `Repository` | `Component` | `repository_id` carried as an annotation |
| `Capability` | `System`, or `Domain` when aggregating | |
| `Contract` (`kind=api`) | `API` (`openapi` / `grpc`) | |
| `Contract` (`kind=event`) | `API` (`asyncapi`) | |
| `Package` | `Component` (`type: library`) | `role` projected as a tag |
| `ArtifactVersion` | annotation on the publishing `Component` | from `PUBLISHED_AS` |
| `Adapter`, `Provider`, `PartnerApi` | `Component` (`type: service`) plus consumed `API` | |
| `Adr` | TechDocs page plus `Location` | |
| `Project` | `System` | |
| Shared infrastructure | `Resource` | always the shared platform namespace |

| Graph edge | Backstage relation |
|---|---|
| `OWNED_BY` | `spec.owner` |
| `DEPENDS_ON` | `spec.dependsOn` |
| `CONSUMED_BY` | `spec.consumesApis` |
| `IMPLEMENTED_BY`, `PUBLISHED_AS` | `spec.providesApis` |
| `GOVERNED_BY` | documentation link to the governing ADR |

---

## Consequences

### Positive
- The portal cannot drift from the graph, because it has no independent memory to drift with.
- Portfolio coverage moves from roughly 20% to the full set of repositories at negligible
  marginal cost per repository, since entities are emitted rather than written.
- Every entity is traceable to an identified source, which satisfies the evidence
  obligations of the Platform Capability Governance Standard.
- Ownership gaps, missing contracts and orphaned repositories become a visible report
  instead of silent absences.
- The catalog diff is reviewable in a pull request, so a wrong projection is caught before
  it reaches the portal.

### Negative / Trade-offs
- A generated catalog is only as good as its generator. Fixing a wrong entity means fixing
  the source or the adapter, which is slower than editing a YAML file.
- Freshness is bounded by the generation cadence rather than continuous.
- Repositories that are not yet represented in the graph appear with reduced fidelity until
  their fragment exists.

### Risks
- *The adapter becomes a de facto source.* Mitigation: the adapter carries no local state
  and derives every field from a declared source; unresolvable fields fail the run.
- *Exception reports are ignored and become noise.* Mitigation: the report is part of the
  generation pull request, so it is read at review time rather than filed away.
- *Portal credentials grant broader access than the projection requires.* Mitigation: the
  ingestion credential is restricted to repository read and organization read, and is
  stored in `pass` per AGENTS.md §3c.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Platform Capability Governance Standard | §6 Federated ownership | Clarifies — names Backstage as a governed adapter and declares the April 2026 catalog superseded |
| Platform Capability Governance Standard | §3, §4, §5 | Extends — fixes the projection of canonical nodes, edges and lifecycle onto portal entities |
| Engineering Governance Standard | Full compliance baseline | Clarifies — portal entities are generated artifacts subject to review |
| API Management & Versioning Standard | API contract exposure | Extends — published contracts surface as `API` entities |
| Code & API Documentation Standard | Documentation surface | Extends — specifications and ADRs are published through TechDocs |

---

## Compliance

- [x] Approved by Engineering Leadership (owner, 2026-09-13)
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [x] Activation date: 2026-09-13
- [ ] Review date: 2027-09-13

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep the hand-curated catalog | Forbidden by Platform Capability Governance Standard §6, and empirically unconverged: 20% coverage, dead entities and three of five sampled repository slugs pointing at repositories that do not exist |
| Custom Backstage entity provider reading sources at runtime | Produces no reviewable diff and no git history; a bad ingestion reaches users before any human sees it. Retained as a possible post-stabilization evolution for runtime-only facts |
| Treat Backstage as the source and synchronize into the graph | Creates the competing local truth the standard exists to prevent, and inverts the dependency direction defined by ADR-0036 |
| Ship no portal and rely on the graph directly | The graph is a validation and composition surface, not a navigation surface; onboarding cost stays where it is |
