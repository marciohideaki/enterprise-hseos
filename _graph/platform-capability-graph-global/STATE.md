# State — Global Platform Capability Graph

**Status:** In progress
**Current node:** Portfolio reference corpus validation
**Authority gate:** ADR-0022 approved on 2026-08-24

## Completed

- Precedent discovery and adversarial baseline
- ADR-0022 proposal and explicit owner acceptance
- Constitution v2.2 amendment
- Core standard and operational policy
- Registry and fragment JSON Schemas
- Initial HSEOS graph fragment and exact query surface
- Deterministic validator and 12 negative/positive governance tests
- Constitutional version/ADR/CODEOWNERS validation
- Git-pinned `platform-core` external fragment with delegated owner-repository validation
- External fragments loaded from the pinned Git object after remote-identity verification
- Cross-repository composition verified locally: 2 fragments, 18 nodes, 24 edges
- `messaging.event-envelope` composed from platform-core, backend-core and Cambio Real v2
- Four immutable fragments composed locally: 35 nodes, 45 edges, zero findings
- Source-only projection cannot claim `PUBLISHED_AS` or `CONSUMED_BY`; verified adoption now
  requires an installed artifact version linked to its publishing package
- Cambio Real unit consumer and canonical fixture validation delegated through its pinned fragment
- Portfolio discovery corpus versioned with five product sentinels and five core sources
- Product sentinels expose candidate signals for 29/33 migration-view capabilities; the four
  AI/governance gaps are covered by platform/backend/HSEOS sources, yielding 33/33 reference coverage
- Ten source identities, full Git SHAs, and evidence paths verified from pinned Git objects
- Reference corpus is fail-closed and structurally prohibited from claiming canonical mutation or adoption

## Next

- Expand repository-owned fragments beyond the first `messaging.event-envelope` vertical slice
- Reconcile the 29 product signals into repository-owned fragments or explicit rejected candidates
- Retire the platform capability manifest after graph completeness reaches 100%
- Run independent adversarial completion audit

## Residual uncertainty

- GitHub live branch protection has not been mutated or verified; only desired state is
  versioned.
- Package publication and verified installation are intentionally absent and remain a human gate.
- The other 32 migration-view capabilities still lack repository-owned graph completeness.
- Candidate coverage in the reference corpus proves discovery breadth, not that each signal is common,
  conformant, packaged, or adopted.
