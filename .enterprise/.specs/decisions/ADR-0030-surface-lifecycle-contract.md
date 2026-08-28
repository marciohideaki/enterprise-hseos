# ADR-0030: Surface Lifecycle Contract

## Status

Accepted on 2026-08-28 by explicit human authorization.

## Context

The capability catalog distinguished packaging families but did not state
whether a surface belonged to the runtime core, an optional module, a separate
process, a pre-activation candidate, or a retiring compatibility boundary.
That ambiguity allowed optional functionality to look mandatory and made
extraction or retirement decisions depend on prose and directory names.

## Decision

The canonical capability catalog includes `surfaces.yaml` with closed
classification and disposition vocabularies. Every static component must be
classified exactly once. Required baseline components must remain `core`.
Synthetic skill selectors resolve as `module`.

Independently operated surfaces declare an identifier, class, disposition,
contract, and bounded repository paths. The initial registry establishes:

- product-method content as an opt-in module;
- project and multi-project web boards as sidecars with no canonical-write
  authority;
- plugin definitions as pre-activation candidates;
- legacy installation detection and evidence tooling as retiring
  compatibility code.

The resolver includes `surface_class` in machine-readable and human-readable
install plans. The compiler publishes the complete catalog into `.agents`.
Missing coverage, unknown vocabulary, duplicate identifiers, unsafe paths, or
baseline demotion fail closed.

## Alternatives Considered

### Infer lifecycle from directories

Rejected because paths express storage topology, not authority or activation
status.

### Encode lifecycle in component families

Rejected because packaging family and operational lifecycle are independent;
for example, a runtime-family component may still be a candidate.

### Maintain only a documentation table

Rejected because prose cannot prevent incomplete coverage or contract drift.

## Consequences

### Positive

- Core, optional, sidecar, candidate, and compatibility boundaries are
  explicit and testable.
- Install plans expose lifecycle before materialization.
- New components cannot enter the catalog without an ownership decision.
- Sidecars and compatibility code have explicit authority limits.

### Negative

- Adding or removing a component requires a synchronized lifecycle entry.
- Compiled catalogs from releases before this contract require regeneration.

## Mitigations

- The compiler copies the registry atomically with profiles and components.
- Catalog tests verify exact coverage and fail-closed vocabulary.
- Canonical source remains authoritative; `.agents` stays generated output.

## References

- `ADR-0016-capability-packaging.md`
- `.enterprise/governance/capabilities/surfaces.yaml`
- `tools/cli/lib/capability-catalog.js`
