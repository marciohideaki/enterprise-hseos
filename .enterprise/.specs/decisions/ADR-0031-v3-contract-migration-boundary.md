# ADR-0031: v3 Contract Migration Boundary

## Status

Accepted on 2026-08-28 by explicit human authorization.

## Context

Project-scoped state, loopback-only side-cars, typed workflows, and surface
lifecycle metadata correct security and ownership ambiguities in the v2 runtime.
Those corrections change defaults and canonical schemas. Publishing them under
the existing major version would hide downstream migration work.

At the same time, immediately rejecting every previously compiled catalog would
make the compiler unable to repair the installations it is responsible for.
Compatibility therefore needs a narrow read boundary that cannot weaken new
canonical sources.

## Decision

The runtime package advances to version 3.0.0. Its migration contract is
documented in `docs/MIGRATION-GUIDE-v2-to-v3.md` and includes:

- project-scoped state and registry defaults with no implicit machine-wide
  discovery;
- loopback-only direct state UI access;
- workflow schema v2 as the canonical write format;
- the complete capability lifecycle catalog as the canonical source; and
- the project-store SessionStart hook identifier as the only emitted active
  registration hook.

The v3 compatibility boundary accepts exactly two older inputs:

1. a workflow registry with `version: 1` and no `schema_version`, normalized in
   memory to typed sequential workflows or subsystems; and
2. a compiled capability catalog containing valid schema-v2 profiles and
   components but no `surfaces.yaml`, classified conservatively and upgraded by
   the compiler.

Compatibility does not apply to canonical capability sources, unknown schema
versions, malformed documents, implicit machine paths, or non-loopback HTTP.
Removing either bounded reader requires a later major release and a separate
accepted decision.

## Alternatives Considered

### Keep package version 2.0.0

Rejected because consumers would receive changed defaults and exposure rules
without a major-version signal or migration contract.

### Reject all older catalogs immediately

Rejected because installed compiled catalogs could not be loaded long enough
for the compiler to upgrade them.

### Preserve machine-scoped discovery as an automatic fallback

Rejected because host state would remain an implicit runtime dependency and
could cross project boundaries.

## Consequences

### Positive

- Downstream consumers receive an explicit major-version and migration signal.
- Canonical sources remain strict and fail closed.
- Existing valid compiled installations can repair themselves deterministically.
- Missing lifecycle intent is never promoted to an active module claim.

### Negative

- Operators must migrate state and registry files per project.
- Remote UI access requires proxy configuration.
- Compatibility readers remain maintained through the v3 window.

## Mitigations

- Preserve explicit legacy paths during migration.
- Provide validation and rollback commands in the migration guide.
- Test genuine v1 and missing-surface fixtures, not copies of current catalogs.
- Retain the former hook ID as deprecated registry metadata while excluding it
  from emitted adapters.

## References

- `ADR-0006-standalone-architecture.md`
- `ADR-0026-canonical-capability-catalog-source.md`
- `ADR-0027-explicit-hook-and-workflow-contracts.md`
- `ADR-0028-project-scoped-observability-sidecars.md`
- `ADR-0030-surface-lifecycle-contract.md`
- `docs/MIGRATION-GUIDE-v2-to-v3.md`
