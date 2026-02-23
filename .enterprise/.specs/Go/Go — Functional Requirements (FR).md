# Go — Functional Requirements (FR)
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Scope:** Generic / Project-agnostic
**Runtime:** Go 1.22+

> Defines **functional engineering requirements** for Go backends.
> These are not business requirements — they specify what the platform must provide technically.

---

## 1. Architecture & Module Structure

- FR-01: Service must enforce Clean/Hexagonal Architecture: API/Delivery, Application (Ports In/Out), Domain, Infrastructure.
- FR-02: Domain layer must have zero external library imports — stdlib only.
- FR-03: Application layer must orchestrate use cases via Port interfaces (Go interfaces).
- FR-04: Infrastructure implements Application ports — DB structs and mappers live here.
- FR-05: Each module must be independently testable.
- FR-06: Cross-module communication via explicit contracts (HTTP APIs / events).

---

## 2. Domain Modeling

- FR-07: Platform must support Aggregates as transactional boundaries.
- FR-08: Aggregates must enforce invariants internally.
- FR-09: Value Objects must be immutable — constructor validates, no exported mutating methods.
- FR-10: Platform must support Domain Events as immutable structs.
- FR-11: Domain behavior must be persistence-agnostic.

---

## 3. Command Processing (Write Path)

- FR-12: Platform must support Commands that modify state via handler functions/methods.
- FR-13: Each command must execute inside a transaction boundary via `UnitOfWork` port.
- FR-14: Validation applied in application layer before domain methods execute.
- FR-15: Write model persists to relational DB via `database/sql`, sqlx, or GORM in Infrastructure.
- FR-16: Successful command execution emits domain events via Outbox.

---

## 4. Query Processing (Read Path)

- FR-17: Platform must support Queries that never modify state.
- FR-18: Read operations served from optimized read models where applicable.
- FR-19: Query endpoints support pagination, filtering, and sorting.
- FR-20: Query handlers return typed response structs.

---

## 5. Event Publishing (Outbox)

- FR-21: Platform must implement the Outbox Pattern for reliable event publication.
- FR-22: Outbox records persisted atomically with the write transaction.
- FR-23: Outbox dispatch supports at-least-once delivery.
- FR-24: Outbox dispatch supports retries and dead-letter routing.

---

## 6. Event Consumption

- FR-25: Platform must support event consumers (Kafka / RabbitMQ / NATS).
- FR-26: Consumers must be idempotent — enforce via persisted idempotency keys.
- FR-27: Consumers must support dead-letter routing for unrecoverable messages.
- FR-28: Consumer concurrency configurable per topic/queue.

---

## 7. Read Model Materialization

- FR-29: Platform must support projection handlers that materialize read models from events.
- FR-30: Projections must be replayable from the event log.
- FR-31: Projection handlers must be idempotent.

---

## 8. Caching

- FR-32: Platform must support cache-aside pattern.
- FR-33: Cache entries store read DTOs only — never domain entities.
- FR-34: Cache misses fall back to read store; read store failures fall back to write DB.
- FR-35: Cache invalidation event-driven or TTL-based, explicitly defined per feature.

---

## 9. Error Handling & Result Model

- FR-36: `Result[T]` pattern or typed error returns used at application boundaries — no panics.
- FR-37: API layer returns consistent error envelopes (Problem Details — RFC 9457 recommended).
- FR-38: Infrastructure errors wrapped and mapped before crossing layer boundaries.
- FR-39: Validation errors return deterministic, machine-readable error codes.

---

## 10. API Standards

- FR-40: APIs versioned via URL path: `/v1/`, `/v2/`.
- FR-41: APIs support and propagate `X-Correlation-Id` header.
- FR-42: OpenAPI specification generated (oapi-codegen or swaggo) and committed.
- FR-43: Swagger UI enabled in development and staging environments only.

---

## 11. Security & Authorization

- FR-44: Authentication middleware mandatory for all services.
- FR-45: JWT/OAuth2 validation via standard library or `golang-jwt/jwt`.
- FR-46: Authorization enforced via middleware or policy functions per route.
- FR-47: All endpoints require authorization by default.
- FR-48: Secrets managed via externalized configuration (Vault, AWS SSM, env injection).

---

## 12. Observability

- FR-49: Structured JSON logging via `log/slog` (stdlib Go 1.21+) or `zerolog`/`zap`.
- FR-50: Prometheus metrics via `prometheus/client_golang`.
- FR-51: Distributed tracing via OpenTelemetry Go SDK.
- FR-52: `correlationId` propagated via `context.Context` and outbound headers.
- FR-53: Health endpoints mandatory (`/health/liveness`, `/health/readiness`).

---

## 13. Resilience & Fault Handling

- FR-54: Resilience policies (timeout, retry, circuit breaker) via `sony/gobreaker` or `failsafe-go`.
- FR-55: All external HTTP calls via Core Networking Package with resilience policies applied.
- FR-56: Platform supports graceful degradation via fallbacks.
- FR-57: Dead-letter queue handling mandatory for consumer failures.

---

## 14. Configuration

- FR-58: Environment-specific config via env vars + config file (Viper or stdlib).
- FR-59: Feature flags supported via property-based toggles or LaunchDarkly SDK.
- FR-60: Sensitive config injected at runtime from secret manager — never in source.

---

## 15. Background Processing

- FR-61: Background jobs via goroutines with proper lifecycle management.
- FR-62: Background jobs must be idempotent and observable.
- FR-63: Long-running async work handled via message consumers.

---

## 16. Testing Support

- FR-64: Domain and Application layers unit-testable with stdlib `testing` + `testify`.
- FR-65: Infrastructure tested via integration tests with `testcontainers-go`.
- FR-66: API contracts tested via `net/http/httptest`.
- FR-67: Tests deterministic and runnable in CI without external dependencies.

---

## 17. AI-Assisted Engineering

- FR-68: Platform provides templates to reduce ambiguity for AI-generated code.
- FR-69: AI-generated code must comply with layering, persistence, and event rules.
- FR-70: Architectural deviations from AI must require ADR approval.

---

## Summary

These FRs define the gold standard for Go backend platforms: layered, event-driven, observable, resilient, and governable at scale.
