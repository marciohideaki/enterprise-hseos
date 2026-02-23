# CQRS Standard
## Command Query Responsibility Segregation (Technology-Agnostic)

**Version:** 1.0
**Status:** Active — Core Standard
**Scope:** All backend services across all technology stacks
**Applies to:** C# / .NET, Java, Go, PHP, C++, and any future backend stack

> This standard formally defines CQRS as a cross-cutting pattern for this organization.
> It promotes the C# / .NET stack definition to a platform-wide rule.
> Stack-specific documents apply this standard and may add implementation detail.

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Hexagonal & Clean Architecture Standard**
- **Architecture Boundaries Policy**
- **Data Contracts & Schema Evolution Standard**
- **Observability Playbook**
- **Event Sourcing Standard** (when applicable)

---

## 1. Core Principles

- CQ-01: **Commands mutate state; Queries read state.** They must never be mixed.
- CQ-02: A command returns an acknowledgement (success/failure/ID) — never a read model.
- CQ-03: A query returns data — it must never modify state.
- CQ-04: Commands and Queries are **explicit use case units** — one handler per operation.
- CQ-05: CQRS does not require Event Sourcing — the two patterns are complementary but independent.

---

## 2. Commands

### 2.1 Definition
A **Command** is an explicit intent to change system state.

Characteristics:
- Named in the **imperative form**: `PlaceOrder`, `CancelSubscription`, `UpdateProfile`
- Carries all data needed to execute the intent
- Is addressed to a specific Aggregate or use case

### 2.2 Command Rules
- CQ-06: Commands MUST be validated before being processed (input contract and domain rules).
- CQ-07: Commands MUST be handled by exactly **one handler**.
- CQ-08: A command handler MUST NOT return domain query data — it may return an identifier or operation result.
- CQ-09: Commands that trigger cross-service flows MUST use the **Saga Pattern** (see Saga Pattern Standard).
- CQ-10: Commands that require reliable side effects (event publishing, DB writes) MUST use the **Outbox Pattern**.
- CQ-11: Command handlers MUST be idempotent when commands can be retried.

### 2.3 Command Structure (Canonical)
```
Command
  ├── identifier (e.g., correlationId, idempotencyKey)
  ├── payload (data required to execute)
  └── metadata (actor, timestamp, correlationId)

CommandResult
  ├── success: boolean
  ├── aggregateId (optional)
  └── error (typed, when failure)
```

---

## 3. Queries

### 3.1 Definition
A **Query** is a read operation that returns data without mutating state.

Characteristics:
- Named in the **interrogative/noun form**: `GetOrderById`, `ListActiveSubscriptions`, `FindUserByEmail`
- May read from a read model, cache, or primary data store
- Must be side-effect free

### 3.2 Query Rules
- CQ-12: Queries MUST NOT modify state or produce side effects.
- CQ-13: Queries MUST be handled by exactly **one handler**.
- CQ-14: Query handlers MAY read from optimized read models (denormalized, projected).
- CQ-15: Query results MUST be **typed DTOs** — never raw database models.
- CQ-16: Pagination, filtering, and sorting parameters are part of the query contract and must be explicit.

### 3.3 Read Model Rules
- CQ-17: Read models are **derived artifacts** — they are not the source of truth.
- CQ-18: Read models must be **rebuildable** from the write side (event log or primary store).
- CQ-19: Read model schema changes must consider **replay compatibility** (see Data Contracts Standard DC-36).
- CQ-20: Stale read models are acceptable — clients must be designed for eventual consistency where applicable.

---

## 4. Handler Organization

- CQ-21: Commands, Queries, Handlers, and Validators MUST be **grouped by use case**, not by technical type.
- CQ-22: All artifacts belonging to one use case MUST live in the same folder/module.
- CQ-23: Horizontal grouping (e.g., all handlers in one folder, all commands in another) is **forbidden**.

Canonical structure:
```
application/
  use-cases/
    place-order/
      PlaceOrderCommand.(ext)
      PlaceOrderHandler.(ext)
      PlaceOrderValidator.(ext)
    get-order/
      GetOrderQuery.(ext)
      GetOrderHandler.(ext)
      GetOrderResult.(ext)
```

---

## 5. Validation Rules

- CQ-24: Input validation (schema, format, required fields) MUST occur **before** the handler runs.
- CQ-25: Domain validation (invariants, business rules) MUST occur **inside the Domain layer** (aggregate or domain service).
- CQ-26: Validation failures must return a **typed, explicit error** — never throw unhandled exceptions across boundaries.

---

## 6. CQRS and Event Sourcing

CQRS does NOT require Event Sourcing. The decision to use Event Sourcing is independent.

| Scenario | Approach |
|---|---|
| Simple write + read model | CQRS without Event Sourcing |
| Audit trail + temporal queries | CQRS + Event Sourcing |
| High-read scalability | CQRS with dedicated read store |
| Full event replay required | CQRS + Event Sourcing (mandatory) |

- CQ-27: If Event Sourcing is adopted, the write model MUST be event-sourced and the read model MUST be a projection (see Event Sourcing Standard).
- CQ-28: The decision to adopt Event Sourcing requires an ADR.

---

## 7. Observability

- CQ-29: Every command execution MUST emit a structured log with:
  - command name
  - correlationId
  - outcome (success/failure)
  - duration
- CQ-30: Metrics MUST include:
  - commands executed (count, by type)
  - command failure rate (by type)
  - queries executed (count, by type)
  - handler duration (p50/p95/p99)
- CQ-31: Slow handlers (above defined SLA threshold) MUST trigger observability alerts.

---

## 8. Stack Mapping

Each stack must implement CQRS following this standard. Implementation details vary by stack:

| Concern | Stack-specific guidance |
|---|---|
| Mediator / dispatcher | Stack architecture standard |
| Serialization | Data Contracts Standard |
| Validation framework | Stack architecture standard |
| Read model storage | Stack architecture standard |

- CQ-32: Stack-specific architecture standards MUST reference this document as the governing CQRS standard.

---

## 9. Anti-Patterns (Explicitly Forbidden)

### 9.1 Commands Returning Query Data
A command handler that returns a full entity or list.
**Fix:** return only the aggregate ID or operation result; issue a separate query.

### 9.2 Queries with Side Effects
A query handler that modifies state (e.g., incrementing a view counter, updating a last-accessed timestamp as a business concern).
**Fix:** use an explicit command for the side effect; keep queries pure.

### 9.3 Mixing Commands and Queries in One Handler
A single handler that both reads and mutates.
**Fix:** split into a command handler and a query handler.

### 9.4 Horizontal Handler Organization
All handlers in one folder, all commands in another (by technical type).
**Fix:** organize by use case — all artifacts for one operation in one place.

### 9.5 Raw Database Models Returned from Queries
Query handlers returning ORM entities directly to the API layer.
**Fix:** map to typed DTOs; infrastructure concerns must not leak upward.

---

## 10. Governance

- CQ-33: All new use cases MUST be implemented as explicit Commands or Queries — no ambiguous "service methods".
- CQ-34: Deviations from this standard require an ADR with justification.
- CQ-35: Compliance is verified in PR reviews.

---

## Summary

This standard makes CQRS a platform-wide pattern:

- **Commands** mutate state — one handler, validated, idempotent, side-effect controlled
- **Queries** read state — one handler, side-effect free, typed results
- **Organized by use case** — never by technical type
- **Applicable to all backend stacks**

Non-compliance is a blocking violation.
