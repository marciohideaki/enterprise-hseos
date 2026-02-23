# CSharp DotNET — Modern Features Standard

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** C# 12+ / .NET 8+ features — adoption guidance and mandatory patterns

> This document defines **mandatory patterns and adoption guidance** for modern C# and .NET features.
> Rules marked as **MANDATORY** must be followed in all new code targeting C# 12+ / .NET 8+.
> Rules marked as **PREFERRED** represent strong guidance; deviations require explicit justification in the PR.

---

## Referenced Platform Standards (MANDATORY)

These rules must be applied together with:

- **C# / .NET Architecture Standard**
- **C# / .NET Non-Functional Requirements (NFR)**
- **C# / .NET Build & Toolchain Standard**
- **Pull Request Checklist — Standard**

---

## 1. .NET Aspire

- MF-CS-01: .NET Aspire is the **mandatory orchestration model** for local development of solutions with two or more services (API, Worker, Cache, Database, Message Broker).
- MF-CS-02: The orchestration entry point **must** be an `AppHost` project (type `Aspire.Hosting`) separate from all service projects.
- MF-CS-03: Service-to-service communication **must** use Aspire's built-in Service Discovery via named resources — hardcoded hostnames and ports in `appsettings.json` are prohibited in multi-service solutions.
- MF-CS-04: The Aspire Dashboard provides distributed traces, logs and metrics out-of-the-box; no additional local observability tooling is required for development environments.
- MF-CS-05: All Aspire-managed services must emit telemetry via the OpenTelemetry SDK. The `AddServiceDefaults()` extension **must** be called in every participating service's `Program.cs`.
- MF-CS-06: OpenTelemetry resource attributes (`service.name`, `service.version`) **must** be populated via `AddServiceDefaults()` — do not configure OTLP exporters manually in development.
- MF-CS-07: **Do NOT use .NET Aspire** for standalone single-service applications, CLI tools, or libraries. The overhead is unjustified.
- MF-CS-08: The `AppHost` project **must not** contain business logic. It is infrastructure-only.

**Minimal AppHost example (2 services + Redis):**

```csharp
// AppHost/Program.cs
var builder = DistributedApplication.CreateBuilder(args);

var cache = builder.AddRedis("cache");

var api = builder.AddProject<Projects.MyApp_Api>("api")
    .WithReference(cache);

builder.AddProject<Projects.MyApp_Worker>("worker")
    .WithReference(api)
    .WithReference(cache);

builder.Build().Run();
```

```csharp
// MyApp.Api/Program.cs  (and identically in MyApp.Worker/Program.cs)
var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults(); // Aspire: OpenTelemetry + health checks + service discovery
// ... remaining registrations
```

---

## 2. Source Generators

- MF-CS-09: Source Generators are the **mandatory alternative to reflection** in any code path that executes at scale (serialization, logging, mapping, proxy generation).
- MF-CS-10: `[LoggerMessage]` **must** be used for all structured log messages in hot paths. Direct `ILogger.Log*` interpolated string calls are prohibited in loops or high-throughput paths.
- MF-CS-11: `System.Text.Json` source generation (`JsonSerializerContext`) **must** be used for all serialization in APIs and Workers. Reflection-based `JsonSerializer.Serialize<T>()` without a context is prohibited in new code.
- MF-CS-12: `[GeneratedRegex]` **must** be used for any `Regex` instance used in a hot path or instantiated more than once. `new Regex(...)` in loops is a build warning violation.
- MF-CS-13: Custom Source Generators must implement `IIncrementalGenerator` (not the deprecated `ISourceGenerator`).
- MF-CS-14: Source Generator output **must not** be checked into source control. The `obj/` generated files are build artifacts.
- MF-CS-15: To debug a Source Generator, attach to the compiler using `<IsRoslynComponent>true</IsRoslynComponent>` and set `launchSettings` to `DebugType: clrdbg` on the generator project.
- MF-CS-16: Source Generators are **preferred** over T4 templates, Roslyn scripting, or runtime `Reflection.Emit` for any compile-time code generation need.

**`[LoggerMessage]` — zero-alloc structured logging (MANDATORY in hot paths):**

```csharp
public static partial class OrderLogMessages
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Order {OrderId} accepted by {UserId}")]
    public static partial void OrderAccepted(this ILogger logger, Guid orderId, string userId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Order {OrderId} rejected: {Reason}")]
    public static partial void OrderRejected(this ILogger logger, Guid orderId, string reason);
}
// Usage: _logger.OrderAccepted(order.Id, userId);
```

**`System.Text.Json` source generation (MANDATORY for serialization):**

```csharp
[JsonSerializable(typeof(OrderDto))]
[JsonSerializable(typeof(List<OrderDto>))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
internal partial class AppJsonContext : JsonSerializerContext { }

// Registration in Program.cs:
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default));
```

**`[GeneratedRegex]` (MANDATORY for hot-path regex):**

```csharp
public static partial class Patterns
{
    [GeneratedRegex(@"^[A-Z]{2}\d{6}$", RegexOptions.Compiled)]
    public static partial Regex OrderReference();
}
// Usage: Patterns.OrderReference().IsMatch(input);
```

---

## 3. Minimal APIs

- MF-CS-17: **Use Minimal APIs** for: microservices, CRUD endpoints with simple authorization, and any new API surface with fewer than three related actions per resource.
- MF-CS-18: **Use Controller-based APIs** when: the endpoint requires multiple `ActionResult` types with different status codes handled via filters/attributes, inheritance-based behavior, or complex model binding pipelines.
- MF-CS-19: Minimal API endpoints **must not** be registered directly in `Program.cs`. Each feature **must** expose an `IEndpointRouteBuilder` extension method in its own file.
- MF-CS-20: Route groups (`MapGroup`) **must** be used to share prefixes, authorization policies and filters among related endpoints. Repeating `.RequireAuthorization()` per endpoint is prohibited.
- MF-CS-21: `TypedResults` **must** be used instead of `Results` for all endpoint return values. `TypedResults` enables accurate OpenAPI schema generation without additional attributes.
- MF-CS-22: Cross-cutting concerns (input validation, request logging, rate limiting) **must** be implemented as `IEndpointFilter` — not inlined in the handler lambda.
- MF-CS-23: FluentValidation integration **must** use an `IEndpointFilter` that resolves `IValidator<T>` from DI and returns `TypedResults.ValidationProblem(errors)` on failure.
- MF-CS-24: OpenAPI metadata (`WithName`, `WithSummary`, `WithTags`, `Produces<T>`) **must** be declared on each endpoint to ensure the generated spec is accurate and complete.

**Feature endpoint — organized pattern (MANDATORY structure):**

```csharp
// Features/Orders/OrderEndpoints.cs
public static class OrderEndpoints
{
    public static IEndpointRouteBuilder MapOrderEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/orders")
            .RequireAuthorization()
            .AddEndpointFilter<ValidationFilter<CreateOrderRequest>>()
            .WithTags("Orders");

        group.MapPost("/", CreateOrder).WithName("CreateOrder").WithSummary("Place a new order");
        group.MapGet("/{id:guid}", GetOrder).WithName("GetOrder").WithSummary("Get order by ID");
        return app;
    }

    private static async Task<Results<Created<OrderDto>, ValidationProblem>> CreateOrder(
        CreateOrderRequest req, IOrderService svc, CancellationToken ct)
    {
        var order = await svc.CreateAsync(req, ct);
        return TypedResults.Created($"/orders/{order.Id}", order);
    }

    private static async Task<Results<Ok<OrderDto>, NotFound>> GetOrder(
        Guid id, IOrderService svc, CancellationToken ct)
        => await svc.GetByIdAsync(id, ct) is { } order
            ? TypedResults.Ok(order)
            : TypedResults.NotFound();
}
```

```csharp
// Program.cs — single registration line per feature
app.MapOrderEndpoints();
```

---

## 4. gRPC em .NET

- MF-CS-25: **Use gRPC** for: synchronous inter-service communication requiring high throughput, strongly typed contracts, or streaming (server, client, or bidirectional).
- MF-CS-26: **Do NOT use gRPC** for: public-facing browser APIs (use REST), or when the caller cannot establish HTTP/2 connections (e.g., legacy .NET Framework clients — use gRPC-Web or REST).
- MF-CS-27: `.proto` files **must** reside in `src/Contracts/proto/` and be referenced via `<Protobuf>` MSBuild items. Proto files must not be duplicated across service projects.
- MF-CS-28: For browser clients that require gRPC, `grpc-web` protocol **must** be enabled via `app.UseGrpcWeb()` and `EnableGrpcWeb()` on the endpoint — do not expose raw gRPC on public ports.
- MF-CS-29: gRPC Interceptors **must** be used for cross-cutting concerns: authentication (`AuthInterceptor`), structured logging, distributed tracing correlation, and transient retry with exponential backoff.
- MF-CS-30: gRPC services **must** implement the standard gRPC Health Checking Protocol (`Grpc.HealthCheck`) and expose it on the same port as the service.
- MF-CS-31: Proto compilation **must** be driven by MSBuild using the `Grpc.Tools` package. Manual `protoc` invocations outside of the build pipeline are prohibited.
- MF-CS-32: Generated gRPC client and server stubs **must not** be committed to source control. They are build-time artifacts.

**Unary + server-streaming service (proto and implementation):**

```protobuf
// src/Contracts/proto/orders.proto
syntax = "proto3";
option csharp_namespace = "MyApp.Contracts.Grpc";

service OrderService {
  rpc GetOrder (GetOrderRequest) returns (OrderResponse);
  rpc StreamOrders (StreamOrdersRequest) returns (stream OrderResponse);
}
message GetOrderRequest { string order_id = 1; }
message StreamOrdersRequest { string customer_id = 1; }
message OrderResponse { string order_id = 1; string status = 2; }
```

```csharp
// Services/OrderGrpcService.cs
public sealed class OrderGrpcService(IOrderRepository repo) : OrderService.OrderServiceBase
{
    public override async Task<OrderResponse> GetOrder(
        GetOrderRequest request, ServerCallContext ctx)
    {
        var order = await repo.GetByIdAsync(request.OrderId, ctx.CancellationToken)
            ?? throw new RpcException(new Status(StatusCode.NotFound, "Order not found"));
        return new OrderResponse { OrderId = order.Id, Status = order.Status };
    }

    public override async Task StreamOrders(
        StreamOrdersRequest request, IServerStreamWriter<OrderResponse> stream, ServerCallContext ctx)
    {
        await foreach (var order in repo.StreamByCustomerAsync(request.CustomerId, ctx.CancellationToken))
            await stream.WriteAsync(new OrderResponse { OrderId = order.Id, Status = order.Status });
    }
}
```

---

## 5. Primary Constructors

- MF-CS-33: Primary constructors **must** be used for all `class` and `struct` types whose sole initialization need is dependency injection or simple value capture (services, handlers, validators, query objects).
- MF-CS-34: **Do NOT use** primary constructors for domain entities, aggregates, or value objects that enforce invariants — use an explicit constructor with validation logic instead.
- MF-CS-35: Primary constructor parameters are implicitly captured as fields by the compiler. They **must not** be reassigned after construction. Treat them as `readonly`.
- MF-CS-36: Mixing primary constructor parameters with manually declared backing fields for the same dependency is prohibited. Choose one form consistently per type.
- MF-CS-37: The `required` keyword **must** be used on properties that must be set by object initializers and cannot be set via the primary constructor (typically for DTOs and configuration records).
- MF-CS-38: When a primary constructor parameter shadows a property or field name, a compiler warning is emitted. Rename to avoid ambiguity.

**Before / After — service with DI:**

```csharp
// BEFORE (C# 11 and earlier — verbose)
public sealed class OrderService : IOrderService
{
    private readonly IOrderRepository _repo;
    private readonly ILogger<OrderService> _logger;

    public OrderService(IOrderRepository repo, ILogger<OrderService> logger)
    {
        _repo = repo;
        _logger = logger;
    }
}
```

```csharp
// AFTER (C# 12 primary constructor — MANDATORY for new services)
public sealed class OrderService(IOrderRepository repo, ILogger<OrderService> logger) : IOrderService
{
    public async Task<OrderDto?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        logger.OrderLookup(id);
        return await repo.GetByIdAsync(id, ct);
    }
}
```

**`required` for DTOs:**

```csharp
public sealed class CreateOrderRequest
{
    public required Guid CustomerId { get; init; }
    public required List<OrderLineDto> Lines { get; init; }
}
```

---

## 6. Collection Expressions

- MF-CS-39: The `[..]` collection expression syntax **must** be used in all new code for initializing arrays, `List<T>`, `ImmutableArray<T>`, `Span<T>`, and `ReadOnlySpan<T>`. The older `new List<T> { }` and `new T[] { }` forms are PREFERRED to be migrated and are prohibited in new code.
- MF-CS-40: The spread operator (`..`) **must** be used for collection concatenation in place of `.Concat()` calls that produce intermediate enumerables in hot paths.
- MF-CS-41: When the element type can be inferred from the method parameter or assignment target, explicit type arguments on the expression are redundant and must be omitted.
- MF-CS-42: Collection expressions on `Span<T>` and `ReadOnlySpan<T>` targets are stack-allocated by the compiler when the size is a compile-time constant — prefer this over `stackalloc` for readability.
- MF-CS-43: Collection expressions used in `switch` patterns and `is` pattern matching are evaluated without allocation. Prefer them over LINQ `.SequenceEqual()` for small, known sets.
- MF-CS-44: `CollectionBuilder` attribute-based custom collection types **may** support collection expression syntax; if a team-owned collection type is commonly initialized inline, implement `CollectionBuilder` support.

**Collection expression examples:**

```csharp
// Arrays and lists — MANDATORY new syntax
int[] primes = [2, 3, 5, 7, 11];
List<string> tags = ["urgent", "billing", "escalated"];
ImmutableArray<Guid> ids = [id1, id2, id3];

// Spread for concatenation — replaces .Concat().ToList()
List<string> allTags = [..defaultTags, ..requestTags, "audit"];

// ReadOnlySpan — zero-alloc constant set
ReadOnlySpan<string> validStatuses = ["Pending", "Confirmed", "Shipped"];
if (validStatuses.Contains(order.Status)) { /* ... */ }

// Method parameter inference
void ProcessBatch(IEnumerable<Guid> ids) { /* ... */ }
ProcessBatch([id1, id2, id3]); // no cast needed
```

---

## 7. Interceptors e Code Analysis

- MF-CS-45: C# Interceptors (C# 12, feature flag `<InterceptorsPreviewNamespaces>`) are **experimental**. They **must only** be used inside Source Generator output — never hand-authored in production code.
- MF-CS-46: The primary valid use case for Interceptors is Source Generators that need to redirect specific call sites to generated implementations (e.g., EF Core compile-time query compilation, logging, serialization). All other uses require Tech Lead approval.
- MF-CS-47: Roslyn Analyzers (`DiagnosticAnalyzer` + `CodeFixProvider`) **must** be created for any architectural rule that cannot be expressed as a compiler error but must be enforced across all services (e.g., forbidden namespace references, required interface implementation, naming violations).
- MF-CS-48: Custom Analyzers **must** be distributed as a NuGet package referenced in the shared `Directory.Build.props` with `<PrivateAssets>all</PrivateAssets>` so they apply to all projects without being transitive runtime dependencies.

**Minimal Roslyn Analyzer structure:**

```csharp
[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class NoBareRepositoryCallAnalyzer : DiagnosticAnalyzer
{
    public static readonly DiagnosticDescriptor Rule = new(
        id: "ARCH001",
        title: "Direct repository call outside Application layer",
        messageFormat: "'{0}' must not be called directly from '{1}' — use a service or handler",
        category: "Architecture",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => [Rule];

    public override void Initialize(AnalysisContext ctx)
    {
        ctx.EnableConcurrentExecution();
        ctx.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        ctx.RegisterSyntaxNodeAction(Analyze, SyntaxKind.InvocationExpression);
    }

    private static void Analyze(SyntaxNodeAnalysisContext ctx) { /* ... */ }
}
```

**Interceptor — generated code only (DO NOT hand-author):**

```csharp
// This code is emitted by a Source Generator — never write this by hand
namespace MyApp.Generated
{
    file static class Interceptors
    {
        [System.Runtime.CompilerServices.InterceptsLocation(
            "src/Features/Orders/OrderService.cs", line: 42, character: 18)]
        public static OrderDto? GetByIdIntercepted(this IOrderRepository repo, Guid id)
            => GeneratedOrderQueries.GetById(repo, id); // compile-time optimized path
    }
}
```

---

## Summary Table

| Rule ID | Area | Obligation |
|---|---|---|
| MF-CS-01 | .NET Aspire | MANDATORY for multi-service local dev |
| MF-CS-02 | .NET Aspire | AppHost must be a dedicated project |
| MF-CS-03 | .NET Aspire | Service Discovery via Aspire — no hardcoded hosts |
| MF-CS-05 | .NET Aspire | `AddServiceDefaults()` in every service |
| MF-CS-10 | Source Generators | `[LoggerMessage]` in hot paths |
| MF-CS-11 | Source Generators | `JsonSerializerContext` for all serialization |
| MF-CS-12 | Source Generators | `[GeneratedRegex]` for hot-path regex |
| MF-CS-17 | Minimal APIs | Minimal for simple/micro, Controllers for complex |
| MF-CS-19 | Minimal APIs | No direct registration in `Program.cs` |
| MF-CS-21 | Minimal APIs | `TypedResults` — never bare `Results` |
| MF-CS-25 | gRPC | gRPC for high-perf inter-service only |
| MF-CS-27 | gRPC | Proto files in `src/Contracts/proto/` |
| MF-CS-33 | Primary Constructors | MANDATORY for services and handlers |
| MF-CS-34 | Primary Constructors | Forbidden in domain entities with invariants |
| MF-CS-39 | Collection Expressions | `[..]` syntax in all new code |
| MF-CS-45 | Interceptors | Experimental — Source Generators only |
| MF-CS-47 | Code Analysis | Roslyn Analyzers for architectural rules |
| MF-CS-48 | Code Analysis | Distributed via NuGet in `Directory.Build.props` |
