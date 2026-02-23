# Deprecation & Sunset Policy
## APIs, Events and Features (Multi-Stack)

**Version:** 1.0  
**Scope:** Generic / Domain-agnostic  
**Stacks:** Backend (C#/.NET), Clients (Flutter/Dart, React/TypeScript)

> This policy defines how to deprecate and sunset contracts and features safely.
> It is designed for environments with multiple clients and long-lived consumers.

---

## 1. Core Principles

- DS-01: Deprecation is a **process**, not an event.
- DS-02: No breaking changes without a deprecation window.
- DS-03: Communication and observability are mandatory.
- DS-04: Sunset requires confirmation that active consumers have migrated.

---

## 2. What Can Be Deprecated

- APIs (endpoints, versions)
- Event types
- Fields within contracts (discouraged; prefer versioning)
- Features (feature-flagged)

---

## 3. Deprecation Lifecycle

### 3.1 Announce

- DS-05: Publish a deprecation notice with:
  - what is deprecated
  - replacement
  - deadlines
  - migration guide

### 3.2 Instrument

- DS-06: Add telemetry to measure usage of deprecated items.
- DS-07: Add warnings in logs/metrics for deprecated usage.

### 3.3 Migrate

- DS-08: Provide migration paths that are backward compatible.
- DS-09: Keep both versions running during the migration window.

### 3.4 Enforce

- DS-10: After the deadline, enforce via:
  - feature flags
  - throttling or warnings
  - contract-level rejection (when justified)

### 3.5 Sunset

- DS-11: Remove deprecated items only after:
  - usage metrics confirm near-zero usage
  - stakeholders confirm migration completion
  - a rollback plan exists

---

## 4. Timeframes (Default)

- DS-12: Default deprecation window:
  - APIs: 90 days
  - Events: 180 days (or more)
  - Mobile-dependent changes: 180+ days

---

## 5. API Deprecation Rules

- DS-13: Deprecate by version, not by endpoint whenever possible.
- DS-14: Include deprecation headers and documentation.

---

## 6. Event Deprecation Rules

- DS-15: Never change old event meaning.
- DS-16: Introduce new event types for breaking changes.
- DS-17: Keep old consumers supported through bridging/projections when required.

---

## 7. Client Considerations (Flutter / React)

- DS-18: Mobile/web release cycles require longer windows.
- DS-19: Provide migration guidance with examples.
- DS-20: Ensure clients tolerate unknown fields and enum values.

---

## 8. Governance

- DS-21: Breaking sunsets require ADR approval.
- DS-22: Deprecation notices must be versioned and stored in-repo.

---

## Summary

This policy ensures contract and feature evolution remains safe across multi-service and multi-client environments.
It prevents surprise breakages and provides a measurable path to removal.
