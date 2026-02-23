# C# / .NET — Idiomatic Guide
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** .NET 8+ / C# 12+

> Defines mandatory C# language idioms, modern feature usage, and community best practices.
> Supplements the CSharp DotNET Architecture Standard.

---

## 1. Modern C# Feature Adoption

- IG-01: .NET 8 (LTS) is the minimum version for all new services — C# 12 features available.
- IG-02: `record` types used for DTOs, Value Objects, Command/Query types — no boilerplate POJOs.
- IG-03: `record struct` used for small value types that benefit from stack allocation.
- IG-04: Primary constructors (C# 12) used for simple dependency injection and initialization.
- IG-05: Pattern matching (`is`, `switch` expressions, property patterns, list patterns) used over manual casting and `if`/`else` chains.
- IG-06: `required` keyword (C# 11) used for mandatory object initializer properties.
- IG-07: `init`-only properties used for post-construction immutability.
- IG-08: Collection expressions (C# 12) `[1, 2, 3]` used for collection literals.
- IG-09: `var` used for local variables when the type is obvious from the RHS — never for method signatures or ambiguous types.
- IG-10: Expression-bodied members for single-expression methods and properties.

```csharp
// Records for DTOs
public record OrderDto(Guid Id, string CustomerId, decimal Total);

// Primary constructor (C# 12)
public class PlaceOrderHandler(IOrderRepository repo, IOrderEventPublisher publisher)
{
    public Result<OrderId> Execute(PlaceOrderCommand cmd) { ... }
}

// Pattern matching
var description = order.Status switch
{
    OrderStatus.Pending  => "Awaiting confirmation",
    OrderStatus.Confirmed => "Order confirmed",
    OrderStatus.Cancelled => "Order cancelled",
    _ => throw new UnreachableException()
};
```

---

## 2. Nullable Reference Types

- IG-11: `#nullable enable` enforced globally via `<Nullable>enable</Nullable>` in `.csproj` — no per-file opt-in.
- IG-12: `?` suffix used for all nullable reference types — `string?`, `Order?`.
- IG-13: `!` (null-forgiving operator) forbidden without documented justification in comment.
- IG-14: `ArgumentNullException.ThrowIfNull(param)` used for null guards — not manual `if (x == null) throw`.
- IG-15: Return `null` only for optional values — prefer `Optional` pattern or `Result<T>` for expected absence.

---

## 3. Immutability

- IG-16: Prefer immutable types — `record`, `readonly struct`, `init`-only properties.
- IG-17: Collections returned from domain methods use immutable types: `IReadOnlyList<T>`, `IReadOnlyDictionary<K,V>`.
- IG-18: `ImmutableArray<T>`, `ImmutableList<T>` used where immutability must be enforced at runtime.
- IG-19: Value Objects implemented as `record` or `readonly record struct`.

---

## 4. Async/Await

- IG-20: `async`/`await` used for all I/O — no blocking `.Result` or `.Wait()` calls.
- IG-21: `ConfigureAwait(false)` used in library/infrastructure code — not required in ASP.NET Core handlers (no SynchronizationContext).
- IG-22: `ValueTask<T>` used for methods that frequently return synchronously — `Task<T>` for truly async operations.
- IG-23: `CancellationToken` parameter mandatory on all async public methods — propagated through the call chain.
- IG-24: `async void` forbidden except for event handlers — use `async Task` always.
- IG-25: `Task.Run()` used only for CPU-bound work offloading — never for wrapping sync I/O.

```csharp
// Correct: CancellationToken propagated
public async Task<Result<OrderId>> ExecuteAsync(
    PlaceOrderCommand command,
    CancellationToken cancellationToken = default)
{
    var order = await _repo.FindAsync(command.Id, cancellationToken).ConfigureAwait(false);
    ...
}

// Forbidden
var result = ExecuteAsync(cmd).Result; // blocks
```

---

## 5. LINQ

- IG-26: LINQ method syntax preferred over query syntax for simple chains.
- IG-27: `ToList()` / `ToArray()` called only when materialization is needed — not speculatively.
- IG-28: Avoid LINQ inside hot loops — materialize before the loop.
- IG-29: `FirstOrDefault()` with null check preferred over `First()` unless non-existence is a bug.
- IG-30: `Any()` preferred over `Count() > 0` for existence checks.
- IG-31: LINQ not used for side effects — no `foreach`-via-`Select`.

---

## 6. Exception Handling

- IG-32: Custom exception hierarchy: base exception per bounded context, typed subtypes per error.
- IG-33: Exception messages actionable — include the problematic value and context.
- IG-34: `catch (Exception ex) when (...)` used for conditional catching — no empty `catch`.
- IG-35: Infrastructure exceptions caught and translated to domain exceptions at layer boundary.
- IG-36: `using` declarations (C# 8+) preferred over `using` blocks for `IDisposable` resources.

---

## 7. Concurrency

- IG-37: `IHostedService` / `BackgroundService` used for background work — no raw `Thread` or unmanaged `Task.Run`.
- IG-38: `Channel<T>` used for producer-consumer patterns — prefer over `ConcurrentQueue<T>` for async scenarios.
- IG-39: `SemaphoreSlim` used for async-compatible rate limiting.
- IG-40: `Interlocked` for simple atomic operations — no `lock` for counter increments.
- IG-41: `lock` objects are private readonly fields — never `lock(this)`, never `lock` on public objects.
- IG-42: `ConcurrentDictionary<K,V>` preferred over `Dictionary<K,V>` with manual locking.

---

## 8. Pattern Matching

- IG-43: `switch` expression used over `switch` statement for value-returning logic.
- IG-44: `is not null` preferred over `!= null`.
- IG-45: Deconstruction used for tuples and records: `var (id, name) = GetValues()`.
- IG-46: List patterns (C# 11+) used for sequence matching: `order.Items is [var first, ..]`.

---

## 9. Anti-Patterns (Forbidden)

| Anti-Pattern | Why |
|---|---|
| `.Result` / `.Wait()` on Task | Deadlock risk |
| `async void` (non-event) | Unobservable exceptions |
| `#nullable disable` without ADR | Defeats null safety |
| `!` null-forgiving without comment | Hides nullability contract |
| `lock(this)` | Public lock object, deadlock risk |
| LINQ side effects in Select | Unpredictable execution |
| Empty `catch {}` | Silent failure |
| `var` for ambiguous types | Reduces readability |
