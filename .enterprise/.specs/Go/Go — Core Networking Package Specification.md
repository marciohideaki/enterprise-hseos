# Go — Core Networking Package Specification
## Generic / Project-Agnostic (Backend)

**Version:** 1.0
**Status:** Canonical / Normative Specification
**Runtime:** Go 1.22+

> Specifies the **Core Networking Package** for Go backend services.
> Single mandatory entry point for all outbound HTTP communication.

---

## 1. Purpose

The Core Networking Package provides:
- Consistent error handling and typed result model
- Centralized authentication and token propagation
- Retry, timeout, and circuit breaker policies
- Observability (logs, metrics, traces)
- Contract safety (tolerant deserialization)

This package is **mandatory** for all external HTTP integrations. Direct use of `net/http` client outside this package is forbidden.

---

## 2. Technology Baseline

- **HTTP client:** stdlib `net/http` with custom transport
- **Resilience:** `failsafe-go` or custom retry/circuit-breaker wrapper
- **Serialization:** `encoding/json` with unknown field tolerance
- **Observability:** OpenTelemetry Go SDK + `log/slog`

---

## 3. Mandatory Usage Rules

- All outbound HTTP calls **must go through this package**.
- Direct `http.Get`, `http.Post`, or `http.Client{}` instantiation outside this package is **forbidden**.
- Each integration target has its own configured client — no shared generic client.

---

## 4. Public API Surface

### 4.1 Core Client Interface

```go
type NetworkClient interface {
    Send(ctx context.Context, req NetworkRequest, target any) Result[any]
    SendTyped[T any](ctx context.Context, req NetworkRequest) Result[T]
}
```

### 4.2 Request Model

```go
type NetworkRequest struct {
    Method      string
    Path        string
    Body        any
    Headers     map[string]string
    QueryParams map[string]string
    Timeout     *time.Duration // nil = use default
}
```

### 4.3 Result Model

```go
type Result[T any] struct {
    Value T
    Err   NetworkError
}

func OK[T any](value T) Result[T] {
    return Result[T]{Value: value}
}

func Fail[T any](err NetworkError) Result[T] {
    return Result[T]{Err: err}
}

func (r Result[T]) IsSuccess() bool {
    return r.Err == nil
}
```

---

## 5. Error Model

```go
type NetworkError interface {
    networkError()
    Error() string
}

type NetworkUnavailable struct{ Message string }
type NetworkTimeout struct{ Operation string; Elapsed time.Duration }
type NetworkUnauthorized struct{ Message string }
type NetworkForbidden struct{ Message string }
type NetworkNotFound struct{ Resource string }
type NetworkValidationError struct{ Message string; Fields map[string]string }
type NetworkServerError struct{ StatusCode int; Message string }
type NetworkParsingError struct{ Message string; RawBody string }
type NetworkCircuitOpen struct{ Dependency string }
type NetworkUnknownError struct{ Message string }

// Each implements NetworkError interface via networkError() and Error()
```

---

## 6. Authentication & Token Handling

- Auth headers injected automatically via custom `http.RoundTripper`.
- Token refresh centralized — no feature may implement its own token refresh.
- Service-to-service tokens resolved from secret manager at startup.
- Refresh failures surface as `Fail[T](NetworkUnauthorized{...})`.

---

## 7. Resilience Configuration

Each client configures (values externalized in env / config file):

```go
type ClientConfig struct {
    BaseURL               string
    DefaultTimeout        time.Duration // default: 5s
    RetryMaxAttempts      int           // default: 3
    RetryBaseDelay        time.Duration // default: 100ms
    RetryMaxDelay         time.Duration // default: 10s
    CircuitBreakerThreshold float64     // default: 0.5 (50%)
    CircuitBreakerWaitDuration time.Duration // default: 30s
}
```

All values loaded from environment — never hardcoded.

---

## 8. Serialization Rules

- `json.Decoder` with `DisallowUnknownFields` = false (default) — extra fields silently ignored.
- Missing optional fields use zero values — no errors.
- Unknown enum values mapped to explicit `Unknown` constant.

---

## 9. Observability

- Every outbound request emits a **span** with: target service, method, path, status, duration.
- Metrics: `http_client_requests_total` counter and `http_client_duration_seconds` histogram per target.
- `correlationId` injected as header on all outbound requests from `context.Context`.
- No sensitive data logged — headers and bodies redacted by default.

---

## 10. Testability

- HTTP transport mockable via `net/http/httptest` or WireMock.
- All error paths must have unit tests.
- `RoundTripper` interface used for injection in tests.

---

## 11. Versioning & Evolution

- Breaking changes to public API require major version bump and ADR.
- New error types may be added (additive) — existing types must not change semantics.

---

## Summary

Single mandatory entry point for all outbound HTTP. Safe by default, resilient, observable, and testable.
Compliance is mandatory.
