# BMAD Enterprise Overlay

**Version:** 1.0.0  
**Status:** Stable  
**Scope:** Enterprise Governance for AI-Assisted Engineering  

---

## 1. What This Is

The **BMAD Enterprise Overlay** is a formal governance layer designed to control,
constrain, and safely enable the use of AI agents in enterprise software engineering.

It does **not** replace existing specifications, architectures, or development practices.

It **overlays** them with:
- explicit authority boundaries
- mandatory decision control
- enforceable governance mechanisms
- auditable operational discipline

---

## 2. Why This Exists

Modern AI-assisted development introduces a new category of risk:

- implicit decision-making
- silent architectural drift
- undocumented trade-offs
- loss of authorship and accountability

The BMAD Enterprise Overlay exists to ensure that:

> **AI agents assist execution — never decision-making.**

---

## 3. What This Overlay Governs

This overlay governs **behavior and process**, not implementation details.

It defines:
- who may decide
- when execution must stop
- how ambiguity is handled
- how exceptions are documented
- how history is curated
- how agents are constrained

It does **not** define:
- product requirements
- business rules
- technology stacks
- architectural designs

Those remain external and sovereign.

---

## 4. Core Principles

- Specifications are authoritative and external
- Governance is explicit, not implicit
- Ambiguity triggers mandatory stop
- Decisions require traceability (ADR)
- Exceptions are temporary and documented
- Enforcement is structural, not opinion-based

---

## 5. Repository Structure Overview

enterprise-bmad/
├── constitution/   # Non-negotiable governance principles
├── policies/       # Enforceable operational rules
├── agents/         # Agent authority and constraints
├── playbooks/      # How to operate within governance
├── modes/          # Explicit operational modes (e.g. Replay)
├── ci-cd/          # Governance enforcement documentation
├── exceptions/     # Approved, time-bound deviations
├── tooling/        # Governance-supporting scripts
└── README.md       # You are here

Each directory has a dedicated README explaining its role.

---

## 6. Relationship to Specifications (`.specs`)

All functional, non-functional, and architectural specifications live **outside**
this overlay, typically under `.specs`.

The BMAD Enterprise Overlay:
- does NOT modify specifications
- does NOT reinterpret specifications
- does NOT replace specifications

It ensures they are **respected, enforced, and not bypassed**.

---

## 7. Decision Management (ADR)

When ambiguity, conflict, or trade-offs arise:

- execution MUST stop
- an Architecture Decision Record (ADR) MUST be created
- human or designated authority approval is required

No agent may resolve such situations autonomously.

---

## 8. Agent Model

Agents defined in this overlay:

- operate under strict authority limits
- are bound by mandatory governance clauses
- must pass the Conceptual Lint
- may be invalidated if non-compliant

Agents execute tasks.  
They do not decide outcomes.

---

## 9. Enforcement Model

Governance is enforced through:
- explicit policies
- operational playbooks
- CI/CD structural validation
- replay-mode constraints
- exception auditing

If a required governance artifact is missing:

**Execution is invalid.**

---

## 10. How This Overlay Evolves

This overlay is intentionally conservative.

Changes to governance:
- require explicit review
- require ADR documentation
- are applied incrementally

Stability is prioritized over novelty.

---

## 11. Intended Audience

This repository is intended for:
- senior engineers
- architects
- technical leadership
- AI governance designers

It assumes professional context and discipline.

---

## 12. Final Statement

The BMAD Enterprise Overlay exists to make AI-assisted engineering
**safe, scalable, and auditable** in enterprise environments.

If something feels blocked by this overlay,  
the correct response is **not to bypass it**,  
but to **document and decide deliberately**.

---

**End of Document**
