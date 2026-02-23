# Architecture Decision Record (ADR)
## Generic Template — Technology & Architecture Decisions

**ADR ID:** ADR-XXXX  
**Title:** <Short, descriptive decision title>  
**Status:** Proposed | Accepted | Superseded | Deprecated  
**Date:** YYYY-MM-DD  
**Deciders:** <Roles or names>  
**Technical Area:** <Architecture | Mobile | Backend | Data | DevOps | Security | etc.>  

---

## 1. Context

Describe the **background and problem statement** that led to this decision.

Include:
- What problem are we trying to solve?
- Why does this decision matter now?
- What constraints exist? (technical, organizational, regulatory, time)

---

## 2. Decision Drivers

List the key factors that influenced this decision:

- Scalability
- Maintainability
- Performance
- Security
- Developer Experience
- Consistency / Standardization
- Cost
- Time-to-market
- AI-assisted development constraints (if applicable)

---

## 3. Considered Options

Describe all **reasonable alternatives** that were evaluated.

### Option A — <Name>
- Description
- Pros
- Cons

### Option B — <Name>
- Description
- Pros
- Cons

### Option C — <Name> (if applicable)
- Description
- Pros
- Cons

---

## 4. Decision

State the **chosen option clearly and unambiguously**.

Example:
> We decided to adopt **Option A** as the standard approach for <scope>.

---

## 5. Rationale

Explain **why this option was selected**, explicitly referencing the decision drivers.

Answer:
- Why this option over the others?
- What trade-offs are being accepted?
- What risks are consciously taken?

---

## 6. Consequences

Describe the **impact of this decision**.

### Positive Consequences
- What becomes easier or better?
- What capabilities are enabled?

### Negative Consequences
- What complexity is introduced?
- What limitations exist?

### Neutral / Follow-ups
- Required refactors
- Migration steps
- Documentation or training needs

---

## 7. Implementation Notes

Optional but recommended.

- Required changes to existing code
- New standards, templates or libraries
- Migration strategy (if any)
- Backward compatibility considerations

---

## 8. Compliance & Governance

- Does this decision affect security, privacy or compliance? (Yes/No)
- Are additional approvals required? (e.g., Security, DPO, Architecture Board)

---

## 9. AI-Assisted Engineering Considerations

Specify how this decision affects or constrains **AI-generated code**.

- Is this decision **mandatory** for AI agents? (Yes/No)
- Are prompts or templates impacted?
- What must AI tools do or avoid as a result?

---

## 10. References

- Related ADRs
- Architecture Standards
- External articles or documentation
- Proofs of concept

---

## 11. Change History

| Date | Change | Author |
|------|--------|--------|
| YYYY-MM-DD | Initial version | <Name> |

---

## Notes

- One ADR per decision.
- ADRs must be immutable once **Accepted**.
- Superseding decisions must reference the original ADR.
- ADRs are **normative** and enforceable once accepted.