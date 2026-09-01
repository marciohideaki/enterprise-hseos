# Checkpoint — Event Envelope Vertical Slice

## Revisions

- platform-core: `86ffef7f118a925bb2993eadfb3ec05eea0ccff8`
- backend-core: `1394444be20fdaa8a9fcfa7229df2aa59768c992`
- cambio-real-v2: `2124528f61803ced593c3415f4714db22fba63e0`

## Deterministic evidence

- Platform contracts and local fragment validation passed.
- Backend contracts, JVM tests and strict event-envelope schema conformance passed.
- Cambio Real intake, graph, 20 unit tests and emitted fixture conformance passed.
- Global composition passed with 4/4 fragments, 35 nodes, 45 edges and zero findings.
- Exact query returned `DEFINED_BY`, `IMPLEMENTED_BY`, `EXTENDED_BY` and two independent
  `VALIDATED_BY` relationships.
- Platform-only composition failed on missing `IMPLEMENTED_BY`, proving global completeness
  is enforced outside repository-local fragments.
- Wrong revision, unknown endpoint, missing source, invalid edge type, missing evidence and
  source-only false-adoption cases fail closed.

## Gate retained

The JVM projection is unpublished and source-only. No `PUBLISHED_AS`, `CONSUMED_BY`, push,
merge, publication or deployment was performed.
