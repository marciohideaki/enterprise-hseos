# Enterprise Pre-Flight Checks
**Status:** Mandatory  
**Scope:** All AI Agents before any execution  
**Version:** 1.0  

---

## 1. Purpose
Pre-Flight Checks exist to ensure that **no agent executes work without full governance context**.

Execution without passing Pre-Flight Checks is considered **invalid output**.

---

## 2. Mandatory Pre-Flight Checklist
Before executing ANY task, AI Agents MUST confirm:

### 2.1 Governance Loaded
- [ ] Enterprise Constitution loaded
- [ ] Enterprise Constitution loaded
- [ ] Enterprise Policies loaded
- [ ] Agent-specific Authority loaded
- [ ] Agent-specific Constraints loaded

If any item is missing: **STOP execution**.

---

### 2.2 Documentation Readiness
- [ ] Relevant `.specs/core/*` loaded
- [ ] Relevant `.specs/cross/*` loaded
- [ ] Relevant `.specs/stacks/<stack>/*` loaded
- [ ] Relevant ADRs loaded

If documentation is missing or ambiguous: **STOP and escalate**.

---

### 2.3 Sharding Validation
- [ ] Document size and scope evaluated
- [ ] Sharding required?  
  - [ ] YES → Sharding applied before modification  
  - [ ] NO → Proceed

Operating on oversized unsharded documents is forbidden.

---

### 2.4 ADR Requirement Check
- [ ] Decision required?
- [ ] Trade-off detected?
- [ ] Conflict detected?

If YES to any and no ADR exists: **STOP and draft ADR**.

---

## 3. Execution Authorization
Execution is authorized ONLY when:

- All Pre-Flight items are validated
- No blocking condition exists
- All required escalations are resolved

Otherwise, execution is invalid.

---

## 4. Agent Obligation
AI Agents MUST:

- Explicitly state Pre-Flight completion
- Refuse execution if checks fail
- Never bypass Pre-Flight for speed

---

## 5. Acceptance
All contributors (human or AI) are bound by this policy.

**End of Policy**
