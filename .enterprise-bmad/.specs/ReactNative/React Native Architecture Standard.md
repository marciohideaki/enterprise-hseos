# React Native Architecture Standard
## State-of-the-Art Frontend Architecture (Domain-Agnostic)

**Version:** 1.0  
**Status:** Canonical / Normative Standard  
**Stack:** React Native + TypeScript  
**Applies to:** Any React Native application using the shared engineering standards

> This document defines the **mandatory architectural standard for React Native applications**.
> It focuses on **structure, responsibility boundaries and evolution safety**.
>
> Quality attributes, contracts, governance and tooling are defined in complementary standards
> explicitly referenced below.

---

## Referenced Platform Standards (MANDATORY)

This standard **must be applied together with**:

- **Naming & Conventions Standard** (Frontend / React Profile)
- **Data Contracts & Schema Evolution Standard**
- **Code & API Documentation Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Deprecation & Sunset Policy**
- **Pull Request Checklist — Standard**
- **Agent Rules Standard**

Non-compliance with any referenced document is a blocking violation.

---

## 1. Core Architectural Principles

- RN-01: Architecture must be **feature-first**, not layer-first.
- RN-02: Business logic must be **framework-agnostic**.
- RN-03: UI components are **pure rendering and interaction layers**.
- RN-04: External boundaries (API, storage) must be **defensive and explicit**.
- RN-05: Mobile constraints (offline, latency, version skew) are first-class concerns.
- RN-06: Architecture must remain stable under **team growth and AI-assisted development**.

---

## 2. Feature-First Folder Structure

```
src/
  features/
    <feature-name>/
      presentation/
        components/
        screens/
        hooks/
      application/
        useCases/
        state/
      domain/
        models/
        errors/
      data/
        api/
        mappers/
        repositories/
  shared/
    networking/
    storage/
    security/
    observability/
    ui/
```

- RN-07: Each feature represents a **business capability**.
- RN-08: Cross-feature reuse lives only in `shared/`.
- RN-09: Global `utils`, `helpers` or `common` folders are forbidden.

---

## 3. Layer Responsibilities

### 3.1 Presentation Layer

- React components, screens and hooks
- UI state only
- No business rules
- No direct API or storage access

### 3.2 Application Layer

- Use case orchestration
- Coordinates domain + data
- Maps Result → UI state
- Handles loading, error and success flows

### 3.3 Domain Layer

- Domain models and value objects
- Domain-level errors
- Pure TypeScript (no React / RN imports)
- No persistence or networking concerns

### 3.4 Data Layer

- API clients
- DTOs and mappers
- Repository implementations
- Cache and local storage adapters

---

## 4. Data Contracts & Compatibility (MANDATORY)

- RN-10: DTO parsing must tolerate **missing fields**.
- RN-11: Unknown fields **must be ignored**.
- RN-12: All enums **must include an `unknown` value**.
- RN-13: Contract-breaking changes require new API versions.
- RN-14: Schema version must be included when DTO shape changes.

---

## 5. Networking & Result Model

- RN-15: All HTTP calls must go through the **Core Networking Package (Client)**.
- RN-16: Networking must return typed `Result<T>` objects.
- RN-17: Exceptions must never cross application boundaries.
- RN-18: Error categories must align with backend error envelopes.

---

## 6. Error Handling Rules

- RN-19: Errors must be explicit, typed and deterministic.
- RN-20: UI must never infer meaning from raw error strings.
- RN-21: Domain and application errors must be mapped intentionally.

---

## 7. State Management

- RN-22: State must be **local by default**.
- RN-23: Global state must be justified and minimal.
- RN-24: State changes must be predictable and testable.
- RN-25: Side effects must live outside UI components.

(State management library choice is allowed, but architecture rules are invariant.)

---

## 8. Security & Identity

- RN-26: Tokens must be stored using secure storage mechanisms.
- RN-27: Tokens, secrets and PII must never be logged.
- RN-28: Session expiration must be handled gracefully.
- RN-29: All API communication must use TLS.

---

## 9. Observability

- RN-30: Crashes must be captured.
- RN-31: Network failures must be observable.
- RN-32: Performance metrics (startup, slow screens) are required.
- RN-33: Correlation IDs must propagate when provided by backend.

---

## 10. Offline & Resilience

- RN-34: Read flows should degrade gracefully when offline.
- RN-35: Write flows must provide explicit user feedback when offline.
- RN-36: Retry strategies must be bounded and explicit.
- RN-37: Cached data must be clearly distinguished from live data.

---

## 11. Naming & Conventions

- RN-38: Naming must follow the **Naming & Conventions Standard** (React Profile).
- RN-39: Components use `PascalCase`.
- RN-40: Hooks use `useCamelCase`.
- RN-41: Folders use `kebab-case`.

---

## 12. Documentation Rules

- RN-42: All exported components, hooks and functions must be documented (TSDoc).
- RN-43: Props and side effects must be documented.
- RN-44: Architectural intent must be explicit.

---

## 13. Governance & Enforcement

- RN-45: Compliance is enforced via PR reviews and CI gates.
- RN-46: Architectural deviations require an ADR.
- RN-47: This document is **normative and non-optional**.

---

## Summary

This standard defines **how React Native applications are structured**, not how features behave.

It guarantees:
- long-term maintainability
- contract safety
- predictable evolution
- safe AI-assisted development

Non-compliance is a blocking violation.

