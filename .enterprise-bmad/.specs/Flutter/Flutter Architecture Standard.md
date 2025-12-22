# Flutter Architecture Standard
## State-of-the-Art Mobile Architecture (Domain-Agnostic)

**Version:** 2.0  
**Stacks:** Flutter / Dart  
**Applies to:** Any Flutter application using the shared engineering standards

> This document defines the **mandatory architectural standard for Flutter applications**.
> It is fully aligned with the platform-wide standards:
> - Architecture Standard
> - Naming & Conventions Standard (Mobile Profile)
> - Data Contracts & Schema Evolution Standard
> - Security & Identity Standard
> - Observability Playbook
> - Deprecation & Sunset Policy

---

## 1. Core Principles

- FA-01: Flutter architecture must be **feature-first**, not layer-first.
- FA-02: Business rules must be framework-agnostic.
- FA-03: UI must be a thin rendering layer.
- FA-04: External boundaries must be defensive and resilient.
- FA-05: Mobile constraints (offline, latency, version skew) are first-class concerns.

---

## 2. Folder & Module Structure (Feature-First)

```
lib/
  features/
    <feature_name>/
      presentation/
      application/
      domain/
      data/
  shared/
    networking/
    security/
    observability/
    storage/
```

- FA-06: Features represent business capabilities.
- FA-07: Cross-feature reuse lives only in `shared/`.
- FA-08: No global `utils` or `common` modules.

---

## 3. Layer Responsibilities

### 3.1 Presentation

- Widgets and UI state management only
- No business logic
- No HTTP or storage access

### 3.2 Application

- Orchestrates use cases
- Coordinates domain and data layers
- Handles Result mapping for UI

### 3.3 Domain

- Entities, value objects, use cases
- Pure Dart (no Flutter imports)
- No persistence or networking

### 3.4 Data (Infrastructure)

- API clients
- DTOs and mappers
- Local storage and cache

---

## 4. Data Contracts Compliance (MANDATORY)

- FA-09: DTO decoding must tolerate **missing fields**.
- FA-10: DTO decoding must ignore **unknown fields**.
- FA-11: All enums must define an explicit `unknown` value.
- FA-12: Semantic changes require new contract versions.
- FA-13: Cache keys must include schema version when shape changes.

---

## 5. Networking & Error Model

- FA-14: All network calls must go through the Core Networking Package.
- FA-15: Networking must return typed `Result` objects, never throw.
- FA-16: Error categories must align with backend error envelopes.

---

## 6. Security & Identity Compliance

- FA-17: Tokens must be stored using secure storage only.
- FA-18: Tokens, PII and secrets must never be logged.
- FA-19: Session expiration and refresh must be handled gracefully.
- FA-20: TLS is mandatory for all network traffic.

---

## 7. Observability Compliance

- FA-21: Crash reporting is mandatory.
- FA-22: Network failures must be captured.
- FA-23: Performance metrics (startup, slow screens) are required.
- FA-24: `correlationId` must be propagated in all API calls.

---

## 8. Offline & Resilience

- FA-25: Read operations should degrade gracefully when offline.
- FA-26: Write operations must provide user feedback when offline.
- FA-27: Retry strategies must be bounded and explicit.

---

## 9. Deprecation & Compatibility

- FA-28: Flutter clients must tolerate older and newer backend contracts.
- FA-29: Mobile deprecation windows are longer (180+ days default).
- FA-30: Feature flags are recommended for gradual rollout.

---

## 10. Naming & Conventions

- FA-31: Apply Naming & Conventions Standard → Mobile Profile (Flutter/Dart).
- FA-32: Files and folders must use `snake_case`.
- FA-33: Widgets must use `PascalCase`.

---

## Summary

This standard ensures Flutter applications remain:
- contract-safe
- secure
- observable
- resilient
- compatible with long-lived backend evolution

Non-compliance is a blocking violation.