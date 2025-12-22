# Enterprise ADR Policy
**Status:** Mandatory  
**Scope:** All architectural, technical, and governance decisions  
**Version:** 1.0  

---

## 1. Purpose
This policy defines **when, how, and why Architectural Decision Records (ADRs) are required** in an Enterprise BMAD environment.

ADRs exist to:
- Make decisions explicit
- Preserve historical context
- Prevent silent regressions
- Enable long-term maintainability and auditability

No significant decision may remain implicit.

---

## 2. What Requires an ADR (Mandatory Triggers)
An ADR MUST be created when any of the following occur:

### 2.1 Architecture & Design
- Introduction or modification of architectural patterns
- Changes to system boundaries or bounded contexts
- Cross-service or cross-domain communication decisions
- Technology or framework adoption or removal

### 2.2 Requirements & Scope
- Changes that affect Functional Requirements (FR)
- Changes that affect Non-Functional Requirements (NFR)
- Trade-offs between scope, quality, performance, or cost
- Any decision that constrains future options

### 2.3 Security, Data & Compliance
- Security posture changes
- Authentication or authorization model changes
- Data storage, encryption, or retention changes
- Compliance or regulatory trade-offs

### 2.4 Performance & Operations
- Performance-impacting decisions
- Scalability or availability trade-offs
- Operational model changes
- Observability strategy changes

### 2.5 Governance & Standards
- Exceptions to established standards
- Temporary deviations (even time-boxed)
- Changes to policies or enforcement rules

If a decision is non-trivial or irreversible: **ADR is mandatory**.

---

## 3. What Does NOT Require an ADR
The following do NOT require an ADR:

- Pure refactoring with no semantic change
- Bug fixes that do not alter behavior
- Documentation clarifications
- Implementation details fully dictated by existing standards

If unsure: **create an ADR**.

---

## 4. ADR Lifecycle
Each ADR MUST follow a clear lifecycle:

1. **Proposed** — decision under consideration
2. **Accepted** — approved and authoritative
3. **Superseded** — replaced by a newer ADR
4. **Deprecated** — no longer relevant but kept for history

ADRs are **append-only**. They are never deleted.

---

## 5. Canonical ADR Location
All ADRs MUST live under:
.specs/decisions/

Naming convention:
ADR-XXXX-<short-title>.md

Where:
- `XXXX` is a sequential identifier
- `<short-title>` is kebab-case and descriptive

---

## 6. Mandatory ADR Structure
Every ADR MUST include the following sections:

```md
# ADR-XXXX: <Title>

## Status
Proposed | Accepted | Superseded | Deprecated

## Context
Describe the problem, constraints, and forces at play.

## Decision
Clearly state the decision that was made.

## Alternatives Considered
List viable alternatives and why they were not chosen.

## Consequences
Positive and negative outcomes, trade-offs, and risks.

## Mitigations
How risks or downsides will be addressed.

## References
Links to specs, standards, PRs, or related ADRs.
## 6. Mandatory ADR Structure
Missing sections invalidate the ADR.

---

## 7. Agent-Specific Rules

### 7.1 Mandatory Actions
BMAD Agents MUST:

- Draft ADRs when encountering:
  - Ambiguity
  - Conflicting standards
  - Required trade-offs
- STOP execution when an ADR is required but missing
- Never approve ADRs
- Never bypass ADR creation via “best judgment”

### 7.2 Forbidden Actions
BMAD Agents MUST NOT:

- Encode decisions only in code
- Resolve conflicts silently
- Treat ADRs as optional documentation

---

## 8. ADR vs Documentation

- **ADRs** explain **WHY**
- **Documentation** explains **WHAT** and **HOW**
- **Code** implements **THE DECISION**

All three MUST remain consistent.

---

## 9. Review & Approval

ADRs require:

- Explicit review
- Human approval (or designated authority)
- Status update to `Accepted` upon approval

Until accepted, ADRs are **non-authoritative**.

---

## 10. Enforcement

If an ADR is required and missing:

- Execution MUST stop
- Escalation is mandatory
- Any output produced is considered invalid

---

## 11. Acceptance

All contributors (human or AI) are bound by this policy.

**End of Policy**
