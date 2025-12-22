# C# / .NET — Service / Module Template
## DDD-Ready — Gold Standard / State-of-the-Art

**Version:** 1.0  
**Scope:** Generic / Project-agnostic  
**Runtime:** .NET 8 / .NET 9+  

> This template defines the **reference structure and minimal scaffolding** for a modern C#/.NET service or module.
> It is designed to comply with the Architecture Standard, FR and NFR documents.

---

## 1. Repository Layout

```text
/<service-or-module-name>/
  /src
    /<Service>.Api
      Controllers/
      Contracts/
        Requests/
        Responses/
      Filters/
      Middleware/
      OpenApi/
      Program.cs
      appsettings.json
    /<Service>.Application
      Abstractions/
        Messaging/
        Persistence/
        Clock/
      UseCases/
        <BoundedContext>/
          <UseCaseName>/
            <UseCaseName>Command.cs
            <UseCaseName>Query.cs
            <UseCaseName>Handler.cs
            <UseCaseName>Validator.cs
            <UseCaseName>Result.cs
            <UseCaseName>Mappings.cs
            <UseCaseName>Errors.cs
      Behaviors/
        ValidationBehavior.cs
        LoggingBehavior.cs
        TransactionBehavior.cs
      Results/
    /<Service>.Domain
      Aggregates/
      Entities/
      ValueObjects/
      DomainEvents/
      Specifications/
      Services/
      Errors/
    /<Service>.Infrastructure
      Persistence/
        DbContexts/
        Migrations/
        Repositories/
        UnitOfWork/
      Messaging/
        Outbox/
        Consumers/
        Producers/
        DeadLetter/
      ReadModels/
        Projections/
        Stores/
      Caching/
        Decorators/
        Keys/
      Observability/
        Logging/
        Tracing/
        Metrics/
      Security/
        Auth/
        Secrets/
      Integrations/
        HttpClients/
        Adapters/
  /tests
    /<Service>.Domain.Tests
    /<Service>.Application.Tests
    /<Service>.Infrastructure.Tests
    /<Service>.Api.Tests
  /docs
    ADR/
    Runbooks/
    Architecture.md
    Contracts.md
  Directory.Build.props
  Directory.Build.targets
  .editorconfig
  .gitignore
```text
/<service-or-module-name>/
  /src
    /<Service>.Api
      Controllers/
      Contracts/
        Requests/
        Responses/
      Filters/
      Middleware/
      OpenApi/
      Program.cs
      appsettings.json
    /<Service>.Application
      Abstractions/
        Messaging/
        Persistence/
        Clock/
      Commands/
      Queries/
      Behaviors/
      Validation/
      Mappers/
      Results/
    /<Service>.Domain
      Aggregates/
      Entities/
      ValueObjects/
      DomainEvents/
      Specifications/
      Services/
      Errors/
    /<Service>.Infrastructure
      Persistence/
        DbContexts/
        Migrations/
        Repositories/
        UnitOfWork/
      Messaging/
        Outbox/
        Consumers/
        Producers/
        DeadLetter/
      ReadModels/
        Projections/
        Stores/
      Caching/
        Decorators/
        Keys/
      Observability/
        Logging/
        Tracing/
        Metrics/
      Security/
        Auth/
        Secrets/
      Integrations/
        HttpClients/
        Adapters/
  /tests
    /<Service>.Domain.Tests
    /<Service>.Application.Tests
    /<Service>.Infrastructure.Tests
    /<Service>.Api.Tests
  /docs
    ADR/
    Runbooks/
    Architecture.md
    Contracts.md
  Directory.Build.props
  Directory.Build.targets
  .editorconfig
  .gitignore
```

---

## 2. Layer Responsibilities (Hard Rules)

### API
- Transport and protocol concerns
- Authentication/authorization enforcement
- Request validation (boundary)
- DTO mapping
- Correlation ID propagation

### Application
- Use-cases orchestration (commands/queries)
- Transaction boundary coordination
- Result and error mapping to API
- Policies and behaviors (logging, validation, idempotency)

### Domain
- Aggregates, invariants, policies
- Domain events emission
- Pure business logic only

### Infrastructure
- EF Core persistence (write model)
- Outbox dispatcher and message bus integration
- Projections/read model materialization
- Cache decorators (cache-aside)
- External integration adapters

---

## 3. Minimal Required Abstractions

### 3.1 Result Type (Application Boundary)

```csharp
public readonly record struct Result<T>(bool IsSuccess, T? Value, Error? Error)
{
    public static Result<T> Ok(T value) => new(true, value, null);
    public static Result<T> Fail(Error error) => new(false, default, error);
}

public sealed record Error(string Code, string Message, string? Detail = null);
```

Rules:
- Exceptions are not used for control flow
- Infrastructure exceptions are mapped to typed errors

---

### 3.2 Command / Query Contracts

```csharp
public interface ICommand<out TResponse> { }
public interface IQuery<out TResponse> { }

public interface ICommandHandler<TCommand, TResponse>
    where TCommand : ICommand<TResponse>
{
    Task<Result<TResponse>> Handle(TCommand command, CancellationToken ct);
}

public interface IQueryHandler<TQuery, TResponse>
    where TQuery : IQuery<TResponse>
{
    Task<Result<TResponse>> Handle(TQuery query, CancellationToken ct);
}
```

---

### 3.3 Domain Event Contract

```csharp
public interface IDomainEvent
{
    Guid Id { get; }
    DateTimeOffset OccurredAt { get; }
    string EventType { get; }
}
```

---

### 3.4 Outbox Record Contract

```csharp
public sealed class OutboxMessage
{
    public Guid Id { get; init; }
    public DateTimeOffset OccurredAt { get; init; }
    public string Type { get; init; } = default!;
    public string Payload { get; init; } = default!;
    public DateTimeOffset? ProcessedAt { get; set; }
    public int AttemptCount { get; set; }
    public string? LastError { get; set; }
}
```

Rules:
- Outbox is persisted in the same transaction as the write model
- Dispatch is at-least-once

---

### 3.5 Projection Contract

```csharp
public interface IProjectionHandler<in TEvent>
{
    Task Handle(TEvent @event, CancellationToken ct);
}
```

Rules:
- Projections are idempotent
- Projections are replayable

---

### 3.6 Cache Decorator Contract (Read Path)

```csharp
public interface IReadRepository<TQuery, TDto>
{
    Task<Result<TDto>> Get(TQuery query, CancellationToken ct);
}

public sealed class CachedReadRepository<TQuery, TDto> : IReadRepository<TQuery, TDto>
{
    private readonly IReadRepository<TQuery, TDto> _inner;
    private readonly ICache _cache;

    public CachedReadRepository(IReadRepository<TQuery, TDto> inner, ICache cache)
    {
        _inner = inner;
        _cache = cache;
    }

    public async Task<Result<TDto>> Get(TQuery query, CancellationToken ct)
    {
        // Pseudocode:
        // 1) Try cache
        // 2) If miss, call inner
        // 3) On success, cache DTO
        // 4) Return result
        return await _inner.Get(query, ct);
    }
}
```

---

## 4. API Conventions

- All endpoints must return a consistent envelope for errors
- Correlation ID must be accepted and returned
- Validation errors must return deterministic codes
- API versioning must be explicit

---

## 5. Observability Conventions

- Structured logs only
- Trace context propagation across:
  - HTTP requests
  - message handlers
  - background jobs
- Business metrics emitted for critical flows

---

## 6. Testing Template

### Domain
- Aggregate invariants
- Value object behavior
- Domain events emitted

### Application
- Command/query handler behavior
- Result mapping
- Transaction boundary behavior

### Infrastructure
- EF Core integration tests
- Outbox dispatch behavior
- Consumer idempotency tests
- Projection replay tests

---

## 7. Mandatory CI Gates

- Build must succeed (no warnings treated as errors where applicable)
- Unit tests must pass
- Code formatting and analyzers must pass
- Contract tests must pass (where defined)

---

## 8. AI-Assisted Engineering Rules (Template-Level)

- AI must not bypass layers
- AI must not implement direct writes to read stores or cache
- AI must not remove outbox, idempotency, or versioning
- Human review is mandatory

---

## Summary

This template provides a **DDD-ready, event-driven, cache-aware** scaffolding for modern .NET systems.

It is designed to be used as the basis for a **generator** (e.g., `dotnet new`) and enforced via PR checklist and ADR governance.
