# Data Contracts & Schema Evolution Standard
## APIs, Events, DTOs and Storage Compatibility (Multi-Stack)

**Version:** 1.0  
**Scope:** Generic / Domain-agnostic  
**Stacks:** Backend (C#/.NET), Clients (Flutter/Dart, React/TypeScript)

> This standard defines how to evolve **data contracts** safely over time.
> It applies to **HTTP APIs, event payloads, message schemas, DTOs and persisted read models**.
> It is designed for multi-service + multi-client environments where older consumers may remain in the wild.

---

## 1. Core Principles (Non-Negotiable)

- DC-01: Contracts are **public APIs**. Treat every change as if an unknown consumer exists.
- DC-02: **Backward compatibility** is the default.
- DC-03: Schema evolution must be **additive-first**.
- DC-04: Producers must be tolerant; consumers must be resilient.
- DC-05: Breaking changes require explicit versioning and a deprecation plan.

---

## 2. Compatibility Definitions

### 2.1 Backward Compatible
A newer producer/contract can be consumed by older clients/consumers without changes.

### 2.2 Forward Compatible
Older producers/contract can be consumed by newer clients/consumers (best-effort).

### 2.3 Breaking Change
A change that causes runtime failures or semantic corruption for existing consumers.

---

## 3. Universal Rules for All Contracts

### 3.1 Field Evolution Rules

- DC-06: **Adding optional fields** is allowed and preferred.
- DC-07: **Removing fields** is breaking and forbidden without version bump + sunset.
- DC-08: **Renaming fields** is breaking. Use “add new + keep old” migration.
- DC-09: **Changing field type** is breaking. Use new field + migration.
- DC-10: **Changing meaning/semantics** is breaking even if the type stays the same.

### 3.2 Required vs Optional

- DC-11: New fields must be introduced as **optional** (nullable or with safe default).
- DC-12: A field may become required only via **new version** (API vNext or new event type).

### 3.3 Defaults

- DC-13: Defaults must be safe and documented.
- DC-14: Never rely on client defaults for correctness.

### 3.4 Unknown Fields

- DC-15: Clients/consumers must ignore unknown fields.
- DC-16: Producers must not depend on consumers understanding new fields.

---

## 4. HTTP API Contracts

### 4.1 Versioning Policy

- DC-17: APIs must be explicitly versioned (e.g., `/v1/...`, `/v2/...`).
- DC-18: Backward compatible changes may ship within the same API version.
- DC-19: Breaking changes require a **new API version**.

### 4.2 Request/Response Compatibility

Allowed within same version:
- Add optional response fields
- Add optional request fields (ignored when absent)
- Expand enum with new values **only if clients treat unknowns safely**

Forbidden within same version:
- Remove fields
- Rename fields
- Change types
- Change enum meaning

### 4.3 Error Envelope

- DC-20: Error envelope must be stable and versioned.
- DC-21: Error codes are contracts (do not change meaning).

### 4.4 Pagination/Filtering

- DC-22: Changing paging semantics is breaking.
- DC-23: New filters/sorts are additive.

---

## 5. Event & Messaging Contracts

### 5.1 Event Immutability

- DC-24: Events are immutable.
- DC-25: Do not “fix” past events. Publish correction events.

### 5.2 Versioning Strategy

- DC-26: Breaking event changes must be represented as **new event types**.
  - Example: `OrderPlacedV2` (or `OrderPlaced` + `schemaVersion: 2` if your org standardizes on inline versioning).
- DC-27: Prefer new event types over in-place breaking changes.

### 5.3 Additive Changes

- DC-28: Adding optional fields to event payload is allowed.
- DC-29: Adding enum values requires consumer tolerance for unknown values.

### 5.4 Correlation & Causation

- DC-30: All event messages must include:
  - `messageId`
  - `occurredAt`
  - `correlationId`
  - `causationId`
  - `eventType`
  - `schemaVersion` (recommended)

### 5.5 Consumer Rules

- DC-31: Consumers must be idempotent.
- DC-32: Consumers must handle missing optional fields gracefully.
- DC-33: Consumers must ignore unknown fields.

---

## 6. Storage & Read Model Schema Evolution

- DC-34: Relational write model follows expand–contract migrations.
- DC-35: Read models are disposable and rebuildable.
- DC-36: Any read model schema change must be replay-safe.
- DC-37: Cache keys must include version when DTO shape changes.

---

## 7. Multi-Stack Serialization Profiles

### 7.1 Backend (C# / .NET)

- DC-38: JSON serialization must be deterministic.
- DC-39: Configure serializers to ignore unknown fields.
- DC-40: Enums must serialize predictably (prefer string enums where feasible) and handle unknown values.

### 7.2 Flutter (Dart)

- DC-41: JSON decoding must tolerate missing fields.
- DC-42: Unknown fields must be ignored by models.
- DC-43: Enums must include an `unknown` fallback.

### 7.3 React (TypeScript)

- DC-44: Runtime validation is recommended for external boundaries (e.g., Zod).
- DC-45: Unknown enum values must map to `"unknown"` or a safe fallback.

---

## 8. Change Process (Mandatory)

- DC-46: Any contract change requires:
  - updated documentation
  - tests (unit/contract)
  - version bump when breaking
- DC-47: Breaking changes require an ADR and a deprecation plan.

---

## 9. Contract Testing (Recommended Baseline)

- DC-48: API contracts should be verified via consumer-driven contract tests where feasible.
- DC-49: Event schemas should be validated in CI using schema fixtures and compatibility checks.

---

## Summary

This standard ensures contract evolution remains safe across:
- multiple services
- multiple client stacks (C#, Flutter, React)
- long-lived consumers

It prevents breaking changes from silently propagating and provides a disciplined path for versioning, deprecation and migration.
