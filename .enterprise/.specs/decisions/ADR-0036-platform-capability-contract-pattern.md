# ADR-0036 — Platform Capability Contract Pattern (PCCP)

**Status:** Accepted (2026-09-05) — the PCCP proposal and its taxonomy are accepted as the
target design. Graph schema 2.0 and intake v3 remain review candidates, not active: the
registry pin, enforcement, and migration/activation order are a separate, still-pending gate
(see Human gate below). Accepting this ADR authorizes no normative activation on its own.
**Date:** 2026-08-26
**Authors:** Platform Architecture Owners (proposal prepared for review)
**Affects Standards:** Platform Capability Governance Standard, capability graph schema,
capability intake, stack publication policy, module templates, conformance gates
**Supersedes:** N/A
**Superseded By:** N/A

## Context

ADR-0033 made the federated Git graph authoritative, but schema 1.0 and intake v2 cannot
distinguish a neutral contract from its stack projection, a port from its adapter, or a
reference implementation from a production adapter. Substitutability and compatibility are
therefore not fully mechanically provable.

## Proposed decision

Adopt the **Platform Capability Contract Pattern (PCCP)** as the mandatory realization of
Contract-First, Capability-Based, Hexagonal, Dependency-Inverted and Clean Architecture.

```text
Specification
  -> Contracts and Ports
  -> Core Policies
  -> Stack Projections
  -> Technology Adapters
  -> Application Composition
```

Products depend on stack cores, stack cores depend on Platform Core, and adapters depend on
ports/contracts. Core never depends on a product; Platform Core never depends on a stack
adapter. Concrete selections occur only in the application composition root.

### Normative taxonomy

- **Capability:** reusable unit of behavior, responsibility, or guarantee offered by the
  platform.
- **Specification:** language- and technology-neutral semantics, invariants, lifecycle,
  states, transitions, guarantees, failure modes, and boundaries of a capability.
- **Contract:** versioned observable data or behavior exchanged at a boundary. Its kind is
  `data`, `behavioral`, `api`, `event`, `configuration`, `error-catalog`, or `port`.
- **Port:** infrastructure-independent operational boundary. A `provided` port is offered
  by the capability; a `required` port is needed by the capability.
- **Policy:** infrastructure-independent decision or algorithm enforcing specification
  invariants.
- **Projection:** stack/language representation of a neutral contract; never the source of
  truth.
- **Adapter:** replaceable implementation connecting a port to infrastructure, provider, or
  external boundary. Kind: `persistence`, `messaging`, `policy-engine`, `identity`, `cache`,
  `provider`, or `transport`.
- **Reference implementation:** minimal substitutable implementation used to demonstrate
  behavior and validate the contract; not a production adapter.
- **Conformance suite:** reusable positive and negative tests a projection, policy, or
  adapter must pass before claiming compatibility.
- **Composition root:** the only application location selecting concrete projections,
  policies, adapters, and providers.

Contract is not implementation; port is not adapter; policy is not provider; projection is
not source of truth; reference implementation is not production-ready; an available
capability is not a published package; publication is not verified installation; verified
installation is not adoption without a retained immutable dependency in a real consumer.
The graph therefore records package distribution/publication separately from consumer
installation and adoption. A consumer can be `verified-install` and `not-adopted`; only
verifiable real use advances adoption to `adopted` and permits `CONSUMED_BY`.

### Mechanical representation

Prefer classifiers to new node types: `Contract.kind`, `Contract.direction`, `Module.role`
(`specification`, `policy`, `reference-implementation`, `conformance-suite`), `Package.role`
(`abstractions`, `projection`, `implementation`, `adapter`, `composition`) and
`Adapter.kind`. Existing IDs remain immutable; replacement uses lifecycle, `SUPERSEDES`,
and migration evidence.

When a schema 1.0 `Module` was historically used for a stack projection, schema 2.0 represents
the active projection only as `Package.role=projection`. The stable Module ID remains a
deprecated/retired migration tombstone with explicit migration, compatibility and rollback
evidence, and the Package succeeds it through the sole permitted cross-type `SUPERSEDES` form.
The tombstone has no active `Module.role` and cannot satisfy specification, policy,
reference-implementation or conformance requirements.

### Version ownership and distribution

SemVer 2.0 applies independently to repository releases, contracts, packages, and immutable
artifact versions. Experimental `0.0.1 -> 0.0.2 -> 0.0.3` is a patch cadence. Official
publication policy covers npm, Maven, Go modules, and NuGet/.NET. This proposal changes no
existing package version.

## Compatibility, migration, and rollback

Mandatory classifiers are breaking for graph schema 1.0 and the complete promotion dossier
is breaking for intake v2. Therefore schema 1.0/intake v2 remain active; schema 2.0/intake v3
are review candidates. Owners migrate fragments without changing IDs or lifecycle, reconcile
evidence, and pin immutable revisions before a single reviewed activation change.

Rollback before activation deletes candidate artifacts. After activation, rollback requires
a new ADR and restores prior registry/schema pins while retaining IDs and supersedence
history. Passing tests never promotes lifecycle, publication, installation, or adoption.

## Consequences

Compatibility and availability claims become falsifiable. The cost is a breaking metadata
migration and cross-repository sequencing.

Contract compatibility is not accepted from an author-supplied `change_kind` alone. A
changed JSON Schema contract identifies the exact Contract ID and canonical path through an
immutable Git baseline (origin, strict-predecessor revision, authoritative fragment path, and SHA-256).
The validator computes a structural compatibility diff; detected
breakage requires a new major version, `SUPERSEDES`, migration, rollback, and compatibility
evidence. Initial contracts require immutable immediate-parent fragment evidence that proves
the exact ID was absent before the authoritative revision; a Boolean self-classification is
invalid and no commit is required to contain its own SHA.

## Human gate

- [x] Platform Architecture Owner accepts ADR-0036 (2026-09-05).
- [ ] Owner approves graph schema 2.0 and intake v3 activation/migration order.
- [ ] CODEOWNER review and protected-branch checks pass.
- [ ] Immutable fragment revisions are recorded after repository changes exist.

## Alternatives considered

- New node type per concept: rejected as unnecessary vocabulary proliferation.
- Extend schema 1.0/intake v2 in place: rejected as a hidden breaking change.
- Semantic search as authority: rejected by ADR-0033.
