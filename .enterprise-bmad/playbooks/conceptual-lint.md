# BMAD Enterprise — Conceptual Lint Playbook
**Type:** Governance Playbook  
**Status:** Mandatory for Agent Validation  
**Version:** 1.0  

---

## 1. Purpose

This playbook defines the **Conceptual Lint**, a governance mechanism used to
validate whether agents, documents, or workflows are **semantically compatible**
with the BMAD Enterprise Overlay.

The conceptual lint validates **authority, scope, and decision boundaries** —
not code quality or syntax.

---

## 2. When This Lint Must Be Applied

The conceptual lint MUST be applied when:

- Creating or modifying an agent definition
- Introducing a new agent
- Revising agent authority or constraints
- Adopting third-party or external agent prompts
- Reviewing legacy agents for compliance
- Operating in Replay Mode

---

## 3. What This Lint Is NOT

The conceptual lint:

- Is NOT a code linter
- Is NOT a style checker
- Is NOT a best-practices evaluator
- Does NOT judge implementation quality

It validates **governance compatibility only**.

---

## 4. Conceptual Validation Dimensions

Every agent or document MUST pass all four dimensions below.

Failure in ANY dimension results in **lint failure**.

---

### 4.1 Authority Validation

**Question:**  
Does the agent assume authority beyond its role?

#### Checks
- [ ] Does NOT define or redefine architecture
- [ ] Does NOT choose or alter stack
- [ ] Does NOT override specifications
- [ ] Does NOT make final technical decisions

❌ Any declaration of decision authority = FAIL

---

### 4.2 Scope Validation

**Question:**  
Does the agent operate strictly within its assigned role?

#### Checks
- [ ] Does NOT invade responsibilities of other agents
- [ ] Does NOT mix decision-making with execution
- [ ] Does NOT bypass governance flows

❌ Acting outside defined scope = FAIL

---

### 4.3 Normative Source Validation

**Question:**  
Is the source of truth explicit and respected?

#### Checks
- [ ] Explicitly references `.specs` as authoritative
- [ ] Treats specifications as normative, not advisory
- [ ] Does NOT rely on “best practices” when specs exist

❌ Specs treated as optional = FAIL

---

### 4.4 Mandatory Stop & ADR Validation

**Question:**  
What happens on ambiguity, conflict, or trade-off?

#### Checks
- [ ] Explicit stop on ambiguity or conflict
- [ ] Mandatory ADR requirement stated
- [ ] No autonomous resolution allowed

❌ No stop mechanism = FAIL

---

## 5. Lint Outcome

After validation, record the result:

```text
Conceptual Lint Result: PASS / FAIL
Validated By:
Date:
Notes:
Only agents or documents with **PASS** may be used.

---

## 6. Relationship to Other Governance Artifacts

- This playbook is subordinate to the Constitution  
- This playbook complements Policies  
- This playbook guides Agent definitions  
- This playbook supports CI/CD governance (indirectly)

---

## 7. Enforcement

- Conceptual lint failures MUST be corrected  
- Agents failing lint MUST NOT be used  
- Repeated violations require escalation  

---

**End of Playbook**
