# Resilience Patterns Standard
## Circuit Breaker, Retry, Bulkhead, Timeout and Fallback (Technology-Agnostic)

**Version:** 1.0
**Status:** Active — Cross-Cutting Standard
**Scope:** All services that communicate with external dependencies
**Applies to:** All backend stacks (C# / .NET, Java, Go, PHP, C++) and all client stacks

> Resilience is not optional. Every integration point is a failure point.
> This standard defines mandatory resilience patterns that all services MUST apply
> when communicating with external dependencies (databases, brokers, HTTP services, caches).

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Hexagonal & Clean Architecture Standard**
- **Microservices Architecture Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Data Contracts & Schema Evolution Standard**

---

## 1. Core Principles

- RP-01: **Assume failure** — every dependency will fail at some point; design for it.
- RP-02: **Fail fast** — surface failures quickly rather than letting them cascade.
- RP-03: **Degrade gracefully** — a partial failure must not cause total system failure.
- RP-04: **Bound all waits** — every external call must have an explicit timeout.
- RP-05: **Protect resources** — isolate failure domains so one degraded dependency does not exhaust shared resources.
- RP-06: All resilience configurations MUST be **externalized** (not hardcoded).
- RP-07: All resilience events (open circuit, retry exhaustion, fallback activation) MUST be **observable**.

---

## 2. Timeout

### 2.1 Definition
A **Timeout** is the maximum time a caller will wait for a response before treating the operation as failed.

### 2.2 Rules
- RP-08: **Every external call MUST have an explicit timeout** — no infinite waits.
- RP-09: Timeouts MUST be set at the **call site**, not relied upon by infrastructure defaults.
- RP-10: Timeout values MUST be configurable per environment and per dependency type.
- RP-11: Timeout expiry MUST produce a **typed error** (e.g., `TimeoutError`, `DeadlineExceeded`) — never a generic exception.
- RP-12: Timeout values MUST be documented in the service architecture spec.

### 2.3 Recommended Baseline

| Dependency Type | Suggested Timeout |
|---|---|
| Internal service (same DC) | 1–3s |
| External API / third-party | 5–15s |
| Database query (simple) | 2–5s |
| Database query (complex/batch) | 10–30s |
| Message broker publish | 2–5s |
| Cache read | 500ms–1s |

These are baselines. Each service must calibrate based on SLAs.

---

## 3. Retry

### 3.1 Definition
A **Retry** automatically re-attempts a failed operation with controlled timing to handle transient failures.

### 3.2 Rules
- RP-13: Retries MUST use **Exponential Backoff with Jitter** — never fixed-interval retry.
- RP-14: Retries MUST have a **maximum attempt count** — unbounded retries are forbidden.
- RP-15: Retries MUST only be applied to **idempotent operations** or operations known to be safe to retry.
- RP-16: Non-idempotent write operations (e.g., financial transactions, order placement) MUST NOT be retried without idempotency key enforcement.
- RP-17: Retry policies MUST be configurable per dependency.
- RP-18: Retry exhaustion MUST produce an explicit failure result — not silent data loss.

### 3.3 Exponential Backoff with Jitter (Canonical)

```
delay = min(baseDelay * 2^attempt, maxDelay) + random_jitter

Example:
  baseDelay = 100ms
  maxDelay  = 10s
  jitter    = random(0, 200ms)
  maxAttempts = 4

  Attempt 1: ~100ms
  Attempt 2: ~300ms
  Attempt 3: ~900ms
  Attempt 4: ~2500ms
  → Fail after 4th attempt
```

- RP-19: Jitter MUST be added to prevent **retry storms** (synchronized retries from multiple callers).

### 3.4 Retry and Circuit Breaker Integration
- RP-20: Retries MUST be combined with a Circuit Breaker — do not retry when the circuit is open.

---

## 4. Circuit Breaker

### 4.1 Definition
A **Circuit Breaker** monitors call failures and stops attempting calls to a failing dependency, allowing it time to recover.

### 4.2 States

```
            failure threshold exceeded
CLOSED ──────────────────────────────► OPEN
  ▲                                      │
  │          probe request succeeds      │ wait (reset timeout)
  └─────────────────────────────────────HALF-OPEN
                                          │
                    probe request fails   │
                    ◄────────────────────┘ → back to OPEN
```

| State | Behavior |
|---|---|
| **Closed** | Normal operation — all calls pass through |
| **Open** | Calls fail immediately (fast fail) — dependency not contacted |
| **Half-Open** | Limited probe calls allowed — determines if recovery happened |

### 4.3 Rules
- RP-21: A Circuit Breaker MUST be applied to **every external dependency** (HTTP services, databases, brokers, caches).
- RP-22: Failure threshold, success threshold, and reset timeout MUST be configurable.
- RP-23: When the circuit opens, the service MUST return a **typed error or fallback** immediately — not wait.
- RP-24: Circuit Breaker state transitions MUST emit **observability events** (log + metric).
- RP-25: Circuit Breaker MUST distinguish between **transient failures** (retriable) and **permanent failures** (not retriable) when counting failures.

### 4.4 Recommended Baseline Configuration

| Parameter | Suggested Default |
|---|---|
| Failure threshold to open | 50% failure rate over 10 requests (or 5 consecutive failures) |
| Reset timeout (OPEN → HALF-OPEN) | 30s–60s |
| Probe requests in HALF-OPEN | 3–5 |
| Success threshold to close | 3 consecutive successes |

All values must be configurable.

---

## 5. Bulkhead

### 5.1 Definition
A **Bulkhead** isolates resource pools (threads, connections, semaphores) per dependency to prevent a failure in one integration from exhausting resources for others.

### 5.2 Rules
- RP-26: Critical dependencies MUST be isolated via Bulkhead — they must not share resource pools with non-critical dependencies.
- RP-27: Maximum concurrent calls per dependency MUST be configurable.
- RP-28: When the Bulkhead limit is reached, excess calls MUST **fail fast** (not queue indefinitely).
- RP-29: Bulkhead saturation MUST emit observability events.

### 5.3 Bulkhead Patterns

| Pattern | Description | When to use |
|---|---|---|
| **Thread-pool isolation** | Dedicated thread pool per dependency | CPU-bound or IO-bound operations with distinct SLAs |
| **Semaphore isolation** | Count-limited concurrent access | Lightweight async operations |
| **Connection pool isolation** | Separate DB/HTTP connection pools per dependency | Database or persistent connection scenarios |

---

## 6. Fallback

### 6.1 Definition
A **Fallback** is a predefined alternative behavior executed when a dependency call fails (after retries/circuit open).

### 6.2 Rules
- RP-30: Fallback behavior MUST be defined for every dependency where degraded operation is acceptable.
- RP-31: Fallbacks MUST be **explicit and tested** — not implicit silent failures.
- RP-32: Fallback responses MUST be clearly marked as degraded data where applicable (e.g., `"source": "cache"`, `"stale": true`).
- RP-33: If no fallback is possible, the failure MUST be surfaced as a **typed, actionable error**.

### 6.3 Common Fallback Strategies

| Strategy | Description |
|---|---|
| **Cached response** | Return last known good response from cache |
| **Default value** | Return a safe empty/default result |
| **Graceful degradation** | Disable non-essential feature, continue core flow |
| **Queue for later** | Accept the request and process asynchronously when dependency recovers |
| **Fail fast with message** | Return clear error to client for user-visible recovery |

---

## 7. Resilience in Client Applications (Mobile / Frontend)

Client applications (Flutter, React Native) must also apply resilience patterns:

- RP-34: All API calls MUST have explicit **timeout** settings.
- RP-35: Network failures MUST be caught and mapped to **typed errors** — never crash.
- RP-36: Read flows MUST degrade gracefully using **cached data** when offline.
- RP-37: Write flows MUST provide **explicit user feedback** when the network is unavailable.
- RP-38: Retry strategies on clients MUST be **bounded** (max 2–3 attempts) with user notification on exhaustion.

---

## 8. Observability Requirements

All resilience events MUST be observable:

- RP-39: **Metrics required:**
  - circuit breaker state (per dependency)
  - circuit breaker open events (count, rate)
  - retry attempts (count, by dependency and outcome)
  - timeout events (count, by dependency)
  - bulkhead rejection count (by dependency)
  - fallback activations (count, by type)

- RP-40: **Alerts required:**
  - Circuit breaker open for > X seconds
  - Retry exhaustion rate above threshold
  - Bulkhead saturation sustained

- RP-41: All resilience events MUST include `correlationId` for traceability.

---

## 9. Configuration Management

- RP-42: All resilience parameters (timeouts, thresholds, retry counts) MUST be **externalized** — not hardcoded.
- RP-43: Resilience config MUST be tunable **per environment** (development can be more permissive; production must be strict).
- RP-44: Changes to production resilience configuration require review (same governance as code changes).

---

## 10. Testing Requirements

- RP-45: **Timeout behavior** must be covered by integration tests using simulated slow dependencies.
- RP-46: **Circuit Breaker** state transitions must be tested with fault injection.
- RP-47: **Retry exhaustion** must be tested and verified to produce correct typed failure.
- RP-48: **Fallback activation** must be tested to confirm expected degraded behavior.
- RP-49: Chaos testing or fault injection is **recommended** for production-critical services.

---

## 11. Anti-Patterns (Explicitly Forbidden)

### 11.1 Infinite Wait
External calls without timeout.
**Fix:** always set explicit timeout per call.

### 11.2 Unbounded Retry
Retry loops without max attempt limit.
**Fix:** always define maxAttempts; use exponential backoff with jitter.

### 11.3 Retry Without Idempotency
Retrying non-idempotent writes.
**Fix:** implement idempotency keys or apply retry only to safe read operations.

### 11.4 Silent Fallback
Returning stale/default data without marking it as degraded.
**Fix:** always signal that data is degraded or came from fallback.

### 11.5 Shared Resource Pool
All dependencies share the same thread pool or connection pool.
**Fix:** apply Bulkhead; isolate critical dependencies from non-critical ones.

### 11.6 Hardcoded Resilience Config
Timeout and retry values embedded in code.
**Fix:** externalize all resilience configuration.

---

## 12. Governance

- RP-50: All services with external dependencies MUST document their resilience configuration in the service architecture spec.
- RP-51: New external integrations MUST include resilience policy as part of the PR (timeout, retry, circuit breaker, fallback).
- RP-52: Deviations require an ADR.
- RP-53: Compliance is verified in PR reviews.

---

## Summary

This standard defines the mandatory resilience posture for all services:

| Pattern | Mandatory for |
|---|---|
| **Timeout** | Every external call |
| **Retry + Backoff + Jitter** | Transient, idempotent operations |
| **Circuit Breaker** | Every external dependency |
| **Bulkhead** | Critical / high-impact dependencies |
| **Fallback** | Every dependency where degraded operation is acceptable |

Resilience is not optional — it is a quality gate.
Non-compliance is a blocking violation.
