# PHP — Core Networking Package Specification
## Generic / Project-Agnostic (Backend)

**Version:** 1.0
**Status:** Canonical / Normative Specification
**Runtime:** PHP 8.3+ / Laravel 11+ or Symfony 7+

> Specifies the **Core Networking Package** for PHP backend services.
> Single mandatory entry point for all outbound HTTP communication.

---

## 1. Purpose

The Core Networking Package provides:
- Consistent error handling and typed result model
- Centralized authentication and token propagation
- Retry, timeout, and circuit breaker policies
- Observability (logs, metrics, traces)
- Contract safety (tolerant deserialization)

This package is **mandatory** for all external HTTP integrations. Direct use of Guzzle, Symfony HttpClient, or `file_get_contents` for HTTP outside this package is forbidden.

---

## 2. Technology Baseline

- **HTTP client:** Guzzle 7+ or Symfony HttpClient
- **Resilience:** Custom middleware stack or `ganesha` circuit breaker
- **Serialization:** `symfony/serializer` or `league/fractal` with unknown property tolerance
- **Observability:** OpenTelemetry PHP SDK + Monolog

---

## 3. Mandatory Usage Rules

- All outbound HTTP calls **must go through this package**.
- Direct instantiation of Guzzle `Client` or Symfony `HttpClient` outside this package is **forbidden**.
- Each integration target has its own configured client — no shared generic client.

---

## 4. Public API Surface

### 4.1 Core Client Interface

```php
interface NetworkClientInterface
{
    /**
     * @template T
     * @param class-string<T> $responseType
     * @return Result<T>
     */
    public function send(NetworkRequest $request, string $responseType): Result;

    /**
     * @return Result<array<mixed>>
     */
    public function sendRaw(NetworkRequest $request): Result;
}
```

### 4.2 Request Model

```php
readonly class NetworkRequest
{
    public function __construct(
        public readonly HttpMethod $method,
        public readonly string $path,
        public readonly mixed $body = null,
        public readonly array $headers = [],
        public readonly array $queryParams = [],
        public readonly ?int $timeoutSeconds = null, // null = use default
    ) {}
}

enum HttpMethod: string
{
    case GET    = 'GET';
    case POST   = 'POST';
    case PUT    = 'PUT';
    case PATCH  = 'PATCH';
    case DELETE = 'DELETE';
}
```

### 4.3 Result Model

```php
/**
 * @template T
 */
readonly class Result
{
    private function __construct(
        private readonly mixed $value,
        private readonly ?NetworkError $error,
    ) {}

    /** @return self<T> */
    public static function ok(mixed $value): self
    {
        return new self($value, null);
    }

    public static function fail(NetworkError $error): self
    {
        return new self(null, $error);
    }

    public function isSuccess(): bool
    {
        return $this->error === null;
    }

    /** @return T */
    public function getValue(): mixed
    {
        return $this->value;
    }

    public function getError(): ?NetworkError
    {
        return $this->error;
    }
}
```

---

## 5. Error Model

```php
abstract readonly class NetworkError {}

readonly class NetworkUnavailable extends NetworkError
{
    public function __construct(public readonly string $message) {}
}

readonly class NetworkTimeout extends NetworkError
{
    public function __construct(
        public readonly string $operation,
        public readonly int $elapsedMs,
    ) {}
}

readonly class NetworkUnauthorized extends NetworkError
{
    public function __construct(public readonly string $message) {}
}

readonly class NetworkForbidden extends NetworkError
{
    public function __construct(public readonly string $message) {}
}

readonly class NetworkNotFound extends NetworkError
{
    public function __construct(public readonly string $resource) {}
}

readonly class NetworkValidationError extends NetworkError
{
    public function __construct(
        public readonly string $message,
        public readonly array $fields = [],
    ) {}
}

readonly class NetworkServerError extends NetworkError
{
    public function __construct(
        public readonly int $statusCode,
        public readonly string $message,
    ) {}
}

readonly class NetworkParsingError extends NetworkError
{
    public function __construct(
        public readonly string $message,
        public readonly string $rawBody,
    ) {}
}

readonly class NetworkCircuitOpen extends NetworkError
{
    public function __construct(public readonly string $dependency) {}
}
```

---

## 6. Authentication & Token Handling

- Auth headers injected automatically via Guzzle middleware or Symfony HttpClient decorator.
- Token refresh centralized — no feature may implement its own token refresh.
- Service-to-service tokens resolved from secret manager at startup.
- Refresh failures surface as `Result::fail(new NetworkUnauthorized(...))`.

---

## 7. Resilience Configuration

Each client configures (values externalized in `.env` / config):

```php
// Configured per integration target in config/networking.php
'timeout_seconds'         => env('HTTP_DEFAULT_TIMEOUT', 5),
'retry_max_attempts'      => env('HTTP_RETRY_MAX', 3),
'retry_base_delay_ms'     => env('HTTP_RETRY_BASE_MS', 100),
'retry_max_delay_ms'      => env('HTTP_RETRY_MAX_MS', 10000),
'circuit_breaker_threshold' => env('HTTP_CB_THRESHOLD', 50), // percent
'circuit_breaker_wait_s'  => env('HTTP_CB_WAIT', 30),
```

All thresholds **externalized** — never hardcoded.

---

## 8. Serialization Rules

- `FAIL_ON_UNKNOWN_PROPERTIES` = false — extra fields silently ignored.
- Missing optional fields use defaults — no exceptions.
- Unknown enum values map to explicit `UNKNOWN` case.

---

## 9. Observability

- Every outbound request emits a **span** with: target service, method, path, status, duration.
- Metrics: `http_client_requests_total` counter and `http_client_duration_seconds` histogram per target.
- `correlationId` injected as header on all outbound requests.
- No sensitive data logged — headers and bodies redacted by default.

---

## 10. Testability

- HTTP transport mockable via Guzzle `MockHandler` or Symfony `MockHttpClient`.
- All error paths must have unit tests.

---

## 11. Versioning & Evolution

- Breaking changes to public API require major version bump and ADR.
- New error types may be added (additive) — existing types must not change semantics.

---

## Summary

Single mandatory entry point for all outbound HTTP. Safe by default, resilient, observable, and testable.
Compliance is mandatory.
