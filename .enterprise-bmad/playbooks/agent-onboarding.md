# Agent Onboarding Playbook
**Scope:** All BMAD Agents (existing or new)  
**Status:** Mandatory  
**Version:** 1.0  

---

## 1. Purpose
This playbook defines the **mandatory onboarding flow for any BMAD Agent** operating in an Enterprise environment.

No agent may operate without completing onboarding.

---

## 2. Onboarding Preconditions
Before onboarding begins, the following MUST exist:

- Enterprise Constitution
- Constitution Addendum
- Enterprise Policies
- Agent folder under `/enterprise-bmad/agents/<agent-name>/`

If any prerequisite is missing, onboarding MUST stop.

---

## 3. Mandatory Onboarding Steps

### Step 1 — Governance Load
The agent MUST load and acknowledge:

- Constitution
- Addendum
- All policies under `/enterprise-bmad/policies/`

Failure to load governance invalidates the agent.

---

### Step 2 — Role Definition
The agent MUST have:

- `authority.md`
- `constraints.md`

The agent MUST explicitly acknowledge:
- What it is allowed to do
- What it is forbidden to do

---

### Step 3 — Scope Alignment
The agent MUST identify:

- Which stacks it operates on
- Which domains it touches
- Which artifacts it may produce

Out-of-scope execution is forbidden.

---

### Step 4 — Execution Rules
The agent MUST agree to:

- Pre-Flight Checks
- ADR requirements
- Sharding rules
- Escalation rules

No “best judgment” overrides are allowed.

---

## 4. Onboarding Completion Criteria
Onboarding is considered complete ONLY when:

- Governance is loaded
- Role is explicit
- Constraints are acknowledged
- Execution rules are accepted

Otherwise, the agent is considered **non-operational**.

---

## 5. Re-Onboarding
Re-onboarding is REQUIRED when:

- Constitution changes
- Policies change
- Agent authority or constraints change

---

**End of Playbook**
