# C++ — Functional Requirements (FR)
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Scope:** Generic / Project-agnostic
**Runtime:** C++20 / C++23 | CMake 3.28+

> Defines **functional engineering requirements** for C++ backends and services.
> These are not business requirements — they specify what the platform must provide technically.

---

## 1. Architecture & Module Structure

- FR-01: Service must enforce Clean/Hexagonal Architecture: API/Delivery, Application (Ports In/Out), Domain, Infrastructure.
- FR-02: Domain layer must have zero external library dependencies — C++ Standard Library only.
- FR-03: Application layer must orchestrate use cases via Port interfaces (abstract base classes).
- FR-04: Infrastructure implements Application ports — DB structs and mappers live here.
- FR-05: Each module must be independently buildable and testable via CMake targets.
- FR-06: Cross-module communication via explicit contracts (HTTP APIs / events / gRPC).

---

## 2. Domain Modeling

- FR-07: Platform must support Aggregates as transactional boundaries.
- FR-08: Aggregates must enforce invariants via `[[nodiscard]]` factory functions.
- FR-09: Value Objects must be immutable — all members `const`, construction-time validation.
- FR-10: Platform must support Domain Events as immutable POD-like structs.
- FR-11: Domain behavior must be persistence-agnostic — no DB headers in domain.

---

## 3. Command Processing (Write Path)

- FR-12: Platform must support Commands that modify state via Handler classes.
- FR-13: Each command must execute inside a transaction boundary via `UnitOfWork` port.
- FR-14: Validation applied in application layer before domain methods execute.
- FR-15: Write model persists to DB via Infrastructure repositories (libpqxx, SQLite, etc.).
- FR-16: Successful command execution emits domain events via Outbox port.

---

## 4. Query Processing (Read Path)

- FR-17: Platform must support Queries that never modify state.
- FR-18: Read operations served from optimized read models where applicable.
- FR-19: Query endpoints support pagination, filtering, and sorting.
- FR-20: Query handlers return typed response structs — no raw DB types exposed.

---

## 5. Event Publishing (Outbox)

- FR-21: Platform must implement the Outbox Pattern for reliable event publication.
- FR-22: Outbox records persisted atomically with the write transaction.
- FR-23: Outbox dispatch supports at-least-once delivery.
- FR-24: Outbox dispatch supports retries and dead-letter routing.

---

## 6. Event Consumption

- FR-25: Platform must support event consumers (Kafka via librdkafka / RabbitMQ via AMQP-CPP).
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

- FR-32: Platform must support cache-aside pattern via Redis (hiredis / cpp_redis).
- FR-33: Cache entries store read DTOs only — never domain entities.
- FR-34: Cache misses fall back to read store; read store failures fall back to write DB.
- FR-35: Cache invalidation event-driven or TTL-based, explicitly defined per feature.

---

## 9. Error Handling & Result Model

- FR-36: `std::expected<T, E>` (C++23) or custom `Result<T, E>` used at application boundaries.
- FR-37: API layer returns consistent error envelopes (Problem Details — RFC 9457 recommended).
- FR-38: Infrastructure errors caught and mapped before crossing layer boundaries — no raw exceptions in API.
- FR-39: Validation errors return deterministic, machine-readable error codes.
- FR-40: `[[nodiscard]]` mandatory on all `Result`/`expected`-returning functions.

---

## 10. API Standards

- FR-41: APIs versioned via URL path: `/v1/`, `/v2/`.
- FR-42: APIs support and propagate `X-Correlation-Id` header.
- FR-43: OpenAPI specification maintained and committed as versioned artifact.
- FR-44: HTTP server via Crow, Drogon, cpp-httplib, or gRPC — no custom raw socket servers.

---

## 11. Security & Authorization

- FR-45: Authentication middleware mandatory for all services.
- FR-46: JWT validation via `jwt-cpp` or equivalent.
- FR-47: Authorization enforced per route/handler via policy functions.
- FR-48: All endpoints require authorization by default.
- FR-49: Secrets managed via externalized configuration (Vault, AWS SSM, env injection).

---

## 12. Observability

- FR-50: Structured JSON logging via `spdlog` or OpenTelemetry C++ SDK logging.
- FR-51: Prometheus metrics via `prometheus-cpp`.
- FR-52: Distributed tracing via OpenTelemetry C++ SDK.
- FR-53: `correlationId` propagated via request context and outbound headers.
- FR-54: Health endpoints mandatory (`/health/liveness`, `/health/readiness`).

---

## 13. Resilience & Fault Handling

- FR-55: Resilience policies (timeout, retry, circuit breaker) via custom middleware or `Resilix`.
- FR-56: All external HTTP calls via Core Networking Package with resilience policies applied.
- FR-57: Platform supports graceful degradation via fallbacks.
- FR-58: Dead-letter queue handling mandatory for consumer failures.

---

## 14. Configuration

- FR-59: Environment-specific config via env vars + config file (`nlohmann/json`, YAML-cpp, or `libconfig`).
- FR-60: Sensitive config injected at runtime from secret manager — never in source.
- FR-61: Feature flags supported via property-based toggles.

---

## 15. Background Processing

- FR-62: Background jobs via `std::jthread` (C++20) pools with proper lifecycle management.
- FR-63: Background jobs must be idempotent and observable.
- FR-64: Long-running async work handled via message consumers.

---

## 16. Testing Support

- FR-65: Domain and Application layers unit-testable with Google Test or Catch2 — zero infrastructure required.
- FR-66: Infrastructure tested via integration tests (Testcontainers-cpp or real infra in CI).
- FR-67: API contracts tested via HTTP client fixtures.
- FR-68: Tests deterministic and runnable in CI without external dependencies.

---

## 17. Build System & Toolchain

- FR-69: CMake 3.28+ as build system — targets define inter-module dependencies and enforce layering.
- FR-70: Conan 2+ or vcpkg for dependency management — pinned versions.
- FR-71: Sanitizers (ASan, UBSan, TSan) enabled in CI test builds.
- FR-72: `compile_commands.json` generated for tooling support.

---

## 18. AI-Assisted Engineering

- FR-73: Platform provides templates to reduce ambiguity for AI-generated code.
- FR-74: AI-generated code must comply with layering, memory management, and error handling rules.
- FR-75: Architectural deviations from AI must require ADR approval.

---

## Summary

These FRs define the gold standard for C++ backend platforms: layered, event-driven, memory-safe, observable, resilient, and governable at scale.
