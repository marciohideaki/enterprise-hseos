# API Management & Versioning Standard
## Cross-Cutting — Mandatory

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** All stacks — mandatory for any service exposing HTTP/gRPC/event APIs
**Classification:** Cross-Cutting (Mandatory)

> This standard governs how APIs are versioned, deprecated, rate-limited, and exposed.
> Every service that exposes an HTTP, gRPC, or event-based API MUST comply with all rules herein.
> Non-compliance requires an explicit ADR with justification and approval.

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Security & Identity Standard**
- **Observability Playbook**
- **Data Contracts & Schema Evolution Standard**
- **Resilience Patterns Standard**

---

## 1. URL Versioning

### 1.1 Core Rules

- AM-01: **URL path versioning is the mandatory strategy** for all HTTP APIs. Header-based versioning (`Accept: application/vnd.api+json;version=2`) and content-negotiation versioning are **prohibited**.
- AM-02: **Only MAJOR version numbers** are permitted in the URL path. `/v1/`, `/v2/` are valid. `/v1.2/`, `/v1.0/`, `/v2.3.1/` are **forbidden**.
- AM-03: The version segment MUST be the **first segment immediately after the base path**. The pattern `/api/v1/resource` is correct. The pattern `/resource/v1` is **forbidden**.
- AM-04: A new major version MUST be created **only for breaking changes**. Adding optional fields, new endpoints, or bug fixes MUST NOT trigger a new major version.
- AM-05: When a new major version is created, the previous major version MUST **remain operational** for a minimum of 6 months (internal APIs) or 12 months (external/public APIs) after the Sunset date is announced.
- AM-06: Version `v0` MAY be used exclusively for pre-release/experimental APIs and MUST NOT be used in production without explicit ADR approval.
- AM-07: The base path (`/api`) is **optional but consistent** — if used, it must be uniform across all services in the platform. Mixing `/api/v1/` and `/v1/` within the same platform is **forbidden**.
- AM-08: gRPC APIs MUST encode the version in the **package name**: `package orders.v1;`, `package orders.v2;`. File path conventions follow the same rule: `proto/orders/v1/orders.proto`.
- AM-09: Event-based APIs (Kafka topics, EventBridge schemas) MUST encode the version in the **schema name or topic name**: `orders.created.v1`, `orders.created.v2`.
- AM-10: Every API MUST document its current version, supported versions, and deprecation schedule in its OpenAPI/AsyncAPI specification.

### 1.2 Correct and Incorrect URL Examples

| Pattern | Status | Reason |
|---|---|---|
| `GET /api/v1/orders` | **CORRECT** | Version first, after base path |
| `GET /api/v2/orders/{id}` | **CORRECT** | Major version only |
| `GET /orders/v1` | **FORBIDDEN** | Version after resource segment |
| `GET /api/v1.2/orders` | **FORBIDDEN** | Minor version in URL |
| `GET /api/orders` (version via header) | **FORBIDDEN** | Header-based versioning |
| `GET /api/v1/v2/orders` | **FORBIDDEN** | Multiple versions in path |

### 1.3 Implementation Examples by Stack

**.NET Minimal API**
```csharp
// Program.cs
var v1 = app.MapGroup("/api/v1");
var v2 = app.MapGroup("/api/v2");

v1.MapGet("/orders", OrdersHandlerV1.GetOrders);
v2.MapGet("/orders", OrdersHandlerV2.GetOrders);
```

**Java Spring Boot**
```java
@RestController
@RequestMapping("/api/v1/orders")
public class OrdersControllerV1 { ... }

@RestController
@RequestMapping("/api/v2/orders")
public class OrdersControllerV2 { ... }
```

**Go net/http**
```go
mux := http.NewServeMux()
mux.HandleFunc("/api/v1/orders", v1.HandleOrders)
mux.HandleFunc("/api/v2/orders", v2.HandleOrders)
```

**PHP Laravel**
```php
// routes/api.php
Route::prefix('v1')->group(function () {
    Route::apiResource('orders', OrderControllerV1::class);
});
Route::prefix('v2')->group(function () {
    Route::apiResource('orders', OrderControllerV2::class);
});
```

**gRPC (proto)**
```protobuf
// proto/orders/v1/orders.proto
syntax = "proto3";
package orders.v1;
option go_package = "github.com/org/service/orders/v1";

service OrderService {
  rpc GetOrder(GetOrderRequest) returns (GetOrderResponse);
}
```

---

## 2. Breaking vs. Non-Breaking Changes

### 2.1 Rules

- AM-11: Any breaking change to a published API MUST trigger the creation of a new major version.
- AM-12: A new major version MUST be accompanied by an **ADR** documenting the justification, migration path, and Sunset timeline for the previous version.
- AM-13: Non-breaking changes MUST be deployed into the **current major version** without a version bump.
- AM-14: The determination of breaking vs. non-breaking is evaluated from the **client's perspective** — if a well-behaved existing client could break, the change is breaking.
- AM-15: Additive changes to response bodies are non-breaking **only if** clients are expected to use tolerant reader patterns (unknown fields must be ignored). This expectation MUST be documented in the API contract.

### 2.2 Classification Table

| Change | Classification | Notes |
|---|---|---|
| Remove a field from a response body | **BREAKING** | Clients depending on it will fail |
| Remove an endpoint | **BREAKING** | Clients calling it will receive 404/410 |
| Change the data type of a field (e.g., `string` → `integer`) | **BREAKING** | Deserialization will fail |
| Remove an enum value | **BREAKING** | Clients handling that value will receive unexpected data |
| Change the semantic meaning of a field | **BREAKING** | Silent data corruption in clients |
| Add a new REQUIRED field to a request body | **BREAKING** | Existing clients will receive 400/422 |
| Rename a field (even with same semantics) | **BREAKING** | Old name no longer present |
| Change HTTP method for an endpoint (e.g., POST → PUT) | **BREAKING** | Client routing breaks |
| Change URL path structure | **BREAKING** | Client URLs become 404 |
| Add a new OPTIONAL field to a request body | **Non-breaking** | Existing clients omit it without issue |
| Add a new field to a response body | **Non-breaking** | Tolerant readers ignore unknown fields |
| Add a new endpoint | **Non-breaking** | Existing clients unaffected |
| Add a new enum value to a response field | **Non-breaking** | Clients MUST handle unknown values gracefully |
| Add a new HTTP method to an existing resource | **Non-breaking** | Existing methods unchanged |
| Relaxing validation (e.g., removing a length constraint) | **Non-breaking** | Previously valid requests remain valid |
| Tightening validation (e.g., adding a length constraint) | **BREAKING** | Previously valid requests may now fail |
| Changing error message text | **Non-breaking** | Messages must not be parsed programmatically |
| Adding a new optional query parameter | **Non-breaking** | Existing requests without it still work |

### 2.3 Immutability of Public Contracts

- AM-16: Once an API version is published and marked stable, its **request and response schemas are immutable** for breaking changes.
- AM-17: Deprecation of a field (soft-removal) is permitted within a version using documentation and response metadata, but the field MUST continue to be present until the version is sunsetted.
- AM-18: Schema changes that are ambiguously breaking MUST be treated as **breaking**. In case of doubt, create a new version.
- AM-19: Event schema changes follow the same breaking change rules. Removing a field from a published event schema is a breaking change and requires a new version.
- AM-20: The API changelog MUST document every change — breaking or non-breaking — with the date and version in which it was introduced.

---

## 3. Deprecation Headers

### 3.1 Mandatory Headers

- AM-21: When a version is deprecated, every response from that version MUST include the following three HTTP headers:
  - `Deprecation: true`
  - `Sunset: <date in RFC 7231 format>`
  - `Link: <successor-url>; rel="successor-version"`
- AM-22: The `Sunset` header MUST use the exact RFC 7231 date-time format: `Sunset: Sat, 31 Dec 2026 23:59:59 GMT`. No other format is acceptable.
- AM-23: The Sunset date MUST be communicated **at the time the new version is created**, not retrospectively. Announcing a Sunset date after the replacement has been available for months is **forbidden**.
- AM-24: Minimum Sunset periods are:
  - **Internal APIs** (consumed only by internal services): 6 months from announcement.
  - **External/Public APIs** (consumed by third parties or external partners): 12 months from announcement.
- AM-25: The `Link` header MUST point to the equivalent endpoint in the successor version: `Link: <https://api.example.com/v2/orders>; rel="successor-version"`.
- AM-26: After the Sunset date has passed, the deprecated version MUST return **HTTP 410 Gone** for all requests. It MUST NOT return 200, 301, or 404. Returning 410 before the Sunset date is **forbidden**.
- AM-27: The 410 Gone response body MUST follow the standard error format (see Section 7) with a `type` URI pointing to a deprecation-specific error page and a `detail` field directing clients to the successor version.
- AM-28: Deprecation headers MUST be added at the **router/middleware level** — not per-handler. Per-handler implementation risks inconsistency.
- AM-29: A machine-readable deprecation registry MUST be maintained (in the API Gateway or a shared configuration) listing: API name, deprecated version, successor version, Sunset date, and migration guide URL.
- AM-30: Services consuming deprecated APIs MUST be tracked and notified. The API owner is responsible for identifying consumers via gateway logs and notifying them before the Sunset date.

### 3.2 Implementation Examples

**.NET Middleware**
```csharp
public class DeprecationMiddleware(RequestDelegate next,
    DeprecationOptions options)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        ctx.Response.Headers["Deprecation"] = "true";
        ctx.Response.Headers["Sunset"] = options.SunsetDate; // "Sat, 31 Dec 2026 23:59:59 GMT"
        ctx.Response.Headers["Link"] =
            $"<{options.SuccessorUrl}>; rel=\"successor-version\"";
        await next(ctx);
    }
}

// Registration in v1 route group only:
appV1.UseMiddleware<DeprecationMiddleware>();
```

**Java Spring Boot (HandlerInterceptor)**
```java
@Component
public class DeprecationInterceptor implements HandlerInterceptor {
    @Override
    public boolean preHandle(HttpServletRequest req,
                             HttpServletResponse res, Object handler) {
        res.setHeader("Deprecation", "true");
        res.setHeader("Sunset", "Sat, 31 Dec 2026 23:59:59 GMT");
        res.setHeader("Link",
            "<https://api.example.com/v2/orders>; rel=\"successor-version\"");
        return true;
    }
}
```

**Go Middleware**
```go
func DeprecationMiddleware(sunsetDate, successorURL string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            w.Header().Set("Deprecation", "true")
            w.Header().Set("Sunset", sunsetDate)
            w.Header().Set("Link", fmt.Sprintf(`<%s>; rel="successor-version"`, successorURL))
            next.ServeHTTP(w, r)
        })
    }
}
```

---

## 4. Rate Limiting

### 4.1 Mandate and Scope

- AM-31: Rate limiting is **MANDATORY** for every endpoint exposed externally (outside the service mesh or internal network boundary).
- AM-32: Rate limiting for internal service-to-service traffic is **recommended** and MUST be enforced when a service is at risk of being overwhelmed by internal callers.
- AM-33: Rate limiting MUST be enforced at the **API Gateway layer**. Individual services MUST NOT be the sole rate-limiting mechanism for external traffic.

### 4.2 Strategy

- AM-34: The **Token Bucket** algorithm is the **preferred** strategy for all production rate limiting due to its burst tolerance and smooth handling of traffic spikes.
- AM-35: **Sliding Window** is an acceptable alternative when strict per-window fairness is required.
- AM-36: **Fixed Window** is permitted only for simple internal tooling APIs and MUST NOT be used for high-traffic external APIs due to boundary-burst vulnerability.
- AM-37: The rate-limiting implementation MUST use a **Redis-backed counter** in all production environments. In-memory counters are **forbidden** in production because they do not survive restarts and cannot be shared across multiple instances.
- AM-38: Burst allowance: clients MAY exceed the configured rate limit by up to **2x for a maximum of 10 consecutive seconds**. Sustained bursts beyond this window MUST be rejected.

### 4.3 Identity and Limits

- AM-39: Rate limits MUST be enforced **per client identity**, using either:
  - API Key (for M2M clients), or
  - JWT `sub` claim (for user-authenticated clients).
- AM-40: Using **IP address as the sole rate-limiting criterion is prohibited**. IP-based limiting may be used as a secondary defense layer but never as the primary identity for rate limiting (shared NATs and proxies make IP unreliable).
- AM-41: **Default rate limits** (adjustable via ADR for specific services):
  - Read operations (`GET`, `HEAD`, `OPTIONS`): **1000 requests per minute** per client identity.
  - Write operations (`POST`, `PUT`, `PATCH`, `DELETE`): **100 requests per minute** per client identity.
- AM-42: Different tiers of clients (e.g., free vs. paid, internal vs. external) MAY have different limits, but all tiers MUST be explicitly configured in the gateway — no undocumented special-cases.

### 4.4 Response Headers

- AM-43: The following headers MUST be present in **every API response** — not only when a limit is reached:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | The maximum number of requests allowed in the current window |
| `X-RateLimit-Remaining` | The number of requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the current window resets |

- AM-44: When a request is rejected due to rate limiting, the response MUST be:
  - HTTP status: **429 Too Many Requests**
  - Header: `Retry-After: <seconds>` — the number of seconds the client must wait before retrying.
  - Body: Standard error format (see Section 7).
- AM-45: The `Retry-After` value MUST be accurate — it MUST reflect the actual wait time based on the client's quota state, not a fixed generic value.

### 4.5 Implementation Examples

**.NET with Redis (using `AspNetCoreRateLimit` or custom middleware)**
```csharp
// appsettings.json
{
  "RateLimiting": {
    "ReadLimit": 1000,
    "WriteLimit": 100,
    "WindowSeconds": 60,
    "BurstMultiplier": 2,
    "BurstWindowSeconds": 10
  }
}

// Middleware (simplified Token Bucket via StackExchange.Redis)
public async Task InvokeAsync(HttpContext ctx)
{
    var clientId = ctx.User.FindFirst("sub")?.Value
        ?? ctx.Request.Headers["X-Api-Key"].ToString();

    var isWrite = IsWriteMethod(ctx.Request.Method);
    var limit = isWrite ? _opts.WriteLimit : _opts.ReadLimit;
    var key = $"rl:{clientId}:{(isWrite ? "w" : "r")}";

    var (allowed, remaining, reset) = await _limiter.ConsumeAsync(key, limit);

    ctx.Response.Headers["X-RateLimit-Limit"] = limit.ToString();
    ctx.Response.Headers["X-RateLimit-Remaining"] = remaining.ToString();
    ctx.Response.Headers["X-RateLimit-Reset"] = reset.ToString();

    if (!allowed)
    {
        ctx.Response.StatusCode = 429;
        ctx.Response.Headers["Retry-After"] = (reset - DateTimeOffset.UtcNow.ToUnixTimeSeconds()).ToString();
        await ctx.Response.WriteAsJsonAsync(ProblemDetailsFactory.RateLimited(ctx));
        return;
    }
    await _next(ctx);
}
```

**Go with Redis**
```go
func RateLimitMiddleware(rdb *redis.Client, readLimit, writeLimit int) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            clientID := extractClientID(r) // from JWT sub or X-Api-Key
            isWrite := r.Method == http.MethodPost || r.Method == http.MethodPut ||
                       r.Method == http.MethodPatch || r.Method == http.MethodDelete
            limit := readLimit
            if isWrite { limit = writeLimit }

            key := fmt.Sprintf("rl:%s:%v", clientID, isWrite)
            remaining, reset, allowed := tokenBucketConsume(rdb, key, limit)

            w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
            w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
            w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset, 10))

            if !allowed {
                w.Header().Set("Retry-After", strconv.FormatInt(reset-time.Now().Unix(), 10))
                w.WriteHeader(http.StatusTooManyRequests)
                writeErrorResponse(w, r, 429, "rate-limit-exceeded")
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

**PHP Laravel**
```php
// app/Http/Kernel.php — throttle middleware uses Redis driver
'api' => [
    \App\Http\Middleware\ApiRateLimitMiddleware::class,
],

// config/cache.php — MUST use redis driver in production
// AppServiceProvider: RateLimiter::for('api-read', ...) / RateLimiter::for('api-write', ...)

RateLimiter::for('api-read', function (Request $request) {
    $key = $request->user()?->id ?? $request->header('X-Api-Key');
    return Limit::perMinute(1000)->by($key)->response(function () {
        return response()->json(ProblemDetails::rateLimited(), 429)
            ->header('Retry-After', 60);
    });
});
```

---

## 5. API Gateway Patterns

### 5.1 Gateway as Mandatory Entry Point

- AM-46: **All external-facing endpoints MUST be routed through an API Gateway**. Direct access to backend services from external clients (bypassing the gateway) is **forbidden**.
- AM-47: The term "external" includes: public internet traffic, partner integrations, mobile/web frontends, and third-party webhook consumers.
- AM-48: Internal service-to-service calls within the service mesh MAY bypass the API gateway but MUST still enforce authentication (mTLS or signed tokens per the Security & Identity Standard).

### 5.2 Gateway Responsibilities

- AM-49: The API Gateway is **solely responsible** for the following concerns for external traffic. Individual backend services MUST NOT duplicate these at the edge:
  - **Authentication verification** (token validation, API Key lookup)
  - **Rate limiting** (per rules in Section 4)
  - **Access logging** (every request with clientId, path, status, latency)
  - **Request routing** (path-based, version-based)
- AM-50: Business logic MUST NOT reside in the API Gateway. Gateway-level transformations (request/response mapping) are permitted only when lightweight and stateless. Complex transformations belong in the service.

### 5.3 API Keys for M2M Authentication

- AM-51: Machine-to-machine (M2M) clients MUST authenticate using API Keys issued by the gateway. API Keys MUST:
  - Be generated by the gateway (never manually crafted).
  - Be scoped to a specific client identity and set of permissions.
  - Never be embedded in client-side code or committed to source control.
- AM-52: API Keys MUST be **rotated at minimum annually**. The rotation process MUST support zero-downtime key rotation (overlap period where both old and new keys are valid, not to exceed 7 days).
- AM-53: Revocation of an API Key MUST take effect **within 60 seconds** of the revocation action in the gateway console or API. Cached key validations exceeding this window are **forbidden**.

### 5.4 Circuit Breaker at Gateway

- AM-54: The API Gateway MUST implement a circuit breaker for each upstream backend service with the following mandatory thresholds (adjustable via ADR):
  - **Open condition:** ≥ 50% error rate (5xx responses) within a 10-second rolling window with a minimum of 10 requests.
  - **Open duration:** Circuit remains open for **30 seconds** before transitioning to half-open.
  - **Half-open probe:** 1 request is allowed through; if successful, the circuit closes. If it fails, the circuit reopens for another 30 seconds.
  - **Open circuit response:** Gateway returns **503 Service Unavailable** with `Retry-After: 30`.

### 5.5 Health Check Endpoints

- AM-55: Every service MUST expose the following health check endpoints. These endpoints are exempt from authentication and rate limiting:

| Endpoint | Method | Purpose | Expected Response |
|---|---|---|---|
| `/health` | GET | Combined health summary | `200 {"status":"healthy"}` or `503 {"status":"unhealthy"}` |
| `/health/live` | GET | Liveness: is the process running? | `200 {"status":"alive"}` — never returns 5xx unless process is dead |
| `/health/ready` | GET | Readiness: can the service handle traffic? | `200 {"status":"ready"}` or `503 {"status":"not-ready","reason":"db-unavailable"}` |

- **Liveness** (`/health/live`): MUST only check that the process is alive (e.g., not deadlocked). It MUST NOT check external dependencies. Kubernetes uses this to decide whether to restart the pod.
- **Readiness** (`/health/ready`): MUST check all critical dependencies (database, cache, required downstream services). Kubernetes uses this to decide whether to send traffic to the pod.
- The `/health` endpoint MAY aggregate both checks for human consumption but MUST NOT be used by orchestrators as a substitute for `/health/live` or `/health/ready`.

---

## 6. Pagination

### 6.1 Strategy Selection

- AM-56: **Cursor-based pagination is the preferred strategy** for all collection endpoints where the dataset may exceed 1000 items or where real-time data consistency is required.
- AM-57: **Offset-based pagination is acceptable** for collections that are small (consistently under 1000 items), static or slow-changing, and presented in a UI with numbered page navigation.
- AM-58: Mixing pagination strategies within the same API version for similar resources is **forbidden**. The strategy choice MUST be consistent and documented.
- AM-59: `total` count in cursor-based pagination is **strongly discouraged** because computing it requires a full table scan and degrades performance under load. Use `hasMore` boolean instead.

### 6.2 Response Envelope

- AM-60: All collection endpoints MUST wrap their response in the following envelope. Returning a bare array at the top level is **forbidden**.

**Cursor-based (preferred for large/live collections)**
```json
{
  "data": [...],
  "pagination": {
    "nextCursor": "eyJpZCI6MTIzfQ==",
    "hasMore": true
  }
}
```

**Offset-based (for small/paginated UI collections)**
```json
{
  "data": [...],
  "pagination": {
    "page": 2,
    "pageSize": 20,
    "hasMore": true
  }
}
```

### 6.3 Query Parameters

- AM-61: Cursor-based endpoints MUST use the query parameters `cursor` and `pageSize`.
- AM-62: Offset-based endpoints MUST use the query parameters `page` (1-indexed) and `pageSize`.
- AM-63: The **default page size is 20**. If no `pageSize` is specified, the server MUST return 20 items.
- AM-64: The **maximum page size is 100**. Requests with `pageSize` exceeding 100 MUST be rejected with HTTP 400 and a descriptive error.
- AM-65: Cursors MUST be **opaque to the client** — base64-encoded or encrypted. Clients MUST NOT construct, manipulate, or parse cursor values. The internal structure of a cursor is a server implementation detail.

---

## 7. Error Response Standard

### 7.1 Mandatory Format (RFC 7807 Problem Details)

- AM-66: All error responses MUST use the RFC 7807 Problem Details format. Custom error formats that deviate from this structure are **forbidden**.
- AM-67: The canonical error response structure is:

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The request body contains invalid values.",
  "instance": "/v1/orders/123",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [
    {
      "field": "amount",
      "code": "MUST_BE_POSITIVE",
      "message": "Amount must be greater than zero"
    }
  ]
}
```

### 7.2 Field Rules

- AM-68: The `type` field MUST be a **permanent, dereferenceable URI** identifying the error class. Using `"about:blank"` as the type value is **forbidden** for any API error that has a defined semantic meaning.
- AM-69: The `traceId` field is **MANDATORY in every error response**. Responses without a trace ID are non-compliant. The trace ID MUST be the same as the distributed trace identifier propagated via `traceparent` / `X-Trace-Id` headers.
- AM-70: The `errors` array is **optional** at the top level but MUST be present for validation errors (422) and MUST contain one entry per field violation.
- AM-71: **PII (Personally Identifiable Information) MUST NEVER appear in error responses** — not in `detail`, not in `errors[].message`, not in `instance`. This includes names, email addresses, document numbers, and any data that could identify a person.
- AM-72: Error messages MUST be written for developers, not end users. UI-facing error messages are the responsibility of the frontend/client layer.
- AM-73: The `status` field MUST match the **actual HTTP status code** of the response. Returning 200 with a body containing `"status": 500` is **forbidden**.

### 7.3 HTTP Status Code Usage

| Status Code | When to Use |
|---|---|
| `400 Bad Request` | Malformed request syntax, invalid JSON, missing required headers |
| `401 Unauthorized` | Missing or invalid authentication credentials |
| `403 Forbidden` | Authenticated but not authorized for this resource/action |
| `404 Not Found` | Resource does not exist (use consistently — never to hide 403) |
| `409 Conflict` | State conflict: duplicate creation, optimistic concurrency failure |
| `422 Unprocessable Entity` | Request is syntactically valid but semantically invalid (validation failures) |
| `429 Too Many Requests` | Rate limit exceeded (see Section 4) |
| `500 Internal Server Error` | Unexpected server-side error — MUST trigger alerting |
| `503 Service Unavailable` | Service temporarily unavailable (circuit open, dependency down, health check failing) |

- AM-74: **Do not use 400 for validation errors that belong to 422.** Bad JSON or a completely unparseable body → 400. Valid JSON with logically invalid field values → 422.
- AM-75: **500 errors MUST be treated as incidents.** Every 500 response MUST be logged with full context, must include a `traceId` in the response, and MUST NOT expose stack traces, internal paths, or database error messages to the caller.

### 7.4 Error Type URI Registry

Each platform or product MUST maintain a registry of `type` URIs mapping to human-readable error documentation. Example entries:

| Type URI | HTTP Status | Description |
|---|---|---|
| `.../errors/validation-failed` | 422 | One or more fields failed validation |
| `.../errors/resource-not-found` | 404 | The requested resource does not exist |
| `.../errors/conflict` | 409 | The operation conflicts with current state |
| `.../errors/unauthorized` | 401 | Authentication is required or has failed |
| `.../errors/forbidden` | 403 | Insufficient permissions for this action |
| `.../errors/rate-limit-exceeded` | 429 | Client has exceeded its rate limit |
| `.../errors/service-unavailable` | 503 | Downstream dependency is unavailable |
| `.../errors/internal-error` | 500 | Unexpected server error |

---

## Compliance Checklist

Every API MUST satisfy the following before being promoted to production:

- [ ] URL versioning follows `/api/v{N}/resource` pattern (AM-01 to AM-10)
- [ ] Breaking change analysis documented in ADR if a new version was created (AM-11 to AM-20)
- [ ] Deprecation headers configured in middleware for all deprecated versions (AM-21 to AM-30)
- [ ] Rate limiting enforced via Redis-backed gateway middleware with correct headers (AM-31 to AM-45)
- [ ] All external traffic routed through API Gateway (AM-46 to AM-55)
- [ ] Health endpoints `/health`, `/health/live`, `/health/ready` implemented (AM-55)
- [ ] Pagination uses approved envelope and does not return bare arrays (AM-56 to AM-65)
- [ ] All errors conform to RFC 7807 format with `traceId` and no PII (AM-66 to AM-75)
- [ ] OpenAPI/AsyncAPI specification published and current
- [ ] Consumer registry updated if applicable (for deprecation tracking)
