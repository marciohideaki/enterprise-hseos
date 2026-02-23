# Enterprise Overlay

**Version:** 1.0.0  
**Status:** Stable  
**Scope:** Enterprise Governance for AI-Assisted Engineering  

---

## 1. What This Is

The **Enterprise Overlay** is a formal governance layer designed to control,
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

The Enterprise Overlay exists to ensure that:

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

## 5. Repository Structure

```
.enterprise/
├── .specs/                         # All governance specifications (agent-facing)
│   ├── constitution/               # Enterprise Constitution (single document)
│   ├── core/                       # Organizational invariants — all agents read first
│   ├── cross/                      # Cross-cutting standards — mandatory across all stacks
│   ├── CSharp/                     # C# / .NET stack standards
│   ├── Java/                       # Java stack standards
│   ├── Go/                         # Go stack standards
│   ├── PHP/                        # PHP stack standards
│   ├── Cpp/                        # C++ stack standards
│   ├── Flutter/                    # Flutter stack standards
│   ├── ReactNative/                # React Native stack standards
│   └── decisions/                  # Architecture Decision Records (ADRs)
├── governance/
│   ├── agent-skills/               # Tiered skill system (SKILLS-REGISTRY + SKILL-QUICK + SKILL)
│   └── policies/                   # Internal governance policies (architecture-boundaries)
├── agents/                         # Agent persona definitions and authority limits
├── policies/                       # Operational governance policies
├── playbooks/                      # How to operate within governance
├── exceptions/                     # Approved, time-bound deviations (EXC-XXXX)
├── modes/                          # Operational modes (e.g., Replay)
├── ci-cd/                          # CI/CD governance enforcement
├── tooling/                        # Governance-supporting scripts and bootstrap
└── README.md                       # You are here (human documentation)
```

> **Human vs. Agent Navigation**
> - Human contributors: read READMEs (this file and per-directory)
> - AI agents: navigate via `_INDEX.md` files inside `.specs/` and `SKILLS-REGISTRY.md` inside `governance/agent-skills/`
> - READMEs are **not read by agents** — they are for human context only

---

## 6. Specifications (`.specs`)

All governance specifications live under `.enterprise/.specs/`. This includes the
Constitution, core engineering standards, cross-cutting concerns, stack-specific
standards, and ADRs.

The Enterprise Overlay:
- does NOT modify product specifications (FR/NFR belong to teams)
- does NOT reinterpret architecture decisions
- DOES enforce that standards are respected and not bypassed

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

The Enterprise Overlay exists to make AI-assisted engineering
**safe, scalable, and auditable** in enterprise environments.

If something feels blocked by this overlay,  
the correct response is **not to bypass it**,  
but to **document and decide deliberately**.

---

**End of Document**
