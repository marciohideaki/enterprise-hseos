# ADR-0034 — Capability Reuse Enforcement Complementing the Capability Graph

**Status:** Proposed
**Date:** 2026-09-01
**Authors:** platform-governance
**Affects Standards:** Capability Graph policy; Platform Capability Governance Standard §7;
automated validation; exceptions; agent-core hook compilation
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

The enterprise already has a federated Capability Graph that governs deterministic discovery,
canonical ownership, and evidence. Product-local instructions and a home-directory advisory
hook nevertheless repeat the reuse rule without enforcing it. The result is duplicate
capabilities that are discovered only after implementation.

Creating a competing registry or ownership model would violate ADR-0033. The missing layer is
enforcement: a decision contract at write time, a no-regression ratchet at merge time, and an
operational scorecard for recurring review.

## Decision

We will add the `capability-reuse` policy as a complementary enforcement policy. It delegates
discovery and ownership to the Capability Graph, requires the ordered outcome `consume →
extend → promote → keep-local → exception`, and defines the ownership of the handler, skill,
ratchet, product adapters, and Core Registry projection.

The policy will initially remain Proposed. The blocking hook is not activated until end-to-end
evidence and explicit human approval are recorded. The existing advisory home-directory hook
and duplicated product text will be retired only in the separately approved cleanup phase.

## Consequences

### Positive

- One canonical ownership/discovery model remains intact under ADR-0022.
- A write-time intake guard and merge-time ratchet turn the reuse rule into a measurable gate.
- `keep-local` becomes explicit without weakening promotion or exception controls.

### Negative / Trade-offs

- Contributors must maintain an intake record before creating qualifying exports.
- Product repositories need a baseline and reusable-workflow adoption before enforcement.

### Risks

- An over-broad hook could create noise or block legitimate work; exclusions and shell
  regression tests are mandatory before activation.
- An inaccurate Core Registry projection could mislead discovery; the graph remains canonical
  and the registry is explicitly non-authoritative.

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Capability Graph policy | Query and intake | Clarifies that graph discovery/ownership is retained while enforcement is delegated. |
| Platform Capability Governance Standard | §7 Mandatory intake | Extends outcomes with documented `keep-local` at the enforcement layer. |
| Automated validation | Mandatory validation | Adds the required write guard and merge ratchet once activated. |
| Exceptions policy | §2–§6 | Requires standard exception controls for reuse deviations. |

## Compliance

- [ ] Approved by Platform Architecture owner
- [x] Affected standards identified for follow-up references
- [ ] Workspace, product, platform-core, and second-brain teams notified through PRs
- [ ] Activation date: after Fase 5 evidence and human approval
- [ ] Review date: 2027-03-01

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Replace the Capability Graph with the Core Registry | Creates a second ownership source and conflicts with ADR-0022. |
| Keep the home-directory advisory hook | It is not portable, only sees new files, and does not provide a merge ratchet. |
| Put the full rule in every product AGENTS.md | Duplicates authority and cannot guarantee enforcement. |
