# PHP — Architecture Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** Generic / Project-agnostic
**Runtime:** PHP 8.3+ / Laravel 11+ or Symfony 7+

> Defines the mandatory architectural standard for PHP backend services.
> Complies with the Hexagonal & Clean Architecture Standard and DDD Standard.

---

## 1. Layer Model

```text
┌─────────────────────────────────────────────────────┐
│                    API Layer                         │
│  (Controllers, Requests, Resources, Middleware)      │
├─────────────────────────────────────────────────────┤
│                Application Layer                     │
│  (Use Cases, Port Interfaces, DTOs, Validators)      │
├─────────────────────────────────────────────────────┤
│                  Domain Layer                        │
│  (Aggregates, Value Objects, Domain Events,          │
│   Domain Services, Repository Interfaces)            │
├─────────────────────────────────────────────────────┤
│               Infrastructure Layer                   │
│  (Eloquent/Doctrine Entities, Adapters, Clients,     │
│   Messaging, Cache, Config)                          │
└─────────────────────────────────────────────────────┘
```

**Dependency Rule:** Dependencies point inward only. Domain has zero external dependencies.

---

## 2. Rules

### 2.1 Domain Layer
- PA-01: Domain classes must have zero framework dependencies (no Laravel/Symfony facades, annotations, or base classes).
- PA-02: Domain entities are plain PHP objects — not Eloquent models.
- PA-03: Value Objects must be immutable — PHP 8.2+ `readonly class`.
- PA-04: Aggregates enforce all business invariants internally.
- PA-05: Repository contracts (interfaces) live in Domain — implementations in Infrastructure.
- PA-06: Domain Events are immutable value objects (`readonly class`).

### 2.2 Application Layer
- PA-07: Application layer orchestrates use cases via Port interfaces only.
- PA-08: Use case handlers must not reference Eloquent models or infrastructure types directly.
- PA-09: Each use case has a Command/Query + Handler + Result.
- PA-10: Transaction boundaries belong in Application layer handlers.
- PA-11: Application layer may use framework DI container — but only to resolve Port interfaces.
- PA-12: Validation occurs in Application layer before domain logic executes.

### 2.3 Infrastructure Layer
- PA-13: Eloquent models live exclusively in Infrastructure.
- PA-14: Mapping between Eloquent models and Domain entities is mandatory and explicit.
- PA-15: Repository adapters implement Domain repository interfaces.
- PA-16: All external HTTP integrations use the Core Networking Package.
- PA-17: Infrastructure exceptions must be caught and mapped before crossing layer boundaries.
- PA-18: Event publishing adapters implement Application port interfaces.

### 2.4 API Layer
- PA-19: Controllers are thin — delegate to Application layer use cases immediately.
- PA-20: Request classes handle HTTP input validation (Laravel `FormRequest` or Symfony constraints).
- PA-21: API Resources/Transformers handle response shaping — no domain logic.
- PA-22: URL path versioning mandatory: `/api/v1/`, `/api/v2/`.
- PA-23: All endpoints require authorization by default.
- PA-24: `X-Correlation-Id` header propagated on all requests.

---

## 3. Module / Namespace Structure

```text
App\
  Api\
    Controller\
      {Feature}Controller.php
    Request\
      {UseCaseName}Request.php
    Resource\
      {UseCaseName}Resource.php
    Middleware\
      CorrelationIdMiddleware.php
  Application\
    Port\
      In\
        {UseCaseName}UseCase.php          ← interface
      Out\
        {Feature}Repository.php           ← interface
        {Feature}EventPublisher.php       ← interface
    UseCase\
      {Feature}\
        {UseCaseName}Command.php
        {UseCaseName}Handler.php
        {UseCaseName}Result.php
        {UseCaseName}Validator.php
    Shared\
      Result\
        Result.php
        AppError.php
  Domain\
    Model\
      {Feature}.php                       ← Aggregate root
      {Feature}Id.php                     ← Value Object (readonly class)
    Event\
      {FactName}.php                      ← Domain Event (readonly class)
    Service\
      {Feature}DomainService.php
    Exception\
      {Feature}Exception.php
  Infrastructure\
    Persistence\
      Eloquent\
        {Feature}Model.php               ← Eloquent model
        {Feature}RepositoryAdapter.php   ← implements Port Out
        {Feature}Mapper.php
    Messaging\
      Outbox\
        OutboxMessage.php
        OutboxDispatcher.php
      Consumer\
        {EventName}Consumer.php
      Producer\
        {Feature}EventPublisherAdapter.php
    Cache\
      {Feature}CacheDecorator.php
    Integration\
      Client\
        {ExternalService}NetworkClient.php
      Adapter\
        {ExternalService}Adapter.php
    Config\
      AppServiceProvider.php
```

---

## 4. CQRS

- PA-25: Commands modify state; Queries return data only.
- PA-26: Query handlers must not trigger side effects.
- PA-27: Read models (projections) served from optimized read store where applicable.
- PA-28: No `INSERT`/`UPDATE`/`DELETE` inside query handlers.

---

## 5. Event-Driven / Outbox

- PA-29: Domain events published via Outbox Pattern — atomic with write transaction.
- PA-30: Outbox dispatcher runs as background job.
- PA-31: Event consumers must be idempotent.
- PA-32: Dead-letter handling required for consumers.

---

## 6. Persistence

- PA-33: Migrations use Laravel Migrations or Doctrine Migrations.
- PA-34: Migrations follow expand-contract pattern.
- PA-35: No raw SQL in Domain or Application layers.
- PA-36: Database-level constraints mirror domain invariants.

---

## 7. Resilience

- PA-37: All outbound HTTP calls use the Core Networking Package.
- PA-38: Timeout, retry, and circuit breaker policies externalized in config.
- PA-39: No hardcoded timeout or retry values.

---

## 8. Testing

- PA-40: Domain logic unit-testable with PHPUnit — zero framework dependencies required.
- PA-41: Application handlers unit-testable with mocked port interfaces.
- PA-42: Infrastructure adapters covered by integration tests (SQLite in-memory or Testcontainers).
- PA-43: API layer tested via Laravel HTTP tests or Symfony WebTestCase.

---

## 9. Static Analysis & Quality

- PA-44: PHPStan at level 8+ (or Psalm equivalent) enforced in CI.
- PA-45: PSR-12 code style enforced via PHP_CodeSniffer or PHP-CS-Fixer.
- PA-46: Architecture rules enforced via Deptrac or PHPArkitect.
- PA-47: No suppressed analysis errors without documented justification.

---

## 10. PSR Compliance

- PA-48: PSR-1 Basic Coding Standard.
- PA-49: PSR-4 Autoloading Standard — namespace maps to directory.
- PA-50: PSR-12 Extended Coding Style.
- PA-51: PSR-7 HTTP Message Interface (where applicable).
- PA-52: PSR-11 Container Interface for DI.

---

## Anti-Patterns (Forbidden)

| Anti-Pattern | Rule |
|---|---|
| Eloquent model in Domain layer | PA-02 |
| Business logic in Controller | PA-19 |
| Direct DB call in Domain | PA-05 |
| Framework facade in Domain | PA-01 |
| Infrastructure exception in API response | PA-17 |
| Hardcoded secrets in config | Security standard |
| `permitAll` without documented justification | PA-23 |

---

## ADR Requirements

Any deviation from this standard requires an approved ADR filed in `docs/ADR/`.
