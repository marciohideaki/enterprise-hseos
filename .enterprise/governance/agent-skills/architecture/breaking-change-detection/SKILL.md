---
name: breaking-change-detection
description: Detect breaking changes in API, event, DTO, and contract diffs. Enforce versioning and migration requirements.
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Breaking Change Detection

## When to use
Use this skill whenever a diff or PR modifies:
- HTTP API endpoints or response/request schemas
- event or message schemas (domain events, integration events)
- shared DTOs, contracts, or client-facing models
- database-facing schemas exposed to consumers
- gRPC service definitions or Protocol Buffer schemas

---

## 1. Breaking Change Classification

### 1.1 HTTP API Breaking Changes
Any of the following IS a breaking change:

- BC-01: Removing an endpoint (path + method combination)
- BC-02: Renaming or moving an endpoint path
- BC-03: Changing the HTTP method of an existing endpoint
- BC-04: Removing a required request field
- BC-05: Renaming a request or response field
- BC-06: Changing a field's type (e.g., `string` → `integer`, `object` → `array`)
- BC-07: Making an optional field required
- BC-08: Removing a response field (consumers may depend on it)
- BC-09: Removing an enum value
- BC-10: Changing the meaning of an enum value (semantic breaking change)
- BC-11: Changing error codes or their semantics
- BC-12: Changing pagination semantics (page size meaning, cursor behavior)
- BC-13: Changing authentication requirements (adding auth to previously anonymous endpoint)

**NOT breaking (within same version):**
- Adding optional response fields (consumers must ignore unknowns)
- Adding optional request fields (ignored if absent)
- Adding new enum values (consumers must handle unknowns gracefully)
- Adding new endpoints
- Making a required field optional (with safe default)

### 1.2 Event & Message Breaking Changes
Any of the following IS a breaking change:

- BC-14: Removing an event type
- BC-15: Renaming an event type
- BC-16: Removing a field from an event payload
- BC-17: Renaming a field in an event payload
- BC-18: Changing a field's type in an event payload
- BC-19: Changing the semantics of a field (same name, different meaning)
- BC-20: Removing an enum value from an event payload
- BC-21: Changing `messageId`, `correlationId`, `causationId`, or `eventType` field semantics

### 1.3 DTO / Shared Contract Breaking Changes

- BC-22: Removing a public field
- BC-23: Renaming a public field
- BC-24: Changing a public field's type
- BC-25: Making an optional field required without a new version

---

## 2. Required Actions for Breaking Changes

When a breaking change is detected:

- BC-26: A **new API version** MUST be created (`/v2/`, `v2` prefix, etc.).
- BC-27: The old version MUST remain functional during the **deprecation window** (see Deprecation & Sunset Policy).
- BC-28: A **CHANGELOG entry** under `### Breaking Changes` with `⚠` prefix is MANDATORY.
- BC-29: A **migration guide** MUST be provided — what consumers must change and how.
- BC-30: For event breaking changes, a **new event type** MUST be introduced (e.g., `OrderPlacedV2`); the old type MUST remain active during the transition.
- BC-31: An **ADR** MUST document the breaking change decision, rationale, and rollout plan.
- BC-32: All **known consumers** MUST be notified before the breaking change is released.

---

## 3. Detection Approach

When reviewing a diff, inspect:

1. **API schema files** (OpenAPI YAML/JSON, `.proto` files) — field removals, renames, type changes
2. **Controller/handler signatures** — route changes, parameter changes
3. **Event/message classes or records** — field changes in event payload types
4. **DTO/contract classes** — public property changes
5. **Enum definitions** — value removals
6. **Serialization annotations** — JsonProperty renames that change wire format

For each changed file:
- Identify the contract surface (what is exposed to consumers)
- Classify each change as safe or breaking per Section 1
- List all breaking changes with file + line reference

---

## 4. Output Format

Produce a structured report:

```
## Breaking Change Detection Report

**Verdict:** SAFE | BREAKING

### Changes Inspected
- [file path]: [change description]

### Breaking Changes Found (if any)
| File | Line | Change Type | Rule | Impact |
|------|------|------------|------|--------|
| ...  | ...  | Field removed | BC-08 | Consumers reading this field will break |

### Required Actions
- [ ] Version bump (MAJOR)
- [ ] New API version / new event type created
- [ ] CHANGELOG entry added
- [ ] Migration guide written
- [ ] ADR drafted
- [ ] Consumers notified
```

---

## Examples

✅ Safe: Adding `"discountAmount": null` as an optional field to `OrderCreated` event.
✅ Safe: Adding a new `/v2/orders` endpoint while keeping `/v1/orders` active.

❌ Breaking: Renaming `customerId` to `clientId` in an API response — consumers using `customerId` will break.
❌ Breaking: Removing `PENDING` from an order status enum — consumers checking for `PENDING` will have undefined behavior.
❌ Breaking: Changing `price` from `string` to `number` in an event payload.
