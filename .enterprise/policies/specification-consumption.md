# Specification Consumption Policy
Enterprise Overlay

---

## Status
Active — Governance Policy

## Scope
Enterprise Overlay

## Audience
- AI Agents operating under this Overlay
- Human Architects and Engineers
- Technical Leadership

---

## Purpose

This policy defines **how technical specifications MUST be consumed**
by AI agents and humans operating under the Enterprise Overlay.

It does NOT define:
- requirements
- architecture
- technical rules
- business logic

It governs **consumption behavior only**.

---

## Core Principle

> **Specifications define WHAT and WHY**  
> **Views define HOW TO CONSUME**  
> **This governance model defines WHO, WHEN, and HOW TO STOP**

---

## Authoritative Sources (Hierarchy)

The repository operates under the following authority hierarchy:

1. **Canonical Specifications**
   - `.specs/legacy/`
   - `.specs/core/` (only when explicitly consolidated via ADR)
   - Stack-specific canonical documents referenced by `RAW_SPECS.md`

2. **Stack Anchors**
   - `.specs/stacks/*/RAW_SPECS.md`

3. **Mappings**
   - `.specs/mappings/`

4. **Views (Non-Normative)**
   - `.specs/views/`

Views are **derived artifacts**, not sources of authority.

---

## Mandatory Consumption Order

All agents and humans MUST follow this order when consuming specifications:

1. **Views**
   - `.specs/views/nfr/`
   - `.specs/views/fr/`

2. **Mappings**
   - Used to understand cross-stack alignment or divergence

3. **Stack Anchors**
   - `RAW_SPECS.md` for the relevant stack

4. **Canonical Specifications**
   - Full legacy or core documents  
   ⚠️ Only when strictly necessary

This order exists to:
- minimize context size
- reduce ambiguity
- preserve authority

---

## Rules of Use for Views

Views:

- MUST be used as the **primary entry point** when available
- MUST NOT be treated as authoritative
- MUST NOT override canonical specifications
- MUST NOT be cited as the final source of truth
- MUST NOT be modified to change meaning

Views exist solely to:
- reduce token usage
- accelerate understanding
- guide safe execution

---

## Conflict Detection and Stop Rule

Execution MUST STOP if any of the following is detected:

- A contradiction between a view and a canonical specification
- Ambiguity that cannot be resolved using available specs
- A requirement to infer or invent business logic
- A need to choose between multiple valid interpretations

When a stop is triggered:

1. Execution MUST halt
2. An ADR MUST be requested
3. Human or designated authority approval is required

Stopping is a **successful governance outcome**, not a failure.

---

## Agent-Specific Constraints

### Analyst / Architect Agents
- MAY use views for rapid comprehension
- MUST validate conclusions against canonical specs
- MUST escalate conflicts or uncertainty

### Development Agents
- MUST use views as primary input
- MUST NOT infer rules beyond what is explicitly stated
- MUST STOP if required information is missing

### Technical Writing Agents
- MAY generate derivative documentation
- MUST reference canonical specs as sources
- MUST NOT present views as normative material

---

## Prohibited Behaviors

The following behaviors are strictly forbidden:

- Treating views as canonical specifications
- Skipping directly to legacy documents without justification
- Inventing or extrapolating requirements
- Harmonizing or refactoring specs without ADR
- Silently resolving conflicts

Violations MUST trigger escalation.

---

## Relationship with ADR Policy

Any change to:
- authority
- interpretation
- consolidation
- hierarchy
- scope of specifications

REQUIRES a formal ADR under the Enterprise ADR Policy.

---

## Non-Goals

This policy does NOT:

- redefine specifications
- consolidate documents
- introduce new rules
- alter system behavior
- grant autonomy to agents

---

## Final Statement

This policy exists to ensure that:
- specifications remain sovereign
- agents remain constrained
- context remains efficient
- decisions remain traceable

If ambiguity arises, **execution stops**.

---

**End of Policy**
