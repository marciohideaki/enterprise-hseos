# Checkpoint — Portfolio capability reference corpus

**Date:** 2026-08-24  
**Status:** Passed for reproducible discovery; canonical migration remains in progress.

## Scope

The owner designated Poynt Hub, Cambio Real V3, LinkedOut, Cryptor, and SRM Asset as the
initial product reference set, alongside platform-core, backend-core, frontend-core,
mobile-core, and design-system-core.

## Observed

- All ten repositories resolved to the configured origin and a full Git SHA.
- Every declared evidence path exists in the pinned Git object; uncommitted files were not
  used as evidence.
- Qdrant + bge-m3 semantic discovery returned relevant cross-cutting candidates for the five
  products. Results remained advisory.
- The five product sentinels collectively expose candidate signals for 29 of the 33
  migration-view capabilities.
- The four product gaps are `ai.token-metering`, `ai.guardrails`, `ai.mcp-gateway`, and
  `governance.capability-intake`. Core/HSEOS sources cover them, bringing the combined
  reference corpus to 33/33.

## Inferred

The five products are a strong sentinel set because they combine marketplace, remittance,
social, crypto, asset-management, backend, frontend, mobile, event-driven, multi-tenant,
polyglot, and regulated-finance surfaces. This makes them suitable mandatory discovery
inputs.

## Not established

- A candidate signal is not proof that a capability is common.
- A local building block is not a canonical package or contract.
- A source reference is not a repository-owned graph fragment.
- No publication, verified installation, `CONSUMED_BY`, push, merge, or deploy was performed.
- The 32 capabilities outside the event-envelope vertical slice still need repository-owned
  graph qualification.

## Deterministic evidence

```text
Capability reference corpus tests: 9 passed, 0 failed
Product discovery coverage: 29/33
Full reference coverage: 33/33
Pinned evidence: 10 resolved, 0 deferred
Capability graph governance tests: 15 passed, 0 failed
```

The validator rejects mutable revisions, origin mismatches, path traversal, missing pinned
evidence, unknown capability IDs, false product authority, canonical mutation, and adoption
claims.
