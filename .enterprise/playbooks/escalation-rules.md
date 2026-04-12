# Escalation Rules Playbook
**Scope:** Humans and AI Agents  
**Status:** Mandatory  
**Version:** 1.0  

---

## 1. Purpose
This playbook defines **when and how escalation MUST occur**.

Escalation is not failure — silence is.

---

## 2. Mandatory Escalation Triggers
Escalation MUST occur when:

- Documentation is ambiguous
- Policies conflict
- ADR is required but missing
- Scope exceeds agent authority
- Security or compliance risk is detected
- An exception is required
- A fix has been attempted **3 or more times** without resolving the root cause (see §5)

---

## 3. Escalation Process

### Step 1 — Stop Execution
Execution MUST stop immediately.

---

### Step 2 — Record Context
The following MUST be documented:
- What triggered escalation
- Impacted artifacts
- Blocked actions

---

### Step 3 — Escalate to Authority
Escalation MUST be directed to:
- Human owner
- Architecture authority
- Governance owner

(as defined by the organization)

---

### Step 4 — Resume Only After Resolution
Execution may resume ONLY when:
- Conflict is resolved
- ADR or exception is approved
- Governance is updated if required

---

## 4. Forbidden Behavior
The following are forbidden:

- Continuing “temporarily”
- Making assumptions
- Resolving conflicts silently
- Overriding governance

---

## 5. Dev↔Validation Loop — Attempt Limit

When an agent implements a fix and the validation agent (GLITCH or equivalent) rejects it:

| Attempt | Action |
|---------|--------|
| 1st failure | Re-analyze, try alternative fix |
| 2nd failure | Broaden investigation scope — check adjacent code, specs |
| 3rd failure | **STOP. Escalate.** Do not attempt Fix #4. |

**After 3 failed attempts**, escalation MUST go to:
- CIPHER (Systems Architect) — if root cause is architectural
- Human owner — if cause is ambiguous or requires trade-off decision

**Rationale:** Three failures indicate the problem is likely deeper than the current agent's scope or authority. Continuing without architectural review risks masking a structural issue.

---

**End of Playbook**
