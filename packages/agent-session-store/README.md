# `@hseos/agent-session-store`

**Artifact type:** Provider-neutral Agent Kernel persistence adapter  
**Scope:** Agent-session append, replay, fork, request reconstruction and crash recovery  
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0002; ADR-0003; ADR-0022; ADR-0024; Automated Validation Rules

This package stores validated agent-session contracts in the relational ledger established by ADR-0022. Session and governed-operation streams remain separate aggregates, but share transactional ordering and one global position. A session stores only an `operation_id` reference when a governed tool operation is linked; approval, dispatch and outcome facts remain owned by the governed execution stream.

The adapter requires an injected relational ledger port. It does not open operational databases, run migrations or activate pending schemas. Tests use only the gated in-memory/file fixtures.

Deterministic APIs include:

- compare-and-append with exact session sequence validation;
- immutable replay with lifecycle invariants;
- canonical model-request reconstruction;
- exact multi-step model/tool continuation lineage and started-work settlement;
- context and tool-result compaction replay with exact source partition, digest, call identity and replacement validation;
- lineage-preserving session forks;
- one durable trace root across resumed appends and child forks, with deterministic W3C `traceparent` projection;
- atomic workflow reservations plus terminal releases, and phase checkpoints bound to a definition digest and exact step/child lineage;
- recovery plans for interrupted turns;
- filtered session reads over the shared global stream.

Store instances are nominal and immutable. Structural lookalikes, forged prototypes, subclasses and method overrides cannot be supplied to the context assembler or headless runtime as durable authority.

Replay rejects concurrent durable workflow reservations, live or stale reclaim references, checkpoint/release claim drift, release-status drift, definition drift, duplicate phases, unattached children and cumulative step/child overflow. A reservation consumes the bounded step budget before dispatch and survives a crash before the first phase checkpoint; after its parent-bounded lease expires, an explicit reclaim rotates the single execution claim atomically across SQLite connections. Child creation, execution intent and parent attachment remain atomic, and every fork preserves identical authority/policy with resource limits no wider than its parent.

Rollback before activation is the A2 task commit plus disposable temporary fixture databases. Canonical events are never deleted after operational activation.

The relational `correlation_id` remains canonical lineage authority. A stream with more than one correlation fails closed on append, replay, and trace projection. Every non-root event continues from its immediately preceding durable event; a fork attachment may instead reference its earlier durable branch point, and a child's root is anchored by that parent attachment. Children inherit the parent trace. Telemetry exporters may project this state, but cannot replace or repair it.
