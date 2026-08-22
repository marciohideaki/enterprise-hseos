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
- lineage-preserving session forks;
- recovery plans for interrupted turns;
- filtered session reads over the shared global stream.

Store instances are nominal and immutable. Structural lookalikes, forged prototypes, subclasses and method overrides cannot be supplied to the context assembler or headless runtime as durable authority.

Rollback before activation is the A2 task commit plus disposable temporary fixture databases. Canonical events are never deleted after operational activation.
