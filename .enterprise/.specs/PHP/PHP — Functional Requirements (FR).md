# PHP — Functional Requirements (FR)
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Scope:** Generic / Project-agnostic
**Runtime:** PHP 8.3+ / Laravel 11+ or Symfony 7+

> Defines **functional engineering requirements** for PHP backends.
> These are not business requirements — they specify what the platform must provide technically.

---

## 1. Architecture & Module Structure

- FR-01: Service must enforce Clean/Hexagonal Architecture: API, Application (Ports In/Out), Domain, Infrastructure.
- FR-02: Domain layer must be framework-agnostic — no Laravel/Symfony annotations, facades, or base classes.
- FR-03: Application layer must orchestrate use cases via Port interfaces.
- FR-04: Infrastructure implements Application ports — Eloquent models and mappers live here.
- FR-05: Each module must be independently testable.
- FR-06: Cross-module communication via explicit contracts (APIs/events).

---

## 2. Domain Modeling

- FR-07: Platform must support Aggregates as transactional boundaries.
- FR-08: Aggregates must enforce invariants internally.
- FR-09: Value Objects must be immutable — PHP 8.2+ `readonly class`.
- FR-10: Platform must support Domain Events as immutable facts.
- FR-11: Domain behavior must be persistence-agnostic.

---

## 3. Command Processing (Write Path)

- FR-12: Platform must support Commands that modify state via handler classes.
- FR-13: Each command must execute inside a DB transaction boundary in the Application layer.
- FR-14: Validation (Laravel FormRequest or Symfony constraints + domain-level) applied before handler.
- FR-15: Write model persists via Eloquent (Laravel) or Doctrine (Symfony) in Infrastructure.
- FR-16: Successful command execution emits domain events via Outbox.

---

## 4. Query Processing (Read Path)

- FR-17: Platform must support Queries that never modify state.
- FR-18: Read operations served from optimized read models where applicable.
- FR-19: Query endpoints support pagination, filtering, and sorting.
- FR-20: Query handlers return typed response DTOs.

---

## 5. Event Publishing (Outbox)

- FR-21: Platform must implement the Outbox Pattern for reliable event publication.
- FR-22: Outbox records persisted atomically with the write transaction.
- FR-23: Outbox dispatch supports at-least-once delivery.
- FR-24: Outbox dispatch supports retries and dead-letter routing.

---

## 6. Event Consumption

- FR-25: Platform must support event consumers (Laravel Queue / RabbitMQ / Kafka).
- FR-26: Consumers must be idempotent — enforce via persisted idempotency keys.
- FR-27: Consumers must support dead-letter routing for unrecoverable messages.
- FR-28: Consumer concurrency configurable per queue.

---

## 7. Read Model Materialization

- FR-29: Platform must support projection handlers that materialize read models from events.
- FR-30: Projections must be replayable from the event log.
- FR-31: Projection handlers must be idempotent.

---

## 8. Caching

- FR-32: Platform must support cache-aside via Laravel Cache abstraction or PSR-6/PSR-16.
- FR-33: Cache entries store read DTOs only — never Eloquent models.
- FR-34: Cache misses fall back to read store; read store failures fall back to write DB.
- FR-35: Cache invalidation event-driven or TTL-based, explicitly defined per feature.

---

## 9. Error Handling & Result Model

- FR-36: A typed Result model or exception hierarchy used at application boundaries.
- FR-37: API layer returns consistent error envelopes (Problem Details — RFC 9457 recommended).
- FR-38: Infrastructure exceptions must not propagate to Domain or API.
- FR-39: Validation errors return deterministic, machine-readable error codes.

---

## 10. API Standards

- FR-40: APIs versioned via URL path: `/api/v1/`, `/api/v2/`.
- FR-41: APIs support and propagate `X-Correlation-Id` header.
- FR-42: OpenAPI specification generated (L5-Swagger / NelmioApiDocBundle) and committed.
- FR-43: Swagger UI enabled in development and staging environments only.

---

## 11. Security & Authorization

- FR-44: Auth framework mandatory (Laravel Sanctum/Passport or Symfony Security).
- FR-45: OAuth2/JWT resource server configuration for token-based auth.
- FR-46: Authorization enforced via Gates/Policies (Laravel) or Voters (Symfony).
- FR-47: All endpoints require authorization by default — no `permitAll` except operational.
- FR-48: Secrets managed via externalized configuration (Vault, AWS SSM, `.env` not committed).

---

## 12. Observability

- FR-49: Structured JSON logging via Monolog.
- FR-50: Metrics exported via Prometheus exporter package.
- FR-51: Distributed tracing via OpenTelemetry PHP SDK.
- FR-52: `correlationId` propagated via logging context across all log statements.
- FR-53: Health endpoints mandatory (`/health/liveness`, `/health/readiness`).

---

## 13. Resilience & Fault Handling

- FR-54: Resilience policies (timeout, retry, circuit breaker) via `ganesha` or custom middleware.
- FR-55: All external HTTP calls via Core Networking Package with resilience policies applied.
- FR-56: Platform supports graceful degradation via fallbacks.
- FR-57: Dead-letter queue handling mandatory for consumer failures.

---

## 14. Configuration

- FR-58: Environment-specific config via `.env` + config files — secrets never committed.
- FR-59: Feature flags supported via property-based toggles or LaunchDarkly SDK.
- FR-60: Sensitive config injected at runtime from secret manager.

---

## 15. Background Processing

- FR-61: Background jobs via Laravel Queue or Symfony Messenger.
- FR-62: Background jobs must be idempotent and observable.
- FR-63: Long-running async work handled via message queue workers.

---

## 16. Testing Support

- FR-64: Domain and Application layers unit-testable with PHPUnit — zero framework setup required.
- FR-65: Infrastructure tested via integration tests with SQLite or Testcontainers.
- FR-66: API contracts tested via Laravel HTTP tests or Symfony WebTestCase.
- FR-67: Tests deterministic and runnable in CI without external dependencies.

---

## 17. AI-Assisted Engineering

- FR-68: Platform provides templates to reduce ambiguity for AI-generated code.
- FR-69: AI-generated code must comply with layering, persistence, and event rules.
- FR-70: Architectural deviations from AI must require ADR approval.

---

## Summary

These FRs define the gold standard for PHP/Laravel & PHP/Symfony backend platforms: layered, event-driven, observable, resilient, and governable at scale.
