# C# / .NET — Non-Functional Requirements (NFR)
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 2.1  
**Status:** Canonical / Normative (Supersedes v1.x and v2.0 drafts)  
**Scope:** Generic / Project-agnostic  
**Runtime:** .NET 9+

> This document defines **non-functional requirements** for modern C# / .NET backends.
> These are **not business requirements**. They specify *how the platform must behave* in terms of quality attributes.
>
> ⚠️ This version **restores and consolidates** the full Gold Standard requirement set, ensuring **no loss of rigor** while explicitly aligning with the platform-wide standards introduced later.

---

## Referenced Platform Standards (MANDATORY)

These NFRs must be applied together with:

- **C# / .NET Architecture Standard**
- **Naming & Conventions Standard** (Backend Profile)
- **Data Contracts & Schema Evolution Standard**
- **Code & API Documentation Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Deprecation & Sunset Policy**
- **Pull Request Checklist — Standard**

---

## 1. Performance

- NFR-01: The platform must maintain low and predictable latency for critical user-facing endpoints.
- NFR-02: The platform must provide defined latency budgets per endpoint category (critical, standard, background).
- NFR-03: The platform must avoid blocking calls on request threads; all IO must be asynchronous.
- NFR-04: The platform must support efficient pagination, filtering and sorting for read-heavy APIs.
- NFR-05: The platform must ensure projections and cache layers reduce load on the write database.

---

## 2. Scalability

- NFR-06: The platform must scale horizontally at the service/module level.
- NFR-07: Stateless API services are required for horizontal scalability.
- NFR-08: Background workers must scale independently from API nodes.
- NFR-09: Read models must scale independently from the write model.
- NFR-10: Cache layers must support high throughput with bounded resource usage.

---

## 3. Availability & Reliability

- NFR-11: The platform must support high availability through redundancy.
- NFR-12: The platform must continue operating under partial dependency failures (graceful degradation).
- NFR-13: No single dependency failure may crash the entire platform.
- NFR-14: Recovery time objectives (RTO) and recovery point objectives (RPO) must be defined and measurable.

---

## 4. Consistency & Data Integrity

- NFR-15: Strong consistency must be guaranteed inside aggregate transactions.
- NFR-16: Eventual consistency must be explicitly assumed across bounded contexts.
- NFR-17: Distributed transactions are forbidden; compensating actions must be used where necessary.
- NFR-18: Read models must tolerate replay and rebuilding without data loss.
- NFR-19: Cache must never be treated as a source of truth.

---

## 5. Resilience & Fault Tolerance

- NFR-20: All external calls must enforce timeouts.
- NFR-21: Retries must be bounded and apply only to transient failures.
- NFR-22: Circuit breakers must be used for unstable dependencies.
- NFR-23: Bulkhead isolation is required where one failing dependency could exhaust shared resources.
- NFR-24: Poison message handling must be supported via dead-letter queues.

---

## 6. Security

- NFR-25: All network communication must be encrypted in transit.
- NFR-26: Sensitive data must be encrypted at rest.
- NFR-27: Secrets must be externalized and rotated.
- NFR-28: Least privilege must be enforced for services, users and system components.
- NFR-29: Authentication and authorization must be centralized and policy-based.

---

## 7. Privacy & Compliance

- NFR-30: Personal data handling must follow applicable privacy regulations.
- NFR-31: Data minimization must be enforced.
- NFR-32: Logs must never contain PII or secrets.
- NFR-33: Audit trails must exist for security-relevant and financially-relevant operations.

---

## 8. Observability

- NFR-34: The platform must emit structured logs.
- NFR-35: The platform must expose metrics for technical and business flows.
- NFR-36: The platform must support distributed tracing end-to-end.
- NFR-37: Correlation IDs must propagate through APIs, messages and background jobs.
- NFR-38: SLIs and SLOs must be defined for critical flows.

---

## 9. Maintainability

- NFR-39: Code must follow Clean Architecture boundaries.
- NFR-40: Standards must be enforceable through reviews and tooling.
- NFR-41: Architectural deviations require ADR approval.
- NFR-42: Changes must be localized and minimize blast radius.

---

## 10. Testability

- NFR-43: Domain and application logic must be unit-testable.
- NFR-44: Infrastructure must be integration-testable.
- NFR-45: APIs and event contracts must be contract-testable.
- NFR-46: Tests must be deterministic and runnable in CI.

---

## 11. Deployability & Backward Compatibility

- NFR-47: Deployments must be backward compatible.
- NFR-48: Database migrations must follow expand–contract patterns.
- NFR-49: Events must remain backward compatible; breaking changes require new event types.
- NFR-50: Rollbacks must be safe and documented.

---

## 12. Operability

- NFR-51: The platform must provide liveness and readiness probes.
- NFR-52: Configuration must be environment-aware.
- NFR-53: Safe startup and shutdown semantics must be ensured.
- NFR-54: Runbooks must exist for common incident scenarios.

---

## 13. Cost Efficiency

- NFR-55: Resource usage must be observable and cost-aware.
- NFR-56: Cache, read models and workers must be right-sized.
- NFR-57: High-cost operations must be identified and optimized.

---

## 14. AI-Assisted Engineering

- NFR-58: AI-generated code must comply with architecture, persistence and messaging rules.
- NFR-59: AI usage must not bypass security or quality gates.
- NFR-60: AI-assisted workflows must be auditable.
- NFR-61: Templates and scaffolding must exist to reduce ambiguity for AI.

---

## 15. Code & API Documentation (ADDITIVE)

- FR-NEW-01: All public classes, methods and APIs **must be documented** according to the Code & API Documentation Standard.
- FR-NEW-02: All HTTP APIs **must expose OpenAPI/Swagger** in development and staging environments.

---

## 16. Data Contracts & Schema Evolution (ADDITIVE)

- FR-NEW-03: All API DTOs **must tolerate missing and unknown fields**.
- FR-NEW-04: All enums exposed via APIs or events **must define an explicit `Unknown` value**.
- FR-NEW-05: Contract-breaking changes **must result in new API or event versions**.

---

## 17. Core Networking Package Usage (ADDITIVE)

- FR-NEW-06: All outbound HTTP communication **must go through the Core Networking Package (.NET)**.
- FR-NEW-07: No feature or module may perform direct HTTP calls outside the networking abstraction.

---

## 18. AI-Assisted Engineering (ADDITIVE)

- FR-NEW-08: The platform **must provide templates and scaffolding** to constrain AI-generated code.
- FR-NEW-09: AI-generated code **must follow CQRS, persistence and messaging rules** defined in this FR.

---

## 19. OpenAPI as Functional Artifact (ADDITIVE)

- FR-NEW-10: OpenAPI specifications **must be treated as versioned artifacts** generated from the codebase.
- FR-NEW-11: API changes **must update the OpenAPI contract in the same change set**.

---

## Summary

These Functional Requirements define the **technical behavior and obligations** of C# / .NET backend platforms.

The additive sections (15–19) extend the original FR set **without removing or altering any existing requirement**, ensuring alignment with newer platform standards while preserving full backward traceability.