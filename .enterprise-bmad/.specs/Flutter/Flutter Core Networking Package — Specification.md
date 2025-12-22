# Flutter Core Networking Package — Specification
## Generic / Project-Agnostic (Flutter)

**Version:** 1.0  
**Status:** Canonical / Normative Specification (Supersedes v1.x)

> This document specifies the **Core Networking Package** for Flutter applications.
>
> It defines the **single, mandatory entry point** for all external communication and is designed to be:
> - safe for human developers
> - safe for AI-assisted engineering
> - aligned with platform-wide standards
>
> This version consolidates and **extends** the original specification with:
> - Data Contracts & Schema Evolution Standard
> - Security & Identity Standard
> - Observability Playbook
> - Deprecation & Sunset Policy

---

## 1. Purpose

The Core Networking Package provides a **standardized communication layer** enforcing:

- Consistent error handling
- Predictable, typed result models
- Centralized authentication and refresh logic
- Retry, timeout and cancellation policies
- Observability and diagnostics
- Contract safety across backend evolution

This package is **project-agnostic** and reusable across multiple Flutter applications.

---

## 2. Scope & Responsibilities

The Core Networking Package **must**:

- Encapsulate all HTTP communication
- Provide a standard `Result<T>` abstraction
- Map infrastructure failures to typed application errors
- Centralize authentication token handling
- Enforce retry, timeout and cancellation policies
- Propagate `correlationId` and optional `idempotencyKey`
- Provide structured, safe logging and telemetry hooks

The package **must not**:

- Contain business logic
- Contain UI logic
- Depend on application-specific features

---

## 3. Public API Surface

The public API **must be minimal, explicit and stable**.

### 3.1 Core Interfaces

```dart
abstract class NetworkClient {
  Future<Result<T>> get<T>(Request<T> request);
  Future<Result<T>> post<T>(Request<T> request);
  Future<Result<T>> put<T>(Request<T> request);
  Future<Result<T>> delete<T>(Request<T> request);
}
```

```dart
abstract class Request<T> {
  String get path;
  Map<String, dynamic>? get query;
  Map<String, String>? get headers;
  Object? get body;

  /// Parses raw response payload into a strongly typed result.
  /// Must tolerate missing or unknown fields.
  T parse(dynamic response);
}
```

---

## 4. Result Model (Mandatory)

All IO operations **must return a Result type**.

```dart
sealed class Result<T> {
  const Result();

  R when<R>({
    required R Function(T data) success,
    required R Function(AppError error) failure,
  });
}

class Success<T> extends Result<T> {
  final T data;
  const Success(this.data);
}

class Failure<T> extends Result<T> {
  final AppError error;
  const Failure(this.error);
}
```

- No exceptions may propagate beyond the networking layer.
- Errors must be explicit and deterministic.

---

## 5. Error Model (Mandatory)

### 5.1 Base Error Type

```dart
sealed class AppError {
  final String message;
  final String? code;
  const AppError(this.message, {this.code});
}
```

### 5.2 Standard Error Types

- `NetworkError`
- `TimeoutError`
- `UnauthorizedError`
- `ForbiddenError`
- `NotFoundError`
- `ValidationError`
- `ServerError`
- `ParsingError`
- `UnknownError`

- Error types **must be serializable**.
- Error meaning must not change across versions.

---

## 6. Error Mapping

The package **must implement a centralized error mapper**.

Responsibilities:
- Convert HTTP status codes into `AppError`
- Convert transport exceptions into `AppError`
- Convert parsing failures into `ParsingError`
- Preserve contextual information without leaking sensitive data

```dart
AppError mapError(dynamic error);
```

---

## 7. Authentication & Authorization

### 7.1 Token Handling

- Token injection must be automatic
- Token refresh must be centralized
- Concurrent refresh attempts must be synchronized
- Refresh failure must result in a controlled logout signal

### 7.2 Rules

- No feature may access tokens directly
- No feature may implement its own auth interceptor
- Tokens must be stored using secure storage only

---

## 8. Retry, Timeout & Cancellation

- Retry policies must be:
  - bounded
  - configurable
  - applied only to transient failures

- Timeouts must be globally enforced
- Request cancellation must be supported
- Retry behavior must emit telemetry

---

## 9. Data Contracts & Compatibility (Mandatory)

- DTO parsing **must tolerate missing optional fields**
- DTO parsing **must ignore unknown fields**
- All enums parsed from backend **must include an `unknown` fallback**
- Semantic contract changes require new API versions
- Client-side cache keys must include schema version when shape changes

---

## 10. Logging & Observability

### 10.1 Logging

- Logs must be structured
- Logs must never contain:
  - tokens
  - secrets
  - personal data

### 10.2 Telemetry Hooks

The package must expose hooks for:
- request start
- request success
- request failure
- retry attempts
- auth refresh events

---

## 11. Testability

The networking package **must be fully testable**.

- HTTP layer must be mockable
- Error mapping must be unit-tested
- Retry, timeout and refresh logic must be deterministically testable

---

## 12. Usage Rules (Hard Constraints)

- Features must depend only on the public API
- Direct HTTP usage outside this package is forbidden
- Result and AppError types must not be redefined elsewhere

Violations require an explicit ADR.

---

## 13. AI-Assisted Engineering Rules

- AI agents must use this package exclusively for communication
- AI-generated networking code must not bypass Result or Error models
- Any deviation requires human review and ADR

---

## 14. Versioning & Evolution

- The public API must follow semantic versioning
- Breaking changes require:
  - major version bump
  - ADR approval
  - migration notes
- Deprecated APIs must follow the Deprecation & Sunset Policy

---

## Summary

This Core Networking Package Specification defines the **single source of truth for communication** in Flutter applications.

It ensures:
- predictable behavior
- safe contract evolution
- consistent error handling
- observability and security
- long-term architectural stability

This document supersedes all previous Flutter networking specifications.
