---
name: breaking-change-detection
tier: quick
version: "1.0.0"
---

# Breaking Change Detection — Quick Check

> Tier 1: use when a PR modifies API endpoints, event schemas, DTOs, or message contracts.
> Load SKILL.md (Tier 2) for full classification rules and required remediation steps.

---

## Checklist — HTTP API

- [ ] No endpoint path removed or renamed
- [ ] No required request field removed or renamed
- [ ] No response field removed or renamed
- [ ] No field type changed
- [ ] No enum value removed or renamed
- [ ] No HTTP method changed for an existing endpoint
- [ ] No error code meaning changed

## Checklist — Events & Messages

- [ ] No event type name changed
- [ ] No required event field removed or renamed
- [ ] No field type changed in event payload
- [ ] No enum value removed from event
- [ ] `schemaVersion` incremented for any payload change

## Checklist — DTOs / Shared Contracts

- [ ] No required field removed or renamed
- [ ] No field type changed
- [ ] New fields introduced as optional (nullable / with safe default)

---

## Verdict

**SAFE** → no breaking changes detected, proceed.
**BREAKING** → one or more violations — version bump + migration guidance required. Load `SKILL.md` (Tier 2) for full remediation requirements.
