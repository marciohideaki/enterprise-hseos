# Saga Pattern Standard
## Distributed Transaction Coordination (Technology-Agnostic)

**Version:** 1.0
**Status:** Active — Core Standard
**Scope:** Multi-service workflows requiring coordinated state changes
**Applies to:** All backend stacks (C# / .NET, Java, Go, PHP, C++)

> A Saga coordinates a long-running business process across multiple services or aggregates
> without distributed locking or 2-phase commit.
> This standard defines mandatory rules for designing, implementing, and operating Sagas.

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Hexagonal & Clean Architecture Standard**
- **Microservices Architecture Standard**
- **CQRS Standard**
- **Data Contracts & Schema Evolution Standard**
- **Resilience Patterns Standard**
- **Observability Playbook**

---

## 1. Core Principles

- SG-01: A Saga coordinates a multi-step process by **sequencing local transactions** — each step is a local, atomic operation within its own service.
- SG-02: There is **no distributed lock** and no 2-phase commit — consistency is achieved through explicit coordination and compensation.
- SG-03: Every Saga step MUST have a **compensating transaction** — an operation that undoes the effect of that step if a subsequent step fails.
- SG-04: Sagas operate in **eventual consistency** — intermediate states are visible and must be designed for.
- SG-05: Sagas MUST be idempotent at every step — duplicate delivery of messages must not cause incorrect state.
- SG-06: Every Saga instance MUST be observable from start to finish.

---

## 2. When to Use Sagas

**Use Sagas when:**
- A business process spans **multiple bounded contexts or services**
- Each step requires a local transaction in its own service
- The process must be **eventually consistent** (2PC is not an option)
- Business failure scenarios require **compensating actions** (rollback of prior steps)

**Do NOT use Sagas when:**
- The entire operation can be performed within **one bounded context** (use a single transaction instead)
- The operation is **read-only**
- A simple event publication suffices (no compensation needed)

**Adoption requires an ADR** documenting the business process, the saga type chosen, and the compensation strategy.

---

## 3. Saga Types

### 3.1 Choreography-Based Saga

Each service reacts to events published by the previous step and decides its own action.

```
Service A ──[Event: StepACompleted]──► Service B ──[Event: StepBCompleted]──► Service C
                                           │
                                    (failure) ──[Event: StepBFailed]──► Service A (compensate)
```

**Use Choreography when:**
- The workflow has **few steps** (2–4)
- Steps are **loosely coupled** with no central coordination logic
- The team wants **minimal infrastructure** (no orchestrator needed)

**Risks:**
- Harder to track the overall saga state
- Compensation flows become complex as steps increase
- Difficult to understand the full flow from the codebase alone

### 3.2 Orchestration-Based Saga

A central Saga Orchestrator sends commands to each participant and reacts to their responses.

```
Orchestrator ──[Command: ExecuteStepA]──► Service A ──[Event: StepACompleted]──► Orchestrator
Orchestrator ──[Command: ExecuteStepB]──► Service B ──[Event: StepBFailed]──►    Orchestrator
Orchestrator ──[Command: CompensateA]──►  Service A
```

**Use Orchestration when:**
- The workflow has **many steps** (5+) or complex branching
- **Central visibility** of saga state is required
- Business rules for sequencing and compensation are complex
- Monitoring and recovery must be centralized

**Risks:**
- Orchestrator becomes a coordination bottleneck if not designed carefully
- Requires dedicated orchestrator infrastructure (state machine, persistence)

### 3.3 Choosing Between Choreography and Orchestration

| Criteria | Choreography | Orchestration |
|---|---|---|
| Number of steps | ≤ 4 | 5+ |
| Compensation complexity | Simple | Complex |
| Observability needs | Low | High |
| Central state required | No | Yes |
| Infrastructure overhead | Low | Medium |

**The choice must be documented in the ADR.**

---

## 4. Compensating Transactions

- SG-07: Every forward step in a saga MUST have a **defined compensating action**.
- SG-08: Compensating transactions MUST be **idempotent** — they may be executed more than once.
- SG-09: Compensating transactions MUST NOT fail silently — failures in compensation require immediate alerting and manual intervention runbook.
- SG-10: Compensation is **not a simple rollback** — it is a new forward action that logically undoes a previous step (because intermediate state may have been visible).
- SG-11: Compensation strategy MUST be documented in the Saga specification.

### 4.1 Compensation Map (Required for Every Saga)

For each saga, the following must be documented:

| Step | Forward Action | Compensating Action | Idempotency Key |
|---|---|---|---|
| 1 | ReserveInventory | ReleaseInventoryReservation | orderId |
| 2 | ChargePayment | RefundPayment | orderId + paymentRef |
| 3 | CreateShipment | CancelShipment | orderId + shipmentId |

---

## 5. Saga State Management

### 5.1 For Orchestration-Based Sagas
- SG-12: The Saga Orchestrator MUST persist its state (current step, input data, correlation IDs) durably.
- SG-13: Saga state MUST be stored in the **orchestrating service's own persistence** — not shared with participant services.
- SG-14: Saga state MUST include:
  - `sagaId` — unique identifier for this saga instance
  - `correlationId` — end-to-end trace identifier
  - `currentStep` — current execution position
  - `status` — `Running`, `Compensating`, `Completed`, `Failed`
  - `startedAt`, `updatedAt`, `completedAt`
  - `payload` — original saga input
  - `stepHistory` — log of completed steps and outcomes

### 5.2 For Choreography-Based Sagas
- SG-15: Each participant service MUST be able to determine **its own state** within the saga from its local data.
- SG-16: A correlation identifier (sagaId / correlationId) MUST be propagated in all events related to the same saga instance.

---

## 6. Idempotency Requirements

- SG-17: Every saga participant MUST process events and commands **idempotently** — duplicate delivery must not cause incorrect state.
- SG-18: Idempotency MUST be enforced using an **idempotency key** tracked per operation.
- SG-19: Idempotency keys MUST be persisted with a TTL appropriate to the saga's expected duration plus buffer.
- SG-20: The orchestrator MUST not re-send commands without idempotency keys.

---

## 7. Messaging and Reliability

- SG-21: All saga messages (commands and events) MUST be delivered via a **reliable message broker** (not in-process calls).
- SG-22: Event publication from saga participants MUST use the **Outbox Pattern** to guarantee at-least-once delivery.
- SG-23: Command dispatch from the orchestrator MUST use durable queuing.
- SG-24: Message consumers (saga participants) MUST be able to process messages out of order **or** enforce ordering via sequencing mechanisms.

---

## 8. Timeout and Failure Handling

- SG-25: Every saga step MUST have a **maximum wait timeout** — a step that does not respond within the timeout triggers compensation.
- SG-26: Timeout behavior MUST be explicitly defined:
  - retry the step (if idempotent and transient failure)
  - OR begin compensation (if timeout is unrecoverable)
- SG-27: Compensation failures (a compensating action fails) MUST:
  - emit an alert
  - persist the failure state in saga log
  - trigger escalation to a human operator runbook
- SG-28: Permanently failed sagas (compensation exhausted) MUST be surfaced in a **dead letter / manual intervention queue** with full context for resolution.

---

## 9. Observability Requirements

Each Saga instance MUST be fully traceable:

- SG-29: All saga steps MUST include `sagaId` and `correlationId` in logs, metrics, and traces.
- SG-30: **Metrics required:**
  - saga instances started (by saga type)
  - saga instances completed successfully (by saga type)
  - saga instances entering compensation (by saga type)
  - saga instances permanently failed (by saga type)
  - step duration (p50/p95/p99, by saga type and step)
  - compensation activations (count, by step)

- SG-31: **Alerts required:**
  - saga permanently failed
  - compensation failure (any step)
  - saga running beyond expected SLA duration

- SG-32: For orchestration sagas, a **saga state dashboard** is recommended to show current state of in-flight instances.

---

## 10. Saga Specification Document (Required)

Every saga MUST be documented before implementation:

- SG-33: A saga specification MUST include:
  - Business process description
  - Saga type (choreography / orchestration) with justification
  - Participant services and their responsibilities
  - Step-by-step sequence (forward and compensation)
  - Compensation Map (see section 4.1)
  - Timeout per step
  - Idempotency key strategy
  - Failure and escalation policy
  - Observability requirements

- SG-34: The saga specification lives under `.specs/decisions/` as an ADR or as a companion document referenced by the ADR.

---

## 11. Testing Requirements

- SG-35: Saga **happy path** must be covered by integration tests.
- SG-36: Saga **compensation path** must be covered by integration tests — failure at each step must be simulated.
- SG-37: **Idempotency** must be tested — duplicate events/commands must not cause incorrect state.
- SG-38: **Timeout-triggered compensation** must be tested.
- SG-39: Saga tests MUST run in an environment with realistic message broker behavior (not in-process mocks).

---

## 12. Anti-Patterns (Explicitly Forbidden)

### 12.1 Distributed 2-Phase Commit
Using two-phase commit or distributed locks instead of Sagas.
**Fix:** decompose into local transactions with compensation.

### 12.2 Saga Without Compensation
Designing a saga where failure of a later step leaves earlier steps permanently applied without rollback.
**Fix:** every step must have a defined compensating action.

### 12.3 Synchronous Saga Steps
Implementing saga steps as synchronous chained HTTP calls.
**Fix:** use async messaging (events/commands via broker) for all saga steps.

### 12.4 Shared State Between Participants
Saga participants sharing a database or directly reading each other's state.
**Fix:** each participant operates on its own data; communicate only via events and commands.

### 12.5 Non-Idempotent Participants
Saga participants that fail or corrupt state when they receive duplicate messages.
**Fix:** enforce idempotency keys on every participant command/event handler.

### 12.6 Silent Compensation Failures
Compensation failures logged and ignored.
**Fix:** compensation failures require alerting, runbook escalation, and manual resolution.

---

## 13. Governance

- SG-40: Every new Saga requires an **ADR** documenting justification, type, and compensation strategy.
- SG-41: Changes to an existing Saga's flow or compensation map require an **ADR** (breaking change to distributed process).
- SG-42: Compliance is verified in PR reviews.
- SG-43: Sagas without documented compensation maps MUST NOT be approved for production.

---

## Summary

This standard defines how distributed business processes are coordinated:

| Concern | Rule |
|---|---|
| **Type** | Choreography (≤4 steps) or Orchestration (5+, complex) |
| **Compensation** | Mandatory for every step — no exceptions |
| **Idempotency** | Mandatory for every participant |
| **Messaging** | Reliable broker + Outbox Pattern |
| **Observability** | Full trace per instance, metrics per step |
| **Failures** | Alert + runbook for compensation failures |

Non-compliance is a blocking violation.
