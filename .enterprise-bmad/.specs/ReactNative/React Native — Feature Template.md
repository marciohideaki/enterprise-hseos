# React Native — Feature Template
## State-of-the-Art Feature Structure (Domain-Agnostic)

**Version:** 1.0  
**Status:** Canonical / Normative Template  
**Stack:** React Native + TypeScript  

> This document defines the **standard template for implementing a feature** in React Native applications.
>
> It enforces architectural boundaries, naming conventions and safe evolution, and is designed to be
> used by **human developers and AI agents** without ambiguity.

---

## Referenced Platform Standards (MANDATORY)

This template **must be used together with**:

- **React Native Architecture Standard**
- **React Native Functional Requirements (FR)**
- **React Native Non-Functional Requirements (NFR)**
- **React Native Core Networking Package Specification**
- **Naming & Conventions Standard** (Frontend / React Profile)
- **Data Contracts & Schema Evolution Standard**
- **Code & API Documentation Standard**
- **Pull Request Checklist — Standard**
- **Agent Rules Standard**

Non-compliance is a blocking violation.

---

## 1. Feature Folder Structure

```
src/features/<feature-name>/
  presentation/
    components/
    screens/
    hooks/
    index.ts

  application/
    useCases/
    state/
    index.ts

  domain/
    models/
    errors/
    index.ts

  data/
    api/
    mappers/
    repositories/
    index.ts

  index.ts
```

Rules:
- Each feature represents a **single business capability**
- Cross-feature reuse is forbidden
- Shared logic must live in `shared/`

---

## 2. Presentation Layer

### Responsibilities

- UI rendering
- User interaction handling
- Local UI state

### Rules

- No business logic
- No direct API or storage access
- Side effects handled via application layer

---

## 3. Application Layer

### Responsibilities

- Use case orchestration
- State coordination
- Mapping `Result<T>` to UI state

### Rules

- One folder per use case
- Explicit loading, success and error flows
- No framework-specific dependencies outside React hooks

---

## 4. Domain Layer

### Responsibilities

- Domain models and value objects
- Domain-specific errors

### Rules

- Pure TypeScript
- No React Native imports
- No persistence or networking

---

## 5. Data Layer

### Responsibilities

- API client calls (via Core Networking Package)
- DTO parsing and mapping
- Repository implementations

### Rules

- All HTTP calls go through Core Networking Package
- DTOs must tolerate missing and unknown fields
- Enums must include `unknown`

---

## 6. Naming & Conventions

- Feature folder: `kebab-case`
- Components: `PascalCase`
- Hooks: `useCamelCase`
- Files: `kebab-case.ts`

---

## 7. Documentation Rules

- All exported symbols must be documented (TSDoc)
- Use cases must document side effects and assumptions
- Domain models must document invariants

---

## 8. Testing Expectations

- Domain logic must be unit-tested
- Use cases must be testable in isolation
- UI components must support deterministic testing

---

## 9. AI-Assisted Engineering Rules

- AI-generated features must follow this template exactly
- No architectural shortcuts allowed
- Deviations require ADR approval

---

## Summary

This Feature Template defines the **only supported structure** for React Native features.

It ensures:
- architectural consistency
- testability
- contract safety
- safe AI-assisted development

Any deviation is a blocking violation.

