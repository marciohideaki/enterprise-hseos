# C# / .NET — Core Networking Package Specification
## Generic / Project-Agnostic (Backend)

**Version:** 1.0  
**Status:** Canonical / Normative Specification  
**Runtime:** .NET 8 / .NET 9+  

> This document specifies the **Core Networking Package** for C# / .NET backend services.
>
> It defines the **single, mandatory entry point** for all outbound HTTP communication and is designed to be:
> - safe for human developers
> - safe for AI-assisted engineering
> - aligned with the C# / .NET Architecture Standard, FR and NFR
>
> This specification is **project-agnostic** and reusable across services and modules.

---

## 1. Purpose

The Core Networking Package provides a **standardized outbound communication layer** that enforces:

- Consistent error handling
- Predictable, typed result models
- Centralized authentication and token propagation
- Retry, timeout and cancellation policies
- Observability and diagnostics
- Contract safety across backend evolution

This package is **mandatory** for all external HTTP integrations.

---

## 2. Scope & Responsibilities

The Core Networking Package **must**:

- Encapsulate all outbound HTTP communication
- Provide a standard `Result<T>` abstraction
- Map infrastructure and protocol failures to typed application errors
- Centralize authentication, authorization headers and token refresh
- Enforce retry, timeout and cancellation policies
- Propagate `CorrelationId` and optional `Idempotency-Key`
- Emit structured logs, metrics and traces

The package **must not**:

- Contain business logic
- Contain domain rules
- Depend on application-specific use cases

---

## 3. Mandatory Usage Rules

- All outbound HTTP calls **must go through this package**
- Direct usage of `HttpClient` outside this package is forbidden
- Features, modules and services **must not implement their own networking abstractions**

Violations require an explicit **ADR approval**.

---

## 4. Public API Surface

The public API **must be minimal, explicit and stable**.

### 4.1 Core Client Interface

```csharp
public interface INetworkClient
{
    Task<Result<TResponse>> SendAsync<TResponse>(
        NetworkRequest request,
        CancellationToken cancellationToken = default);
}
```

---

### 4.2 Request Model

```csharp
public sealed class NetworkRequest
{
    public HttpMethod Method { get; init; } = HttpMethod.Get;
    public string Path { get; init; } = default!;
    public object? Body { get; init; }
    public IReadOnlyDictionary<string, string>? Headers { get; init; }
    public IReadOnlyDictionary<string, string>? Query { get; init; }
    public TimeSpan? TimeoutOverride { get; init; }
}
```

Rules:
- Request objects are immutable
- No business semantics are allowed in the request

---

## 5. Result Model (Mandatory)

All outbound calls **must return a `Result<T>`**.

```csharp
public readonly record struct Result<T>(bool IsSuccess, T? Value, NetworkError? Error)
{
    public static Result<T> Ok(T value) => new(true, value, null);
    public static Result<T> Fail(NetworkError error) => new(false, default, error);
}
```

Rules:
- Exceptions must not cross the networking boundary
- Failures are represented **only** as typed errors

---

## 6. Error Model (Mandatory)

### 6.1 Base Error Type

```csharp
public abstract record NetworkError(string Code, string Message);
```

### 6.2 Standard Error Types

- `NetworkUnavailableError`
- `TimeoutError`
- `UnauthorizedError`
- `ForbiddenError`
- `NotFoundError`
- `ValidationError`
- `ServerError`
- `ParsingError`
- `UnknownError`

Rules:
- Error types must be deterministic and serializable
- Error semantics must not change across versions

---

## 7. Error Mapping

The package **must implement a centralized error mapper**.

Responsibilities:
- Map HTTP status codes to `NetworkError`
- Map transport-level failures to `NetworkError`
- Map deserialization errors to `ParsingError`
- Preserve contextual information without leaking sensitive data

```csharp
NetworkError MapError(HttpResponseMessage response, string? payload);
```

---

## 8. Authentication & Authorization

### 8.1 Token Handling

- Authentication headers must be injected automatically
- Token refresh must be centralized and synchronized
- Refresh failures must surface as controlled authentication errors

### 8.2 Rules

- No feature may access tokens directly
- No feature may implement its own authentication handler
- Secrets must be resolved from secure configuration providers

---

## 9. Retry, Timeout & Cancellation

- Retry policies must be:
  - bounded
  - configurable
  - applied only to transient failures

- Global default timeouts are mandatory
- Per-request timeout overrides are allowed
- Cancellation tokens must be respected end-to-end

---

## 10. Data Contracts & Compatibility

- Response deserialization **must tolerate missing fields**
- Unknown fields **must be ignored**
- Enum parsing **must support an explicit `Unknown` fallback**
- Breaking contract changes require new client versions

---

## 11. Logging & Observability

### 11.1 Logging Rules

- Logs must be structured
- Logs must never contain:
  - secrets
  - tokens
  - personal data

### 11.2 Telemetry

The package must emit:
- request start / end events
- failure classification metrics
- latency histograms
- dependency health signals

---

## 12. Testability

The Core Networking Package **must be fully testable**.

- HTTP transport must be mockable
- Error mapping must be unit-tested
- Retry, timeout and auth flows must be deterministic in tests

---

## 13. AI-Assisted Engineering Rules

- AI-generated code **must use this package exclusively** for HTTP communication
- AI must not introduce direct `HttpClient` usage
- Deviations require human review and ADR approval

---

## 14. Versioning & Evolution

- The public API must follow semantic versioning
- Breaking changes require:
  - major version bump
  - ADR approval
  - migration notes

---

## Summary

This Core Networking Package Specification defines the **single source of truth for outbound HTTP communication** in C# / .NET backends.

It enables:
- predictable behavior
- consistent error handling
- secure and observable integrations
- safe AI-assisted development
- long-term architectural stability

Compliance is **mandatory**.

