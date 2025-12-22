# React Native — Core Networking Package Specification
## Generic / Project-Agnostic (Client)

**Version:** 1.0  
**Status:** Canonical / Normative Specification  
**Stack:** React Native + TypeScript  

> This document specifies the **Core Networking Package** for React Native applications.
>
> It defines the **single, mandatory entry point** for all outbound HTTP communication and is designed to be:
> - safe for human developers
> - safe for AI-assisted engineering
> - aligned with the React Native Architecture Standard, FR and NFR
>
> This specification is **project-agnostic** and reusable across applications.

---

## Referenced Platform Standards (MANDATORY)

This specification **must be applied together with**:

- **React Native Architecture Standard**
- **React Native Functional Requirements (FR)**
- **React Native Non-Functional Requirements (NFR)**
- **Data Contracts & Schema Evolution Standard**
- **Code & API Documentation Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Deprecation & Sunset Policy**
- **Pull Request Checklist — Standard**
- **Agent Rules Standard**

Non-compliance is a blocking violation.

---

## 1. Purpose

The Core Networking Package provides a **standardized client-side communication layer** that enforces:

- Consistent error handling
- Predictable, typed result models
- Centralized authentication header injection
- Retry, timeout and cancellation policies
- Observability and diagnostics hooks
- Contract safety across backend evolution

All HTTP communication **must** use this package.

---

## 2. Scope & Responsibilities

The Core Networking Package **must**:

- Encapsulate all HTTP communication
- Provide a standard `Result<T>` abstraction
- Map protocol and transport failures to typed errors
- Inject authentication and correlation headers
- Enforce retry, timeout and cancellation rules
- Emit structured telemetry events

The package **must not**:

- Contain UI logic
- Contain business rules
- Depend on feature-specific code

---

## 3. Mandatory Usage Rules

- All outbound HTTP calls **must go through this package**
- Direct usage of `fetch`, `axios` or similar APIs outside this package is forbidden
- Features must not define their own networking abstractions

Violations require explicit **ADR approval**.

---

## 4. Public API Surface

The public API **must be minimal, explicit and stable**.

### 4.1 Core Client Interface

```ts
export interface NetworkClient {
  request<T>(request: NetworkRequest): Promise<Result<T>>;
}
```

---

### 4.2 Request Model

```ts
export interface NetworkRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  timeoutMs?: number;
}
```

Rules:
- Request objects are immutable
- No business semantics are allowed in the request

---

## 5. Result Model (Mandatory)

All IO operations **must return a `Result<T>`**.

```ts
export type Result<T> = Success<T> | Failure;

export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Failure {
  readonly ok: false;
  readonly error: NetworkError;
}
```

Rules:
- Exceptions must not cross the networking boundary
- Failures are represented only as typed errors

---

## 6. Error Model (Mandatory)

### 6.1 Base Error Type

```ts
export interface NetworkError {
  readonly code: string;
  readonly message: string;
}
```

### 6.2 Standard Error Categories

- `NetworkUnavailable`
- `Timeout`
- `Unauthorized`
- `Forbidden`
- `NotFound`
- `Validation`
- `Server`
- `Parsing`
- `Unknown`

Rules:
- Error categories must be deterministic
- Error semantics must remain stable across versions

---

## 7. Error Mapping

The package **must implement a centralized error mapper**.

Responsibilities:
- Map HTTP status codes to `NetworkError`
- Map transport-level failures to `NetworkError`
- Map deserialization errors to `Parsing`
- Preserve context without leaking sensitive data

---

## 8. Authentication & Headers

- Authentication headers must be injected automatically
- Token refresh must be centralized
- Refresh failures must surface as controlled auth errors
- Correlation identifiers must be propagated when available

Rules:
- Features must not access tokens directly
- Features must not implement their own interceptors

---

## 9. Retry, Timeout & Cancellation

- Retry policies must be:
  - bounded
  - configurable
  - applied only to transient failures

- Default timeouts are mandatory
- Per-request overrides are allowed
- Request cancellation must be supported

---

## 10. Data Contracts & Compatibility

- Response parsing must tolerate missing fields
- Unknown fields must be ignored
- Enum parsing must support an explicit `unknown` fallback
- Breaking contract changes require new client versions

---

## 11. Logging & Observability

### 11.1 Logging Rules

- Logs must be structured
- Logs must never contain:
  - tokens
  - secrets
  - personal data

### 11.2 Telemetry Hooks

The package must emit:
- request start / end events
- failure classification metrics
- latency measurements
- dependency health signals

---

## 12. Testability

The Core Networking Package **must be fully testable**.

- HTTP transport must be mockable
- Error mapping must be unit-tested
- Retry and timeout logic must be deterministic

---

## 13. AI-Assisted Engineering Rules

- AI-generated code **must use this package exclusively** for HTTP communication
- AI must not introduce direct `fetch` or `axios` usage
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

This Core Networking Package Specification defines the **single source of truth for client-side HTTP communication** in React Native applications.

It enables:
- predictable behavior
- consistent error handling
- secure and observable integrations
- safe AI-assisted development
- long-term architectural stability

Compliance is **mandatory**.

