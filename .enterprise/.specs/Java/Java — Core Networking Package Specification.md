# Java — Core Networking Package Specification
## Generic / Project-Agnostic (Backend)

**Version:** 1.0
**Status:** Canonical / Normative Specification
**Runtime:** Java 21+ / Spring Boot 3+

> Specifies the **Core Networking Package** for Java backend services.
> Single mandatory entry point for all outbound HTTP communication.

---

## 1. Purpose

The Core Networking Package provides:
- Consistent error handling and typed result model
- Centralized authentication and token propagation
- Retry, timeout, and circuit breaker policies
- Observability (logs, metrics, traces)
- Contract safety (tolerant deserialization)

This package is **mandatory** for all external HTTP integrations. Direct use of `RestTemplate`, `WebClient`, or `HttpClient` outside this package is forbidden.

---

## 2. Technology Baseline

- **HTTP client:** Spring WebClient (reactive) or Spring `RestClient` (Java 21+)
- **Resilience:** Resilience4j (`TimeLimiter`, `Retry`, `CircuitBreaker`)
- **Serialization:** Jackson with `DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES = false`
- **Observability:** Micrometer + OpenTelemetry instrumentation

---

## 3. Mandatory Usage Rules

- All outbound HTTP calls **must go through this package**.
- Direct instantiation of HTTP client libraries outside this package is **forbidden**.
- Each integration target has its own configured client bean — no shared generic client.

---

## 4. Public API Surface

### 4.1 Core Client Interface

```java
public interface NetworkClient {
    <T> Result<T> send(NetworkRequest request, Class<T> responseType);
    <T> Result<T> send(NetworkRequest request, TypeReference<T> typeRef);
}
```

### 4.2 Request Model

```java
public record NetworkRequest(
    HttpMethod method,
    String path,
    Object body,
    Map<String, String> headers,
    Map<String, String> queryParams,
    Duration timeoutOverride   // nullable — uses default if null
) {}
```

### 4.3 Result Model

```java
public sealed interface Result<T> {
    record Success<T>(T value) implements Result<T> {}
    record Failure<T>(NetworkError error) implements Result<T> {}

    default boolean isSuccess() { return this instanceof Success<T>; }
    static <T> Result<T> ok(T value) { return new Success<>(value); }
    static <T> Result<T> fail(NetworkError error) { return new Failure<>(error); }
}
```

---

## 5. Error Model

```java
public sealed interface NetworkError {
    record NetworkUnavailable(String message) implements NetworkError {}
    record Timeout(String operation, Duration elapsed) implements NetworkError {}
    record Unauthorized(String message) implements NetworkError {}
    record Forbidden(String message) implements NetworkError {}
    record NotFound(String resource) implements NetworkError {}
    record ValidationError(String message, Map<String, String> fields) implements NetworkError {}
    record ServerError(int statusCode, String message) implements NetworkError {}
    record ParsingError(String message, String rawBody) implements NetworkError {}
    record CircuitOpen(String dependency) implements NetworkError {}
    record UnknownError(String message) implements NetworkError {}
}
```

---

## 6. Authentication & Token Handling

- Authentication headers injected automatically via `ExchangeFilterFunction`.
- Token refresh centralized — no feature may implement its own token refresh.
- Service-to-service tokens resolved from secret manager at startup.
- Refresh failures surface as `Result.fail(new NetworkError.Unauthorized(...))`.

---

## 7. Resilience Configuration

Each client bean configures:

```java
// Applied via Resilience4j decorators
TimeLimiter  → configurable timeout per client (default: 5s)
Retry        → max 3 attempts, exponential backoff with jitter (100ms base, 10s max)
CircuitBreaker → failure threshold 50%, wait 30s, half-open 3 probes
```

All thresholds are **externalized** via `application.yml` — never hardcoded.

---

## 8. Serialization Rules

```java
ObjectMapper mapper = new ObjectMapper()
    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
    .configure(DeserializationFeature.READ_UNKNOWN_ENUM_VALUES_AS_NULL, false)
    // Enums must define UNKNOWN value; unknown values map to UNKNOWN
    .registerModule(new JavaTimeModule());
```

- Missing optional fields → use default value, do not throw.
- Unknown enum values → map to explicit `UNKNOWN` enum constant.

---

## 9. Observability

- Every outbound request emits a **span** with: target service, method, path, status, duration.
- Metrics: `http.client.requests` counter and `http.client.duration` histogram per target.
- `correlationId` injected as header on all outbound requests.
- No sensitive data logged — headers and bodies redacted by default.

---

## 10. Testability

- HTTP transport mockable via `MockWebServer` (OkHttp) or WireMock.
- Resilience policies testable via Resilience4j test utilities.
- All error paths must have unit tests.

---

## 11. Versioning & Evolution

- Breaking changes to public API require major version bump and ADR.
- New error types may be added (additive) — existing types must not change semantics.

---

## Summary

Single mandatory entry point for all outbound HTTP. Safe by default, resilient, observable, and testable.
Compliance is mandatory.
