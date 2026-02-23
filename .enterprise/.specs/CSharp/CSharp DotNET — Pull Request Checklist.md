# CSharp DotNET — Pull Request Checklist
## C# / .NET — Gold Standard

> Mandatory for all C# .NET pull requests.
> A PR must not be approved if any required item is not satisfied.

---

## 1. General

- [ ] PR has a clear title and description (what and why).
- [ ] PR scope is small and focused — no unrelated changes.
- [ ] PR references a ticket or story.
- [ ] Breaking changes explicitly documented with `⚠ BREAKING:` prefix.
- [ ] Commit messages contain no AI tool names, co-authorship trailers, or methodology references.

---

## 2. Architecture Compliance

- [ ] Domain layer has zero framework annotations (`[ApiController]`, `[Table]`, EF Core attributes, etc.).
- [ ] Domain layer has zero EF Core / persistence imports (`Microsoft.EntityFrameworkCore.*`).
- [ ] Application layer uses port interfaces — no direct Infrastructure type references.
- [ ] Infrastructure adapters implement Application ports — no business logic in adapters.
- [ ] No cross-module internal imports introduced without explicit justification.
- [ ] Any deviation from Hexagonal Architecture backed by an approved ADR.

---

## 3. CQRS & Use Case Organization

- [ ] New use cases follow Command/Query separation (MediatR `ICommand` / `IQuery`).
- [ ] Handler, Command/Query, Result, and Validator grouped in the same folder — not scattered.
- [ ] No EF Core `SaveChangesAsync` inside Domain layer.
- [ ] Commands are idempotent or have idempotency key enforcement.
- [ ] Queries return DTOs — never EF Core entities.

---

## 4. Persistence & Messaging

- [ ] EF Core `DbContext` and entity configurations live in Infrastructure — not in Domain or Application.
- [ ] Value Objects mapped via `OwnsOne` / `OwnsMany` — not flattened into entity.
- [ ] Raw SQL (`ExecuteSqlRaw`, `FromSqlRaw`) reviewed for injection risk.
- [ ] Outbox pattern used for domain event dispatch — no direct event publish in command handler.
- [ ] EF Core migrations included if schema changed.

---

## 5. Domain Model

- [ ] Aggregate roots protect invariants — no public setters on aggregate state.
- [ ] Value Objects are `record` or `sealed class` with value equality.
- [ ] Domain Events are raised inside aggregate methods — not in Application layer.
- [ ] No anemic domain model — behavior lives in domain, not in services.
- [ ] `Result<T>` or equivalent used instead of throwing exceptions for expected failures.

---

## 6. API & Contract

- [ ] New endpoints have `[ProducesResponseType]` for all possible responses.
- [ ] Endpoints have input validation (`FluentValidation` or `DataAnnotations`).
- [ ] New or changed API contracts have corresponding OpenAPI documentation.
- [ ] Breaking changes to API contracts require ADR and deprecation notice.
- [ ] `[AllowAnonymous]` on new endpoints explicitly justified in PR description.

---

## 7. Nullable Reference Types

- [ ] No `#nullable disable` introduced without justification.
- [ ] No `null!` (null-forgiving) operator without comment explaining why.
- [ ] `Optional<T>` or nullable types used consistently — no silent null propagation.

---

## 8. Async / Concurrency

- [ ] No `async void` (except event handlers) — always `async Task` or `async Task<T>`.
- [ ] No `.Result` or `.Wait()` blocking calls on async methods.
- [ ] `CancellationToken` passed through all async call chains.
- [ ] No `Thread.Sleep` — use `Task.Delay` with `CancellationToken`.

---

## 9. Security

- [ ] No secrets, keys, or passwords in code or configuration files.
- [ ] Input from external sources validated before use.
- [ ] SQL queries use parameterized statements — no string concatenation.
- [ ] PII fields not logged — masked or excluded from structured log output.
- [ ] New dependencies audited for known CVEs (`dotnet list package --vulnerable`).

---

## 10. Testing

- [ ] All new business logic covered by unit tests.
- [ ] Unit tests follow AAA pattern with descriptive names: `Should_<behavior>_When_<condition>`.
- [ ] No logic in test setup that belongs in domain (no domain logic in test helpers).
- [ ] Integration tests use `WebApplicationFactory` + Testcontainers — no external dependencies.
- [ ] Domain coverage ≥ 90% | Application coverage ≥ 80% | Infrastructure coverage ≥ 60%.
- [ ] New `[Fact]` or `[Theory]` does not duplicate existing test coverage.

---

## 11. Observability

- [ ] New service operations emit structured logs with `correlationId` and `traceId`.
- [ ] Errors logged at appropriate level — no swallowed exceptions.
- [ ] New background jobs / consumers have health-check registration.
- [ ] Performance-sensitive paths have metrics (`Counter`, `Histogram`) via `System.Diagnostics.Metrics`.

---

## 12. Code Quality

- [ ] No warnings introduced (`<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` must pass).
- [ ] No suppressed Roslyn analyzer warnings (`#pragma warning disable`) without comment.
- [ ] No unused `using` directives.
- [ ] `record` used for DTOs and Value Objects where applicable.
- [ ] No magic strings or magic numbers — named constants or enums used.
- [ ] No `TODO` left without a linked issue number.
