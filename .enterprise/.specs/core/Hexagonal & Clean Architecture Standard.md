# Hexagonal Architecture & Clean Architecture Standard
## Structural Foundation for All Backend Services (Technology-Agnostic)

**Version:** 1.0
**Status:** Active — Core Standard
**Scope:** All backend services across all technology stacks
**Applies to:** C# / .NET, Java, Go, PHP, C++, and any future backend stack

> This document formally defines the structural and dependency model that all backend services MUST follow.
> It names and governs the pattern already implicit in stack-specific architecture standards.
> Stack-specific documents apply this standard; they do not override it.

---

## Referenced Standards (MANDATORY)

This standard is foundational and must be applied together with:

- **Enterprise Constitution**
- **Architecture Boundaries Policy**
- **DDD Boundary Check (Skill)**
- **CQRS Standard**
- **Data Contracts & Schema Evolution Standard**
- **Security & Identity Standard**
- **Observability Playbook**

---

## 1. Core Principles

- HA-01: The **domain model is the center** of the system. All dependencies point inward toward it.
- HA-02: Frameworks, databases, and transport mechanisms are **details** — they must not drive architecture.
- HA-03: The system must be **testable in isolation**: the domain and application layers must run without infrastructure.
- HA-04: **Ports define contracts**; adapters fulfill them. The inside never knows the outside.
- HA-05: Architecture must remain stable as the team scales and as AI-assisted development increases.

---

## 2. The Layered Model

All backend services MUST be structured around four concentric zones:

```
┌────────────────────────────────────────────┐
│              Delivery / API                │  ← External facing (HTTP, gRPC, CLI, Queue)
│  ┌──────────────────────────────────────┐  │
│  │           Infrastructure             │  │  ← Adapters (DB, Broker, HTTP Client, Cache)
│  │  ┌────────────────────────────────┐  │  │
│  │  │         Application            │  │  │  ← Use Cases, Ports, Orchestration
│  │  │  ┌──────────────────────────┐  │  │  │
│  │  │  │         Domain           │  │  │  │  ← Entities, Aggregates, Domain Events, Rules
│  │  │  └──────────────────────────┘  │  │  │
│  │  └────────────────────────────────┘  │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### 2.1 Domain Layer
- Entities, Aggregates, Value Objects
- Domain Events
- Domain Services (stateless logic not owned by an entity)
- Invariants and business rules
- **Zero external dependencies** — no frameworks, no IO, no infrastructure

### 2.2 Application Layer
- Use cases (commands and queries)
- **Ports (interfaces/abstractions)** — the outward-facing contracts the Application defines
- Orchestration of domain objects
- Transaction boundary ownership
- Event publishing (via port, not direct)

### 2.3 Infrastructure Layer
- **Adapters** — concrete implementations of Application ports
- Persistence (repositories, ORM mapping)
- Message broker clients (publishers, consumers)
- External HTTP integrations
- Caching adapters
- Observability emitters

### 2.4 Delivery / API Layer
- HTTP controllers / gRPC handlers / CLI entry points / Queue consumers
- Input deserialization and validation
- Output serialization
- Auth enforcement edge (not auth logic)
- No business logic

---

## 3. Ports & Adapters (Hexagonal Core)

### 3.1 Ports (Driven by Application)
A **Port** is an interface defined in the Application layer that describes what the domain needs from the outside world.

Examples:
- `IOrderRepository` — data persistence
- `IPaymentGateway` — payment processing
- `IEventPublisher` — domain event dispatch
- `IEmailService` — notification delivery

Rules:
- HA-06: Ports MUST be defined in the Application layer.
- HA-07: Port interfaces MUST use domain language, not infrastructure language.
- HA-08: A port MUST NOT expose infrastructure types (e.g., no `DbConnection`, no `HttpClient`).

### 3.2 Adapters (Provided by Infrastructure)
An **Adapter** is a concrete implementation of a Port, living in the Infrastructure layer.

Rules:
- HA-09: Adapters MUST live in the Infrastructure layer.
- HA-10: Adapters MUST implement Application ports, not be depended on directly by Application.
- HA-11: Adapters MUST NOT contain business logic.

### 3.3 Primary Adapters (Driving Side)
Delivery / API layer components (controllers, consumers) are **primary adapters** — they drive the application.

Rules:
- HA-12: Primary adapters MUST call Application use cases, never Domain objects directly.
- HA-13: Primary adapters MUST NOT contain orchestration or business logic.

---

## 4. Dependency Rules (Non-Negotiable)

### 4.1 Allowed Dependencies

| From | May depend on |
|---|---|
| Domain | Nothing (pure) |
| Application | Domain only (via abstractions for outside) |
| Infrastructure | Application (ports), Domain (mapping only) |
| Delivery/API | Application (use cases) |

### 4.2 Forbidden Dependencies

- HA-14: Domain → Infrastructure (any direction is forbidden)
- HA-15: Domain → Application
- HA-16: Domain → Delivery/API
- HA-17: Application → Infrastructure concrete implementations
- HA-18: Application → Delivery/API concerns

---

## 5. Clean Architecture Alignment

This standard is fully compatible with Clean Architecture (Robert C. Martin).

The mapping is explicit:

| Clean Architecture | This Standard |
|---|---|
| Entities | Domain Layer (Aggregates, Entities, Value Objects) |
| Use Cases | Application Layer (Commands, Queries, Handlers) |
| Interface Adapters | Infrastructure Layer + Delivery/API Layer |
| Frameworks & Drivers | Infrastructure adapters (DB, Broker, HTTP) |

Rules:
- HA-19: The **Dependency Rule** is inviolable: source code dependencies must point inward only.
- HA-20: Inner layers MUST NOT know about outer layers by name or reference.

---

## 6. Testability Requirements

The architecture must enable independent testing of each layer:

- HA-21: Domain layer must be unit-testable with **no mocks** (pure functions and domain logic only).
- HA-22: Application layer must be unit-testable by **mocking ports** (no infrastructure needed).
- HA-23: Infrastructure adapters must be integration-testable against real dependencies.
- HA-24: Delivery/API layer must be testable via **contract tests** and **integration tests**.

---

## 7. Folder Structure Convention

Each stack must map its folder structure to this model. The canonical mapping:

```
src/
  <module-or-feature>/
    domain/          → Domain Layer
    application/     → Application Layer (use cases + ports)
    infrastructure/  → Infrastructure Layer (adapters)
    api/             → Delivery Layer (controllers, consumers)
```

Stack-specific naming conventions may differ (e.g., `data/` instead of `infrastructure/` in Flutter/RN) but the responsibility boundaries MUST match.

- HA-25: Each stack architecture standard MUST explicitly document how its folder structure maps to this model.

---

## 8. Anti-Patterns (Explicitly Forbidden)

### 8.1 Anemic Domain Model
Business rules scattered across services, controllers, or application handlers instead of living in domain objects.
**Fix:** move invariants and rules into aggregates and domain services.

### 8.2 Smart Controllers
Controllers that contain orchestration or business logic.
**Fix:** move logic to application use case handlers; controllers only translate input/output.

### 8.3 Domain Depending on Infrastructure
Domain entities importing ORMs, serializers, or broker clients.
**Fix:** use infrastructure adapters and ports; keep domain pure.

### 8.4 Fat Application Services
Application layer becoming a procedural script that bypasses domain.
**Fix:** orchestrate domain objects; let domain enforce invariants.

### 8.5 Leaking Infrastructure Types into Application
Application ports defined using infrastructure types (e.g., `IDbConnection`, Kafka types).
**Fix:** define ports in domain language; infrastructure maps internally.

---

## 9. Governance & Enforcement

- HA-26: Compliance is verified in PR reviews using `ddd-boundary-check`.
- HA-27: Any deviation requires an ADR with justification and expiry.
- HA-28: Stack-specific architecture standards MUST reference this document.
- HA-29: This standard is the single source of truth for structural patterns.

---

## Summary

This standard formally defines the architectural structure for all backend services:

- **Hexagonal Architecture**: Ports & Adapters isolating the domain from infrastructure
- **Clean Architecture**: Dependency Rule enforcing inward-pointing dependencies

Together they guarantee:
- domain purity and testability
- infrastructure replaceability
- safe evolution under team growth and AI-assisted development

Non-compliance is a blocking violation.
