# Java — Architecture Standard
## State-of-the-Art Backend Architecture (Domain-Agnostic)

**Version:** 1.0
**Status:** Canonical / Normative Standard
**Stack:** Java 21+ / Spring Boot 3+
**Applies to:** Any backend service built on the shared engineering standards

> This document defines the **mandatory architectural standard for Java backend systems**.
> It applies the Hexagonal & Clean Architecture Standard to the Java/Spring Boot stack.

---

## Referenced Platform Standards (MANDATORY)

- **Hexagonal & Clean Architecture Standard**
- **CQRS Standard**
- **Microservices Architecture Standard**
- **Naming & Conventions Standard** (Backend Profile)
- **Data Contracts & Schema Evolution Standard**
- **Code & API Documentation Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Resilience Patterns Standard**
- **Deprecation & Sunset Policy**

---

## 1. Core Architectural Principles

- JA-01: Architecture must be **domain-driven and explicit** — structure reflects business capabilities.
- JA-02: Dependencies must always point **inward** (Dependency Rule: Domain ← Application ← Infrastructure ← API).
- JA-03: Spring Boot is the **delivery mechanism**, not the architecture driver.
- JA-04: The Domain layer must be **framework-agnostic** — no Spring annotations in domain classes.
- JA-05: Architecture must remain stable under **team scaling and AI-assisted development**.

---

## 2. Module & Package Structure

Services use a **module-by-capability** structure with clean layer separation:

```
src/main/java/com/{company}/{service}/
  api/
    controller/
    contract/
      request/
      response/
    filter/
    advice/
  application/
    port/
      in/          ← driving ports (use case interfaces)
      out/         ← driven ports (repository, event publisher interfaces)
    usecase/
      {capability}/
        {UseCaseName}Command.java
        {UseCaseName}Handler.java
        {UseCaseName}Result.java
        {UseCaseName}Validator.java
  domain/
    model/
      aggregate/
      entity/
      valueobject/
    event/
    service/
    exception/
  infrastructure/
    persistence/
      repository/
      entity/
      mapper/
      migration/
    messaging/
      outbox/
      consumer/
      producer/
    readmodel/
      projection/
      store/
    cache/
    integration/
      client/
      adapter/
    security/
    observability/

src/test/java/com/{company}/{service}/
  domain/
  application/
  infrastructure/
  api/
```

- JA-06: Modules represent business capabilities — never technical roles.
- JA-07: Cross-module references at Domain level are forbidden.

---

## 3. Layer Responsibilities

### 3.1 API Layer
- REST controllers, request mapping, transport concerns
- Input validation at API boundary (Bean Validation / custom)
- DTO mapping (Request → Command/Query, Result → Response)
- Auth enforcement edge (no auth logic)
- Correlation ID propagation
- OpenAPI documentation annotations

### 3.2 Application Layer (Use Cases + Ports)
- **Ports In**: use case interfaces defining what the application offers
- **Ports Out**: interfaces defining what the application needs (repository, event publisher)
- Command/Query handlers — one handler per use case
- Transaction boundary management (`@Transactional` belongs here, not Domain)
- Orchestration of domain objects and infrastructure via ports

### 3.3 Domain Layer
- Aggregates, Entities, Value Objects
- Domain Services (stateless domain logic not owned by an aggregate)
- Domain Events
- Invariants enforced inside aggregate methods
- **Zero Spring dependencies** — pure Java only
- **Zero persistence annotations** — no `@Entity`, no JPA in domain

### 3.4 Infrastructure Layer
- JPA Entity classes (separate from Domain model — mapped via adapter)
- Spring Data Repository implementations of application ports
- Outbox implementation
- Kafka/RabbitMQ producers and consumers
- Read model projections
- Cache decorators (cache-aside)
- HTTP client adapters (Core Networking Package implementations)

---

## 4. CQRS & Use Case Organization

- JA-08: Commands, Queries, Handlers, Validators must be **grouped by use case**.
- JA-09: No horizontal grouping by technical type.
- JA-10: Use case handler interfaces defined as **Ports In**.
- JA-11: Each handler registered as a Spring `@Component` — wired without exposing Spring to callers.

---

## 5. Persistence & State Management

- JA-12: Relational database is the **source of truth** for transactional state.
- JA-13: JPA `@Entity` classes are **infrastructure** types — never exposed to Domain.
- JA-14: Domain objects and JPA entities are mapped explicitly in the Infrastructure layer.
- JA-15: Flyway or Liquibase mandatory for database migrations.
- JA-16: Read models may be materialized into non-relational stores.
- JA-17: Cache-aside pattern for read models.

---

## 6. Eventing & Messaging

- JA-18: Domain events represent facts — past tense, immutable.
- JA-19: Integration events are explicitly mapped from domain events and versioned.
- JA-20: Outbox Pattern is **mandatory** for reliable event publication.
- JA-21: Consumers must be **idempotent** — enforce via idempotency key.
- JA-22: Dead-letter handling mandatory for unrecoverable consumer failures.

---

## 7. Error Handling & Result Model

- JA-23: A typed `Result<T>` or sealed type hierarchy MUST be used at application boundaries.
- JA-24: Domain exceptions are caught at application layer and mapped to Result failures.
- JA-25: Infrastructure exceptions must not cross layer boundaries.
- JA-26: API layer maps Result to HTTP response codes and error envelope.
- JA-27: `RuntimeException` as control flow is forbidden.

---

## 8. Resilience

- JA-28: All external calls use the **Core Networking Package**.
- JA-29: Resilience4j or equivalent mandatory for circuit breakers, retries, and timeouts.
- JA-30: Configuration externalized — no hardcoded timeouts or retry counts.

---

## 9. Security

- JA-31: Spring Security mandatory for authentication and authorization.
- JA-32: OAuth2/OIDC resource server pattern for token validation.
- JA-33: Method-level security (`@PreAuthorize`) for fine-grained authz.
- JA-34: No `permitAll()` except on documented operational endpoints.

---

## 10. Observability

- JA-35: SLF4J + Logback or Log4j2 with structured JSON output (production).
- JA-36: Micrometer for metrics; expose via Actuator or Prometheus endpoint.
- JA-37: OpenTelemetry Java Agent or Micrometer Tracing for distributed tracing.
- JA-38: `correlationId` propagated via MDC across all log statements.

---

## 11. Governance & Enforcement

- JA-39: Compliance enforced via PR reviews and CI (Checkstyle, PMD, SpotBugs).
- JA-40: Deviations require an approved ADR.
- JA-41: This document is the **single source of truth** for Java backend architecture.

---

## Summary

This standard applies Clean/Hexagonal Architecture to Java/Spring Boot:
- Domain pure (no Spring, no JPA)
- Application owns use cases and ports
- Infrastructure wires Spring and frameworks
- Delivery (API) is a thin transport layer

Non-compliance is a blocking violation.
