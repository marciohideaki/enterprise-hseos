# C++ — Core Networking Package Specification
## Generic / Project-Agnostic (Backend)

**Version:** 1.0
**Status:** Canonical / Normative Specification
**Runtime:** C++20 / C++23 | CMake 3.28+

> Specifies the **Core Networking Package** for C++ backend services.
> Single mandatory entry point for all outbound HTTP communication.

---

## 1. Purpose

The Core Networking Package provides:
- Consistent error handling and typed result model
- Centralized authentication and token propagation
- Retry, timeout, and circuit breaker policies
- Observability (logs, metrics, traces)
- Contract safety (tolerant deserialization)

This package is **mandatory** for all external HTTP integrations. Direct use of `libcurl`, `cpp-httplib`, or raw socket code outside this package is forbidden.

---

## 2. Technology Baseline

- **HTTP client:** `libcurl` (wrapped) or `cpp-httplib` (synchronous) / Boost.Beast (async)
- **Resilience:** Custom RAII-based retry/circuit-breaker middleware
- **Serialization:** `nlohmann/json` with `allow_exceptions = false`
- **Observability:** OpenTelemetry C++ SDK + `spdlog`
- **TLS:** OpenSSL 3+ or BoringSSL

---

## 3. Mandatory Usage Rules

- All outbound HTTP calls **must go through this package**.
- Direct instantiation of `libcurl`, `cpp-httplib`, or Boost.Beast outside this package is **forbidden**.
- Each integration target has its own configured client instance — no shared generic client.

---

## 4. Public API Surface

### 4.1 Core Client Interface

```cpp
// pkg/networking/network_client.h
class INetworkClient {
public:
    virtual ~INetworkClient() = default;

    template<typename T>
    [[nodiscard]] Result<T> Send(const NetworkRequest& request) = 0;

    [[nodiscard]] virtual Result<nlohmann::json> SendRaw(
        const NetworkRequest& request) = 0;
};
```

### 4.2 Request Model

```cpp
// pkg/networking/network_request.h
enum class HttpMethod { GET, POST, PUT, PATCH, DELETE };

struct NetworkRequest {
    HttpMethod method;
    std::string path;
    std::optional<nlohmann::json> body;
    std::map<std::string, std::string> headers;
    std::map<std::string, std::string> queryParams;
    std::optional<std::chrono::milliseconds> timeoutOverride; // nullopt = default
};
```

### 4.3 Result Model

```cpp
// pkg/networking/result.h
template<typename T>
class Result {
public:
    [[nodiscard]] static Result<T> Ok(T value) {
        return Result<T>{std::move(value), std::nullopt};
    }

    [[nodiscard]] static Result<T> Fail(NetworkError error) {
        return Result<T>{std::nullopt, std::move(error)};
    }

    [[nodiscard]] bool IsSuccess() const noexcept {
        return value_.has_value();
    }

    [[nodiscard]] const T& Value() const { return value_.value(); }
    [[nodiscard]] const NetworkError& Error() const { return error_.value(); }

private:
    Result(std::optional<T> value, std::optional<NetworkError> error)
        : value_(std::move(value)), error_(std::move(error)) {}

    std::optional<T> value_;
    std::optional<NetworkError> error_;
};
```

---

## 5. Error Model

```cpp
// pkg/networking/network_error.h
struct NetworkUnavailable   { std::string message; };
struct NetworkTimeout       { std::string operation; std::chrono::milliseconds elapsed; };
struct NetworkUnauthorized  { std::string message; };
struct NetworkForbidden     { std::string message; };
struct NetworkNotFound      { std::string resource; };
struct NetworkValidationError {
    std::string message;
    std::map<std::string, std::string> fields;
};
struct NetworkServerError   { int statusCode; std::string message; };
struct NetworkParsingError  { std::string message; std::string rawBody; };
struct NetworkCircuitOpen   { std::string dependency; };
struct NetworkUnknownError  { std::string message; };

using NetworkError = std::variant<
    NetworkUnavailable,
    NetworkTimeout,
    NetworkUnauthorized,
    NetworkForbidden,
    NetworkNotFound,
    NetworkValidationError,
    NetworkServerError,
    NetworkParsingError,
    NetworkCircuitOpen,
    NetworkUnknownError
>;
```

---

## 6. Authentication & Token Handling

- Auth headers injected automatically via pre-request interceptor (decorator pattern).
- Token refresh centralized — no feature may implement its own token refresh.
- Service-to-service tokens resolved from secret manager at startup.
- Refresh failures surface as `Result<T>::Fail(NetworkUnauthorized{...})`.

---

## 7. Resilience Configuration

Each client instance configures (values externalized in config file / env):

```cpp
struct ClientConfig {
    std::string baseUrl;
    std::chrono::milliseconds defaultTimeout{5000};    // 5s
    int retryMaxAttempts{3};
    std::chrono::milliseconds retryBaseDelay{100};     // 100ms
    std::chrono::milliseconds retryMaxDelay{10000};    // 10s
    double circuitBreakerThreshold{0.50};              // 50%
    std::chrono::seconds circuitBreakerWaitDuration{30};
};
```

All values loaded from configuration — **never hardcoded**.

---

## 8. Serialization Rules

- `nlohmann::json` with `allow_exceptions = false` — parse errors return `NetworkParsingError`.
- Missing optional fields use `std::optional` / default values — never throw.
- Unknown JSON keys silently ignored — no strict mode.
- Unknown enum values mapped to explicit `Unknown` enum constant.

---

## 9. Observability

- Every outbound request emits a **span** with: target service, method, path, status, duration.
- Metrics: `http_client_requests_total` counter and `http_client_duration_ms` histogram per target.
- `correlationId` injected as header on all outbound requests.
- No sensitive data logged — headers and bodies redacted by default.

---

## 10. Testability

- HTTP transport injected via `INetworkClient` interface — mockable with Google Mock.
- `FakeNetworkClient` provided in test utilities for unit tests.
- WireMock or `cpp-httplib` mock server usable for integration tests.
- All error paths must have unit tests.

---

## 11. Thread Safety

- `INetworkClient` implementations must be thread-safe.
- Connection pool managed internally — callers do not manage connections.
- Circuit breaker state protected by `std::atomic` / `std::mutex`.

---

## 12. Versioning & Evolution

- Breaking changes to public API require major version bump and ADR.
- New error types may be added to `NetworkError` variant (additive).
- Existing error types must not change semantics or field names.

---

## Summary

Single mandatory entry point for all outbound HTTP. Safe by default, resilient, observable, and testable.
Compliance is mandatory.
