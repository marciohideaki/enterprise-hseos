# Code & API Documentation Standard
## Mandatory Documentation Rules for Multi-Stack Systems

**Version:** 1.0  
**Status:** Canonical / Normative Standard  
**Applies to:** Backend (C# / .NET), Mobile (Flutter / Dart), Web (React / TypeScript)

> This document defines the **mandatory standards for code and API documentation**.
> Documentation is considered part of the **software contract**, not an optional enhancement.
>
> Any code or API that does not comply with this standard is considered **non-production-ready**.

---

## 1. Core Principles

- CD-01: Documentation is a **first-class artifact**.
- CD-02: Code without documentation is **incomplete**.
- CD-03: Documentation must explain **intent and contract**, not just implementation.
- CD-04: Public code is a public API and must be documented accordingly.
- CD-05: Documentation must be understandable by **humans and AI agents**.

---

## 2. Scope

This standard applies to:

- Public classes
- Public interfaces
- Public methods and functions
- Public properties and attributes
- Domain models and value objects
- Application services and use cases
- Infrastructure services
- HTTP APIs and external contracts

Private/internal elements may omit documentation **only if not part of a public contract**.

---

## 3. Code Documentation Rules (General)

- CD-06: Every public class **must** have documentation.
- CD-07: Every public method/function **must** have documentation.
- CD-08: All parameters **must** be documented.
- CD-09: Return values **must** be documented.
- CD-10: Exceptions or error conditions **must** be documented.
- CD-11: Documentation must describe **what** and **why**, not line-by-line behavior.
- CD-12: Historical or architectural context **should** be included when relevant.

Code that violates these rules is a **PR blocker**.

---

## 4. Stack-Specific Documentation Requirements

### 4.1 C# / .NET

- CD-13: XML Documentation (`///`) is mandatory for all public code.
- CD-14: The following tags **must** be used when applicable:
  - `<summary>`
  - `<param>`
  - `<returns>`
  - `<remarks>`
- CD-15: Extension methods **must** document usage examples when non-trivial.
- CD-16: XML documentation must compile without warnings.

---

### 4.2 Flutter / Dart

- CD-17: DartDoc (`///`) is mandatory for public classes, services and APIs.
- CD-18: Widget documentation must explain **intent and responsibilities**.
- CD-19: Public APIs must include usage examples when behavior is non-obvious.

---

### 4.3 React / TypeScript

- CD-20: TSDoc/JSDoc is mandatory for exported functions, hooks and components.
- CD-21: Props and return types **must** be documented.
- CD-22: Side effects and lifecycle implications **must** be documented.

---

## 5. API Documentation (OpenAPI / Swagger)

### 5.1 Mandatory API Documentation

- CD-23: Every HTTP API **must** expose an OpenAPI (Swagger) specification.
- CD-24: Endpoints, request models, response models and error models **must** be documented.
- CD-25: Authentication and authorization requirements **must** be documented.

---

### 5.2 Environment Rules

- CD-26: Swagger **must be enabled** in:
  - Development
  - Staging / Homologation

- CD-27: Swagger **must be disabled or protected** in Production.

---

### 5.3 Versioning & Evolution

- CD-28: OpenAPI specs **must be versioned** alongside the API.
- CD-29: Breaking changes require:
  - New API version
  - Updated OpenAPI specification
  - ADR approval

---

## 6. Error & Contract Documentation

- CD-30: Error responses **must** be documented and standardized.
- CD-31: Error codes **must not change meaning** across versions.
- CD-32: Success and failure scenarios **must** be explicitly described.

---

## 7. AI-Assisted Engineering Rules

- CD-33: AI-generated code **must include documentation**.
- CD-34: AI agents **must not generate undocumented public code**.
- CD-35: AI-generated documentation **must be reviewed for accuracy**.
- CD-36: Documentation generation **must not be skipped to increase velocity**.

---

## 8. Governance & Enforcement

- CD-37: Documentation compliance **must be enforced via PR reviews**.
- CD-38: CI pipelines **should validate documentation presence** when tooling allows.
- CD-39: Exceptions require explicit ADR approval.

---

## 9. Relationship with Other Standards

This standard is referenced by:

- Architecture Standards
- Non-Functional Requirements (Governance & Compliance)
- Agent Rules Standard
- PR Checklist

---

## Summary

This document establishes documentation as a **mandatory, enforceable contract**.

Well-documented systems:
- scale better
- onboard faster
- integrate safer
- enable reliable AI-assisted development

**Undocumented code is considered incomplete.**