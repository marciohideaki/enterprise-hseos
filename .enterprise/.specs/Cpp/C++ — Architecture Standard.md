# C++ — Architecture Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** Generic / Project-agnostic
**Runtime:** C++20 / C++23 | CMake 3.28+

> Defines the mandatory architectural standard for C++ backend services and libraries.
> Complies with the Hexagonal & Clean Architecture Standard and DDD Standard.

---

## 1. Layer Model

```text
┌─────────────────────────────────────────────────────┐
│                   API / Delivery Layer               │
│  (HTTP Handlers, gRPC Stubs, Request/Response DTOs) │
├─────────────────────────────────────────────────────┤
│                Application Layer                     │
│  (Use Cases, Port Interfaces, Commands, Validators)  │
├─────────────────────────────────────────────────────┤
│                  Domain Layer                        │
│  (Aggregates, Value Objects, Domain Events,          │
│   Domain Services, Repository Interfaces)            │
├─────────────────────────────────────────────────────┤
│               Infrastructure Layer                   │
│  (DB Adapters, HTTP Clients, Messaging, Cache)       │
└─────────────────────────────────────────────────────┘
```

**Dependency Rule:** Inner layers must never `#include` headers from outer layers.
Enforced via CMake target dependencies and include-what-you-use.

---

## 2. Rules

### 2.1 Domain Layer
- CA-01: Domain classes must have zero external library dependencies — only C++ Standard Library.
- CA-02: Domain entities are plain value types or classes with private state and behavior methods.
- CA-03: Value Objects are immutable — all members `const`, no mutating methods.
- CA-04: Aggregates enforce all business invariants via `[[nodiscard]]` factory functions.
- CA-05: Repository interfaces (abstract base classes with pure virtuals) live in Domain headers.
- CA-06: Domain Events are immutable structs (POD-like, copy-constructible).

### 2.2 Application Layer
- CA-07: Application layer orchestrates use cases via domain port interfaces (abstract bases) only.
- CA-08: Use case handlers must not `#include` any infrastructure headers.
- CA-09: Each use case: Command/Query struct + Handler class + Result type.
- CA-10: Transaction boundaries belong in application layer — via `UnitOfWork` port.
- CA-11: Validation occurs in application layer before domain methods execute.
- CA-12: Application layer uses C++ stdlib only; no framework or ORM headers.

### 2.3 Infrastructure Layer
- CA-13: ORM-mapped structs or DB row types live exclusively in Infrastructure.
- CA-14: Mapping between DB types and Domain entities is mandatory and explicit.
- CA-15: Repository implementations inherit from domain repository interfaces.
- CA-16: All outbound HTTP calls use the Core Networking Package.
- CA-17: Infrastructure exceptions caught and mapped before crossing layer boundaries.
- CA-18: Event publishing adapters implement application port interfaces.

### 2.4 API / Delivery Layer
- CA-19: HTTP/gRPC handlers are thin — delegate to application use cases immediately.
- CA-20: Request/response DTOs are delivery-layer-only types; never passed to domain.
- CA-21: URL path versioning mandatory: `/v1/`, `/v2/`.
- CA-22: All endpoints require authorization by default.
- CA-23: `X-Correlation-Id` header propagated on all requests.

---

## 3. Directory Structure

```text
{service-name}/
  src/
    api/
      handler/
        {Feature}Handler.h / .cpp
      dto/
        {UseCase}Request.h
        {UseCase}Response.h
      middleware/
        CorrelationIdMiddleware.h / .cpp
    application/
      port/
        in/
          I{UseCase}UseCase.h           ← pure virtual interface
        out/
          I{Feature}Repository.h        ← pure virtual interface
          I{Feature}EventPublisher.h    ← pure virtual interface
      usecase/
        {feature}/
          {UseCase}Command.h
          {UseCase}Handler.h / .cpp
          {UseCase}Result.h
      shared/
        Result.h
        AppError.h
    domain/
      model/
        {Feature}.h / .cpp              ← Aggregate root
        {Feature}Id.h                   ← Value Object
      event/
        {FactName}.h                    ← Domain Event
      service/
        {Feature}DomainService.h / .cpp
      exception/
        {Feature}Exception.h
    infrastructure/
      persistence/
        {Feature}Row.h                  ← DB row struct
        {Feature}RepositoryImpl.h / .cpp
        {Feature}Mapper.h / .cpp
      messaging/
        outbox/
          OutboxMessage.h
          OutboxDispatcher.h / .cpp
        consumer/
          {EventName}Consumer.h / .cpp
        producer/
          {Feature}EventPublisherImpl.h / .cpp
      cache/
        {Feature}Cache.h / .cpp
      integration/
        client/
          {ExternalService}Client.h / .cpp
        adapter/
          {ExternalService}Adapter.h / .cpp
      config/
        AppConfig.h / .cpp
  tests/
    domain/
      {Feature}Test.cpp
    application/
      {UseCase}HandlerTest.cpp
    infrastructure/
      {Feature}RepositoryIT.cpp         ← integration tests
    api/
      {Feature}HandlerTest.cpp
  CMakeLists.txt
  conanfile.py  (or vcpkg.json)
  .clang-tidy
  .clang-format
```

---

## 4. Memory Management

- CA-24: Prefer value semantics; use smart pointers (`std::unique_ptr`, `std::shared_ptr`) for heap allocation.
- CA-25: Raw owning pointers (`T*`) forbidden — use smart pointers or containers.
- CA-26: `std::shared_ptr` used only when shared ownership is genuinely required.
- CA-27: No `new`/`delete` outside of smart pointer construction or custom allocators.
- CA-28: RAII mandatory — resources acquired in constructor, released in destructor.

---

## 5. Error Handling

- CA-29: Use `std::expected<T, E>` (C++23) or a custom `Result<T, E>` — no exception-as-control-flow.
- CA-30: Exceptions reserved for truly exceptional, unrecoverable situations.
- CA-31: Infrastructure errors mapped to typed application error codes before crossing layers.
- CA-32: `[[nodiscard]]` on all `Result<T>` / `std::expected<T,E>` returning functions.
- CA-33: Never use `abort()` or uncaught exception propagation outside main.

---

## 6. Concurrency

- CA-34: Shared mutable state protected via `std::mutex` / `std::shared_mutex`.
- CA-35: Prefer `std::jthread` (C++20) over `std::thread` for automatic join.
- CA-36: `std::atomic` for lock-free flags and counters.
- CA-37: No data races — enforced by ThreadSanitizer (TSan) in CI.

---

## 7. CQRS

- CA-38: Commands modify state; Queries return data only.
- CA-39: Query handlers must not trigger side effects.
- CA-40: Read models served from optimized read store where applicable.

---

## 8. Testing

- CA-41: Domain logic unit-testable with Google Test or Catch2 — zero infrastructure deps.
- CA-42: Application handlers unit-testable with mock interfaces (Google Mock).
- CA-43: Infrastructure adapters covered by integration tests (Testcontainers-cpp or real infra in CI).
- CA-44: API layer tested via HTTP client fixtures.

---

## 9. Static Analysis & Quality

- CA-45: `clang-tidy` with full checker set enforced in CI (no warnings = failure).
- CA-46: `clang-format` enforced — code formatting non-negotiable.
- CA-47: AddressSanitizer (ASan) and UndefinedBehaviorSanitizer (UBSan) in CI test builds.
- CA-48: ThreadSanitizer (TSan) in CI for concurrent code.
- CA-49: No `reinterpret_cast` without documented justification.
- CA-50: No `const_cast` without documented justification.

---

## Anti-Patterns (Forbidden)

| Anti-Pattern | Rule |
|---|---|
| DB row struct in Domain | CA-13 |
| Business logic in handler | CA-19 |
| Raw owning pointer | CA-25 |
| Infrastructure `#include` in Domain | CA-01 |
| Exception for control flow | CA-29 |
| Unchecked `Result` / `expected` | CA-32 |
| Data race | CA-37 |

---

## ADR Requirements

Any deviation from this standard requires an approved ADR filed in `docs/ADR/`.
