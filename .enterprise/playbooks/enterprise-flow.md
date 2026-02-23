# Enterprise Execution Flow
**Scope:** All work executed under Enterprise  
**Status:** Mandatory  
**Version:** 1.0  

---

## 1. Purpose
This playbook defines the **canonical execution flow** for work performed by humans or Enterprise agents.

No work may skip steps.

---

## 2. Canonical Flow

### Step 1 — Intake
- Requirement, request, or task is received
- Scope is identified
- Impact is estimated

---

### Step 2 — Pre-Flight Checks
Mandatory validation of:
- Governance
- Documentation
- Sharding
- ADR requirements

Failure → STOP.

---

### Step 3 — Decision Point
If the task requires:
- Trade-offs
- New constraints
- Architectural decisions

Then → **ADR is mandatory**.

---

### Step 4 — Execution
Execution occurs ONLY after:
- Pre-flight passes
- ADRs (if required) are approved
- No blocking exceptions exist

---

### Step 5 — Validation
Outputs are validated against:
- Policies
- ADRs
- Documentation standards

Invalid output MUST be rejected.

---

### Step 6 — Delivery
Only validated work may be:
- Merged
- Released
- Communicated

---

## 3. Forbidden Shortcuts
The following are forbidden:

- Skipping pre-flight
- Encoding decisions in code
- Silent scope expansion
- Silent standard deviation

---

**End of Playbook**
