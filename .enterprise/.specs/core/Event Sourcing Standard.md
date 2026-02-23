# Event Sourcing Standard
## State Persistence via Immutable Event Log (Technology-Agnostic)

**Version:** 1.0
**Status:** Active — Core Standard
**Scope:** Services adopting Event Sourcing as their write-side persistence model
**Applies to:** All backend stacks — adoption requires explicit ADR

> Event Sourcing is NOT the default persistence model for all services.
> It MUST be adopted only when explicitly justified and documented via ADR.
> When adopted, all rules in this standard are mandatory.

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Hexagonal & Clean Architecture Standard**
- **CQRS Standard** (Event Sourcing requires CQRS)
- **Architecture Boundaries Policy**
- **Data Contracts & Schema Evolution Standard**
- **Observability Playbook**
- **Saga Pattern Standard** (when applicable)

---

## 1. Core Principles

- ES-01: The **event log is the single source of truth** for the write model — not the current state in a relational table.
- ES-02: Events are **immutable facts** — once persisted, they are never modified or deleted.
- ES-03: Current state is derived by **replaying events** from the beginning (or from a snapshot).
- ES-04: Events describe **what happened**, not what should happen — past tense, factual.
- ES-05: Event Sourcing MUST be combined with **CQRS** — the write side is event-sourced; the read side uses projections.

---

## 2. When to Use Event Sourcing

### Adopt when:
- A **complete audit trail** of state changes is a business or regulatory requirement
- **Temporal queries** are needed ("what was the state at time T?")
- **Replayability** is required (rebuilding projections, reprocessing history)
- **Event-driven integrations** benefit from the full event history as source
- The domain has **complex state transitions** where the history matters

### Do NOT adopt when:
- Simple CRUD with no audit requirements
- The team has no prior experience with Event Sourcing (training must precede adoption)
- Performance characteristics of an event store are not acceptable for the use case
- The domain state does not benefit from history

**All adoption decisions require an ADR.**

---

## 3. Events

### 3.1 Event Definition Rules
- ES-06: Events MUST be named in the **past tense**: `OrderPlaced`, `PaymentFailed`, `SubscriptionCancelled`.
- ES-07: Events MUST carry all data that represents the **fact that occurred** — sufficient to rebuild state without external lookups.
- ES-08: Events MUST be **self-contained** — no lazy references to external mutable state.
- ES-09: Events MUST NOT contain commands, intent, or instructions — only facts.

### 3.2 Event Structure (Canonical)
Every domain event MUST include:

```
Event
  ├── eventId        (UUID — unique identifier for the event)
  ├── eventType      (string — e.g., "OrderPlaced")
  ├── aggregateId    (identifier of the aggregate that produced it)
  ├── aggregateType  (string — e.g., "Order")
  ├── schemaVersion  (integer — for evolution management)
  ├── occurredAt     (UTC timestamp)
  ├── correlationId  (end-to-end flow identifier)
  ├── causationId    (ID of the command or event that caused this)
  └── payload        (domain-specific event data)
```

- ES-10: All fields above are MANDATORY. Missing fields are a contract violation.

### 3.3 Event Immutability
- ES-11: Events MUST NEVER be updated or deleted from the event store.
- ES-12: Corrections are represented as **new compensating events** (e.g., `OrderCancelled` after `OrderPlaced`).
- ES-13: Bug fixes that would change event semantics require a **new event type** and an ADR.

---

## 4. Event Store

### 4.1 Requirements
- ES-14: The event store MUST be **append-only**.
- ES-15: The event store MUST guarantee **sequential ordering** of events per aggregate stream.
- ES-16: The event store MUST support **optimistic concurrency** — prevent conflicting writes to the same aggregate stream.
- ES-17: The event store MUST support **reading events by aggregate ID and version range**.
- ES-18: Global event streams (all events across aggregates) MUST be available for projection building.

### 4.2 Optimistic Concurrency
- ES-19: When writing a new event, the **expected version** of the aggregate stream MUST be provided.
- ES-20: If the actual version differs, the write MUST fail with a concurrency conflict error.
- ES-21: Conflict handling (retry, reject, merge) is the responsibility of the Application layer.

---

## 5. Aggregates in Event Sourcing

### 5.1 State Reconstruction
- ES-22: Aggregate state MUST be rebuilt by replaying its event stream from version 0 (or last snapshot).
- ES-23: The aggregate's `Apply(event)` method MUST be **pure and deterministic** — given the same event stream, it always produces the same state.
- ES-24: The `Apply` method MUST NOT produce side effects (no IO, no publishing, no logging).

### 5.2 Command Processing
- ES-25: The aggregate handles a command by:
  1. Loading current state (from event replay or snapshot)
  2. Validating business rules against current state
  3. Producing one or more domain events (or raising an error)
  4. The handler persists the events and publishes them
- ES-26: The aggregate MUST NOT persist anything directly — the Application layer coordinates persistence via the repository port.

---

## 6. Projections (Read Side)

### 6.1 Definition
A **Projection** is a read model built by consuming and processing the event stream.

- ES-27: Projections are **disposable** — they can be deleted and rebuilt by replaying the event stream.
- ES-28: Projections MUST be idempotent — processing the same event twice must produce the same result.
- ES-29: Projections MUST track their **checkpoint** (last processed event position) to support resumable rebuilds.
- ES-30: A projection MUST NOT write back to the event store or command the write side.

### 6.2 Projection Types

| Type | Description | Use Case |
|---|---|---|
| Inline projection | Updates read model synchronously in the same transaction | Simple, low-latency reads |
| Async projection | Consumes events from a stream or broker asynchronously | Complex read models, eventual consistency acceptable |
| Catchup projection | Rebuilds from full event history | New projections, error recovery |

- ES-31: Async projections MUST handle **out-of-order events** gracefully or enforce ordering via sequence tracking.

### 6.3 Rebuilding Projections
- ES-32: Rebuilding a projection MUST be a **safe, reversible operation** — it must not corrupt live data.
- ES-33: Rebuild processes MUST be executable in non-production environments first.
- ES-34: Projected data used by clients must be **versioned** during schema evolution (see Data Contracts Standard DC-37).

---

## 7. Snapshots

- ES-35: Snapshots are **optional** performance optimizations — never required by correctness.
- ES-36: A snapshot captures aggregate state at a given version to avoid replaying the full event history.
- ES-37: Snapshots MUST include the aggregate version at the time of capture.
- ES-38: State reconstruction MUST work correctly **with or without** a snapshot.
- ES-39: Snapshot strategy (frequency, storage) must be documented in the service architecture spec.

---

## 8. Schema Evolution for Events

Because events are immutable, schema evolution requires careful strategy:

- ES-40: **Additive changes** (new optional fields) are allowed within the same event type and schema version.
- ES-41: **Breaking changes** (removed fields, renamed fields, changed semantics) require a **new event type** (e.g., `OrderPlacedV2`).
- ES-42: Old event types MUST remain deserializable — **upcasters** must be provided to transform old events to the current schema when replaying.
- ES-43: Every schema version change MUST increment `schemaVersion`.
- ES-44: Event schema changes require an ADR.

---

## 9. Integration with Other Services

- ES-45: Domain events persisted in the event store MUST be published as integration events to external services via the **Outbox Pattern**.
- ES-46: Integration events are derived from domain events — they must be **explicitly mapped** and versioned separately.
- ES-47: Other services MUST NOT consume the internal event store directly — only published integration events.

---

## 10. Observability

- ES-48: Event append operations MUST emit metrics:
  - events appended per aggregate type
  - concurrency conflicts per aggregate type
  - event store write latency
- ES-49: Projection processing MUST emit metrics:
  - events processed (count, by projection)
  - processing lag (time between event occurrence and projection update)
  - projection failures
- ES-50: Snapshot operations must be logged and traced.

---

## 11. Anti-Patterns (Explicitly Forbidden)

### 11.1 Mutable Event Store
Updating or deleting events to "fix" data.
**Fix:** publish correction events; treat the history as immutable.

### 11.2 Fat Events
Events that contain all possible fields for the entire aggregate, causing over-exposure and coupling.
**Fix:** events must contain only the data relevant to the specific fact.

### 11.3 Commands in Events
Events named as commands (`ProcessPayment`, `SendEmail`) or containing imperative instructions.
**Fix:** events must be past-tense facts (`PaymentProcessed`, `EmailSent`).

### 11.4 Side Effects in Apply Methods
The `Apply(event)` method performing IO, logging, or publishing.
**Fix:** Apply is purely a state mutation function — all side effects occur in the Application layer.

### 11.5 Projections Commanding the Write Side
A projection updating state by issuing commands back to the write model.
**Fix:** projections are read-only derived artifacts — cross-side coordination uses sagas.

### 11.6 Event Sourcing Without CQRS
Attempting Event Sourcing without separating the write and read models.
**Fix:** Event Sourcing requires CQRS — the read side must be managed via projections.

---

## 12. Governance

- ES-51: Adoption of Event Sourcing for any service requires an **ADR** with explicit justification.
- ES-52: Event schema changes require an **ADR**.
- ES-53: Compliance is verified in PR reviews.
- ES-54: Teams adopting Event Sourcing must document their projection and snapshot strategies in the service architecture spec.

---

## Summary

This standard governs Event Sourcing adoption:

- **Event log is the source of truth** — immutable, append-only
- **State is derived** from replaying events
- **CQRS is mandatory** — write and read sides are explicitly separated
- **Projections are disposable** and rebuildable
- **Schema evolution uses new event types**, not in-place mutation

Adoption is not the default — it requires explicit justification.
When adopted, all rules are mandatory and non-compliance is a blocking violation.
