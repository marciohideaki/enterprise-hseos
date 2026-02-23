# Go — Architecture Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** Generic / Project-agnostic
**Runtime:** Go 1.22+

> Defines the mandatory architectural standard for Go backend services.
> Complies with the Hexagonal & Clean Architecture Standard and DDD Standard.

---

## 1. Layer Model

```text
┌─────────────────────────────────────────────────────┐
│                   API / Delivery Layer               │
│  (HTTP Handlers, gRPC Servers, Middleware, DTOs)     │
├─────────────────────────────────────────────────────┤
│                Application Layer                     │
│  (Use Cases / Commands / Queries, Port Interfaces)   │
├─────────────────────────────────────────────────────┤
│                  Domain Layer                        │
│  (Aggregates, Value Objects, Domain Events,          │
│   Domain Services, Repository Interfaces)            │
├─────────────────────────────────────────────────────┤
│               Infrastructure Layer                   │
│  (DB Adapters, HTTP Clients, Messaging, Cache)       │
└─────────────────────────────────────────────────────┘
```

**Dependency Rule:** Inner layers (domain, application) must never import outer layers (infrastructure, delivery).

---

## 2. Rules

### 2.1 Domain Layer
- GA-01: Domain packages must have zero external library imports — stdlib only.
- GA-02: Domain entities are plain Go structs with behavior methods — no ORM tags.
- GA-03: Value Objects are immutable — no exported setters; constructor validates invariants.
- GA-04: Aggregates enforce all business invariants internally.
- GA-05: Repository interfaces (ports) defined in the domain package.
- GA-06: Domain Events are immutable structs with value semantics.

### 2.2 Application Layer
- GA-07: Application orchestrates use cases via domain port interfaces only.
- GA-08: Use case handlers must not import infrastructure packages.
- GA-09: Each use case: Command/Query struct + Handler func/method + Result type.
- GA-10: Transactional boundaries belong in application layer — via `UnitOfWork` port.
- GA-11: Validation occurs in application layer before domain methods execute.
- GA-12: Application layer may import `context` and stdlib — no framework dependencies.

### 2.3 Infrastructure Layer
- GA-13: SQL structs (for sqlx/GORM) live exclusively in Infrastructure.
- GA-14: Mapping between SQL structs and Domain entities is mandatory and explicit.
- GA-15: Repository adapters implement domain repository interfaces.
- GA-16: All outbound HTTP calls use the Core Networking Package.
- GA-17: Infrastructure errors wrapped and mapped before crossing layer boundaries.
- GA-18: Event publishing adapters implement application port interfaces.

### 2.4 API / Delivery Layer
- GA-19: HTTP handlers are thin — delegate to application layer immediately.
- GA-20: Request/response DTOs are delivery-layer-only types.
- GA-21: URL path versioning mandatory: `/v1/`, `/v2/`.
- GA-22: All endpoints require authorization by default.
- GA-23: `X-Correlation-Id` header propagated on all requests.
- GA-24: API DTOs mapped explicitly from/to domain/application types.

---

## 3. Package Structure

```text
{service-name}/
  cmd/
    server/
      main.go
  internal/
    api/
      handler/
        {feature}_handler.go
      dto/
        {usecase}_request.go
        {usecase}_response.go
      middleware/
        correlation_id.go
        auth.go
      router.go
    application/
      port/
        in/
          {usecase}_usecase.go          ← interface
        out/
          {feature}_repository.go       ← interface
          {feature}_event_publisher.go  ← interface
      usecase/
        {feature}/
          {usecase}_command.go
          {usecase}_handler.go
          {usecase}_result.go
      shared/
        result/
          result.go
    domain/
      model/
        {feature}.go                    ← Aggregate root
        {feature}_id.go                 ← Value Object
      event/
        {fact_name}.go                  ← Domain Event
      service/
        {feature}_domain_service.go
    infrastructure/
      persistence/
        postgres/
          {feature}_row.go             ← SQL struct
          {feature}_repository.go      ← implements Port Out
          {feature}_mapper.go
      messaging/
        outbox/
          outbox_message.go
          outbox_dispatcher.go
        consumer/
          {event_name}_consumer.go
        producer/
          {feature}_event_publisher.go
      cache/
        {feature}_cache.go
      integration/
        client/
          {external_service}_client.go
        adapter/
          {external_service}_adapter.go
      config/
        config.go
  pkg/
    networking/                         ← Core Networking Package
  migrations/                           ← SQL migration files
  docs/
    ADR/
  go.mod
  go.sum
  .golangci.yml
```

---

## 4. Interface-Driven Design

- GA-25: Interfaces defined at the point of consumption (caller's package), not the implementor's.
- GA-26: Prefer small, single-method interfaces (`io.Reader` style).
- GA-27: Embedding interfaces allowed for composition.
- GA-28: No interface defined in Infrastructure for use by Domain.

---

## 5. Error Handling

- GA-29: Use sentinel errors or typed errors — never `panic` for control flow.
- GA-30: Errors wrapped with `fmt.Errorf("context: %w", err)` at each layer boundary.
- GA-31: Infrastructure errors mapped to domain/application error types before propagating up.
- GA-32: API layer maps application errors to HTTP status codes via error registry.
- GA-33: `Result[T]` pattern implemented as struct with `Value T` and `Err *AppError`.

---

## 6. Concurrency

- GA-34: Shared mutable state protected by `sync.Mutex` or via channel.
- GA-35: Context propagated throughout call chain — no background goroutines ignoring context.
- GA-36: Goroutine leaks prevented — all goroutines have explicit lifecycle management.
- GA-37: `sync.WaitGroup` used for goroutine coordination in background workers.

---

## 7. CQRS

- GA-38: Commands modify state; Queries return data only.
- GA-39: Query handlers must not trigger side effects.
- GA-40: Read models served from optimized projection store where applicable.

---

## 8. Event-Driven / Outbox

- GA-41: Domain events published via Outbox Pattern — atomic with write transaction.
- GA-42: Event consumers must be idempotent.
- GA-43: Dead-letter handling required for consumers.

---

## 9. Testing

- GA-44: Domain logic unit-testable with stdlib `testing` + `testify` — zero external deps.
- GA-45: Application handlers unit-testable with mock ports (mockery or hand-written).
- GA-46: Infrastructure adapters covered by integration tests (`testcontainers-go`).
- GA-47: API layer tested via `net/http/httptest`.
- GA-48: Table-driven tests mandatory for domain invariants.

---

## 10. Static Analysis & Quality

- GA-49: `golangci-lint` with standard linters (`errcheck`, `govet`, `staticcheck`, `revive`) enforced in CI.
- GA-50: `go vet` passes with zero warnings.
- GA-51: Architecture rules enforced via `go-arch-lint` or manual CI checks.
- GA-52: No `//nolint` without documented justification in comment.

---

## Anti-Patterns (Forbidden)

| Anti-Pattern | Rule |
|---|---|
| SQL struct in Domain layer | GA-13 |
| Business logic in HTTP handler | GA-19 |
| Direct DB call in Domain | GA-05 |
| Infrastructure import in Domain | GA-01 |
| `panic` for control flow | GA-29 |
| Goroutine without lifecycle | GA-36 |
| Hardcoded secrets | Security standard |

---

## ADR Requirements

Any deviation from this standard requires an approved ADR filed in `docs/ADR/`.
