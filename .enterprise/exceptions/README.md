# Exceptions Registry

**Canonical Location:** `.enterprise/exceptions/`
**Governed By:** `.enterprise/policies/exceptions.md`
**Naming Convention:** `EXC-XXXX-<short-title>.md` (zero-padded 4-digit ID)

---

## Purpose

This directory holds all explicitly approved deviations from enterprise standards. An exception is:

- A conscious, time-bound, and auditable deviation from a standard, policy, or constraint
- Approved before implementation — never retroactive
- Subject to review and expiration

No undocumented exception is valid. Agents MUST refuse execution if an exception is required but absent.

---

## How to Create an Exception

1. Copy `EXCEPTION-TEMPLATE.md` → `EXC-XXXX-<short-title>.md`
2. Fill all sections — no placeholders left
3. Submit via PR with the affected standard(s) linked
4. After approval: add to the index table below

---

## Active Exceptions

| ID | Title | Affected Standard | Expires | Team |
|---|---|---|---|---|
| *(none)* | | | | |

---

## Expired / Closed Exceptions

| ID | Title | Closed Date | Resolution |
|---|---|---|---|
| *(none)* | | | |

---

## Rules

- Exceptions are append-only — accepted exceptions are never edited
- Expired exceptions are automatically invalid
- Agents MUST check this registry before proceeding when a standard violation is detected
- See `policies/exceptions.md` for full governance rules
