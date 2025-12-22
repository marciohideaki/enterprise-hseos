# C# / .NET Architecture Standard
## State-of-the-Art Backend Architecture (Domain-Agnostic)

**Version:** 1.0  
**Status:** Canonical / Normative Standard  
**Stacks:** C# / .NET 9+  
**Applies to:** Any backend service built on the shared engineering standards

> This document defines the **mandatory architectural standard for C# / .NET backend systems**.
> It focuses exclusively on **structural, architectural and responsibility boundaries**.
>
> Quality attributes, runtime behavior, contracts and governance are defined in complementary standards explicitly referenced below.

---

## Referenced Platform Standards (MANDATORY)

This Architecture Standard **must be applied together with** the following canonical documents:

- **Naming & Conventions Standard** (Backend Profile)
- **Data Contracts & Schema Evolution Standard**
- **Code & API Documentation Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Deprecation & Sunset Policy**
- **Pull Request Checklist — Standard**

Failure to comply with any referenced standard is considered an architectural violation.

---

## 1. Core Architectural Principles

- CA-01: Architecture must be **domain-driven and explicit**.
- CA-02: Application structure must reflect **business capabilities**, not technical layers.
- CA-03: Dependencies must always point **inward**.
- CA-04: Frameworks and infrastructure are **details**, not drivers.
- CA-05: The architecture must remain stable under **team scaling and AI-assisted development**.

---

## 2. Bounded Contexts & Modularization

- CA-06: Each bounded context must be independently deployable.
- CA-07: Cross-context communication must occur via explicit contracts (events or APIs).
- CA-08: Shared code must be minimized and justified.

---

## 3. Service & Module Structure

A service must follow a **module-by-capability** structure:

```
/src
  /Modules
    /<Capability>
      /Application
      /Domain
      /Infrastructure
      /Api
```

- CA-09: Modules represent business capabilities.
- CA-10: Cross-module references are forbidden at the Domain level.

---

## 4. Layer Responsibilities

### 4.1 API Layer

- HTTP endpoints and transport concerns
- Input validation and contract enforcement
- No business logic

### 4.2 Application Layer

- Use cases and orchestration
- Transaction boundaries
- Coordination of domain and infrastructure

### 4.3 Domain Layer

- Entities, value objects and aggregates
- Domain services and invariants
- No framework or infrastructure dependencies

### 4.4 Infrastructure Layer

- Persistence
- Messaging
- External integrations
- Technical implementations

---

## 5. CQRS & Use Case Organization

- CA-11: Commands, queries, handlers and validators **must be grouped by use case**.
- CA-12: Use case folders are the primary unit of change.
- CA-13: No horizontal segregation by technical type (e.g., all handlers together).

---

## 6. Persistence & State Management

- CA-14: Relational databases are the **source of truth** for transactional state.
- CA-15: Read models may be materialized into non-relational stores.
- CA-16: Cache usage must follow **cache-aside with fallback** patterns.
- CA-17: Persistence concerns must never leak into the Domain layer.

---

## 7. Eventing & Integration

- CA-18: Domain events represent facts that already happened.
- CA-19: Integration events must be explicit and versioned.
- CA-20: Outbox pattern is mandatory for reliable event publication.

---

## 8. Networking & External Communication

- CA-21: All HTTP communication must use the **Core Networking Package (.NET)**.
- CA-22: Result-based error handling is mandatory; exceptions must not cross boundaries.

---

## 9. Documentation & Contracts

- CA-23: All public code must comply with the **Code & API Documentation Standard**.
- CA-24: All HTTP APIs must expose OpenAPI/Swagger in non-production environments.
- CA-25: API contracts are considered part of the architecture.

---

## 10. Governance & Enforcement

- CA-26: Architectural compliance is enforced via PR reviews.
- CA-27: Deviations require an approved ADR.
- CA-28: This document is the **single source of truth** for backend architecture.

---

## Summary

This Architecture Standard defines **how backend systems are structured**, not how features behave.

It ensures:
- long-term structural stability
- explicit boundaries
- safe evolution under scale and AI-assisted development

Non-compliance is a blocking violation.