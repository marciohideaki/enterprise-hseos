# Microservices Architecture Standard
## Service Design, Boundaries, Communication and Governance (Technology-Agnostic)

**Version:** 1.0
**Status:** Active — Core Standard
**Scope:** All systems composed of independently deployable services
**Applies to:** All backend stacks (C# / .NET, Java, Go, PHP, C++)

> This standard defines mandatory rules for designing, decomposing, and operating microservices.
> It complements DDD boundary rules with explicit service-level governance.

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Architecture Boundaries Policy**
- **Hexagonal & Clean Architecture Standard**
- **CQRS Standard**
- **Event Sourcing Standard** (when applicable)
- **Saga Pattern Standard** (when applicable)
- **Data Contracts & Schema Evolution Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Resilience Patterns Standard**

---

## 1. Core Principles

- MS-01: A service owns its domain completely — **data, logic, and API surface**.
- MS-02: Services must be **independently deployable** without coordinating releases with other services.
- MS-03: Services communicate via **explicit contracts** only — never through shared databases or internal code.
- MS-04: Services must be **resilient by default** — designed to operate degraded when dependencies fail.
- MS-05: Operational simplicity is a first-class concern — services must be observable, debuggable, and deployable by any team member.

---

## 2. Service Boundaries

### 2.1 Default Rule
- MS-06: By default, **one Bounded Context = one deployable service**.
- MS-07: A service may contain multiple modules if they share a deployment unit and are cohesive (macro-service / modular monolith within a BC). This must be explicitly documented.

### 2.2 When to Split a Service
Split a service when:
- it has **independent scaling requirements** different from its cohabitants
- it has **independent release cadence** requirements
- it represents a **distinct bounded context** with its own ubiquitous language
- **team ownership boundaries** require separation

### 2.3 When NOT to Split
Do not split a service for:
- technical reasons alone (e.g., "it uses a different database")
- organizational pressure without BC justification
- performance without profiling evidence

All splits require an ADR.

---

## 3. Data Ownership

- MS-08: Each service owns its **persistence exclusively**. No other service may read or write to it directly.
- MS-09: Shared databases are **forbidden**. Each service must have its own schema or database instance.
- MS-10: Read models consumed from other services must be **local copies** maintained via events (eventual consistency is acceptable and expected).
- MS-11: A service must document its **data ownership boundary** explicitly in its architecture spec.

---

## 4. Inter-Service Communication

### 4.1 Asynchronous (Preferred)
- MS-12: Prefer **asynchronous event-driven communication** for decoupling services.
- MS-13: Events must be published via the **Outbox Pattern** to guarantee delivery.
- MS-14: Consumers must be **idempotent** — duplicate delivery must not cause incorrect state.
- MS-15: Events are **public contracts** and must follow the Data Contracts & Schema Evolution Standard.

### 4.2 Synchronous (Use with Caution)
- MS-16: Synchronous inter-service calls are acceptable for **query flows** where real-time data is required.
- MS-17: Synchronous calls MUST use a typed client with **timeouts, retries, and circuit breaker** (see Resilience Patterns Standard).
- MS-18: Synchronous calls in **write/command flows** must be justified by ADR — prefer sagas or async alternatives.
- MS-19: Circular synchronous dependencies between services are **forbidden**.

### 4.3 Anti-Corruption Layer (ACL)
- MS-20: When consuming another service's contract, a consuming service MUST map it to its own domain model via an **Anti-Corruption Layer**.
- MS-21: ACL adapters live in the Infrastructure layer of the consuming service.

---

## 5. API Surface Rules

- MS-22: Each service exposes a **versioned public API** (HTTP REST, gRPC, or event schema) as its contract.
- MS-23: Internal implementation details must not be exposed in the API surface.
- MS-24: APIs must follow the **Data Contracts & Schema Evolution Standard** for versioning and backward compatibility.
- MS-25: Breaking changes in APIs require a **new API version** and a deprecation plan.
- MS-26: Each service must expose the following operational endpoints (unauthenticated):
  - `GET /health` — liveness check
  - `GET /ready` — readiness check
  - `GET /metrics` — observability (when applicable)

---

## 6. Service Autonomy Requirements

Each service must be fully operable in isolation:

- MS-27: The service must be **startable without other services** (use test doubles / stubs for integration tests).
- MS-28: The service must have its own **CI/CD pipeline** independent of other services.
- MS-29: The service must have its own **versioning and release cadence**.
- MS-30: Configuration must follow **externalized config** — no hardcoded service addresses or credentials.
- MS-31: Service-to-service URLs and identifiers must come from **configuration or service discovery**, never hardcoded.

---

## 7. Service-to-Service Security

- MS-32: All inter-service calls MUST be authenticated (mTLS or signed tokens — see Security & Identity Standard SI-18).
- MS-33: Internal services are NOT implicitly trusted.
- MS-34: Each service must validate the caller's identity and authorization for every request.
- MS-35: Network segmentation must exist between services (no flat internal network trust).

---

## 8. Observability Requirements

Each service MUST implement:

- MS-36: Structured logging with `correlationId`, `service`, `environment`, `traceId` (see Observability Playbook).
- MS-37: Distributed tracing propagation — accept and forward trace context headers.
- MS-38: Standard metrics: request rate, error rate, latency (p50/p95/p99), dependency error rates.
- MS-39: Alerting baseline as defined in the Observability Playbook.

---

## 9. Deployment & Versioning

- MS-40: Each service must be **containerized** (Docker or equivalent) for consistent deployment.
- MS-41: Services must support **rolling deployments** without downtime (backward-compatible contracts mandatory).
- MS-42: Blue-Green or Canary strategies are recommended for high-risk changes.
- MS-43: Each deployable artifact must be **immutably versioned** (semantic versioning recommended).

---

## 10. Service Documentation Requirements

Each service must maintain:

- MS-44: A `README` or equivalent describing the service's domain responsibility.
- MS-45: Architecture spec referencing this standard and the applicable stack standard.
- MS-46: Published API contract (OpenAPI, Proto, or event schema).
- MS-47: Runbooks for incident response (auth outage, dependency failure, data corruption scenarios).

---

## 11. Anti-Patterns (Explicitly Forbidden)

### 11.1 Shared Database
Multiple services reading/writing to the same database.
**Fix:** each service owns its data; sync via events or APIs.

### 11.2 Distributed Monolith
Services that are deployed separately but are tightly coupled at runtime (shared state, synchronous chains).
**Fix:** decouple via events; apply Saga Pattern for cross-service flows.

### 11.3 Chatty Synchronous Chains
Service A calls B which calls C which calls D synchronously for every request.
**Fix:** async messaging, pre-computed local read models, or API composition at a BFF layer.

### 11.4 Implicit Trust Between Services
Internal services accepting calls without authentication.
**Fix:** enforce mTLS or signed tokens for all inter-service communication.

### 11.5 Hardcoded Service Addresses
Service URLs or IPs embedded in application code.
**Fix:** externalized configuration or service discovery.

---

## 12. Governance

- MS-48: New services require an **ADR** documenting BC justification and boundary definition.
- MS-49: Inter-service coupling changes require an **ADR**.
- MS-50: Compliance is verified in PR reviews and enforced via CI gates.

---

## Summary

This standard defines how microservices must be designed, bounded, and operated:

- **One BC = One deployable service** (by default)
- **Data ownership is exclusive** — no shared databases
- **Communication via explicit contracts** — events preferred, sync requires justification
- **Autonomous, resilient, observable** by default

Non-compliance is a blocking violation.
