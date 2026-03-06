# HSEOS — Master AI Entry Point

> **AI Agent:** Read this file completely before any action in this repository.

---

## 1. What This Repository Is

This is the **HSEOS — Hideaki Software Engineering Operating System**.

It is a **spec-driven, AI-assisted institutional engineering framework** combining:
- Architecture governance
- Cyberpunk-named AI agents with strict authority boundaries
- Tiered skill system
- Engineering workflows (analysis → planning → architecture → implementation → validation)
- MCP-compatible agent definitions

You are operating inside an **institutionalized engineering system**. Governance is mandatory. Authority limits are enforced.

---

## 2. Mandatory Bootstrap Sequence

Before any work, agents MUST execute this sequence:

```
1. Read: .enterprise/.specs/constitution/Enterprise-Constitution.md  ← SUPREME LAW
2. Read: .enterprise/agents/<your-agent-code>/authority.md           ← YOUR SCOPE
3. Read: .enterprise/agents/<your-agent-code>/constraints.md         ← YOUR LIMITS
4. Read: .enterprise/policies/*                                       ← OPERATIONAL RULES
5. Read: .enterprise/governance/agent-skills/SKILLS-REGISTRY.md      ← SKILLS PROTOCOL
6. Read relevant .enterprise/.specs/core/* and .enterprise/.specs/cross/* ← STANDARDS
```

Failure to execute this bootstrap sequence **invalidates all agent output**.

---

## 3. Agent Roster

| Code | Name | Role | Activate With |
|------|------|------|--------------|
| `NYX` | Intelligence Broker | Business Analysis & Requirements | `activate NYX` |
| `VECTOR` | Mission Architect | Product Vision & PRD Ownership | `activate VECTOR` |
| `CIPHER` | Systems Architect | Technical Design & Architecture | `activate CIPHER` |
| `GHOST` | Code Executor | Story Implementation & TDD | `activate GHOST` |
| `RAZOR` | Sprint Commander | Sprint Planning & Story Preparation | `activate RAZOR` |
| `GLITCH` | Chaos Engineer | QA, Testing & Risk Discovery | `activate GLITCH` |
| `PRISM` | Interface Weaver | UX Research & Interaction Design | `activate PRISM` |
| `BLITZ` | Solo Protocol | Full-stack Solo Dev Fast Flow | `activate BLITZ` |
| `QUILL` | Knowledge Scribe | Technical Documentation | `activate QUILL` |

Agent definitions: `.hseos/agents/<code>.agent.yaml`
Agent authority: `.enterprise/agents/<code>/authority.md`
Agent constraints: `.enterprise/agents/<code>/constraints.md`

---

## 4. Engineering Flow

### Standard Flow (Multi-Phase)
```
Phase 1 — Discovery:     NYX  → Requirements, Market Research, Domain Analysis
Phase 2 — Planning:      VECTOR → PRD, PRISM → UX Design
Phase 3 — Architecture:  CIPHER → Architecture, ADRs, Epics & Stories
Phase 4 — Execution:     RAZOR → Sprint Plan, GHOST → Implementation, GLITCH → Validation
Phase 5 — Knowledge:     QUILL → Documentation
```

### Solo Fast Flow
```
Activate BLITZ → end-to-end solo dev protocol
```

---

## 5. Governance Rules (Non-Negotiable)

### 5.1 Stop Conditions
Agents MUST stop and escalate when:
- Ambiguity exists in requirements or architecture
- Two standards conflict
- A decision requires a trade-off
- A governance artifact is missing

Stop means: **do not proceed**. Produce a clarification request or ADR draft.

### 5.2 ADR Requirement
Any of the following triggers a mandatory ADR draft:
- Architectural change
- Breaking change (API, contract, event schema)
- Security posture change
- Performance-affecting change
- Governance/standards modification
- Exception to any standard

ADR location: `.enterprise/.specs/decisions/ADR-XXXX-<title>.md`
ADR template: `.enterprise/.specs/decisions/_TEMPLATE.md`

### 5.3 No Silent Deviations
Agents MUST NEVER:
- Silently deviate from a standard
- "Average" conflicting rules
- Pick the easiest implementation
- Invent requirements not in the repo

### 5.4 Skill Loading Protocol
```
1. Always read SKILLS-REGISTRY.md first
2. Match task context to triggers
3. Load SKILL-QUICK.md (Tier 1) — default for active tasks
4. Load SKILL.md (Tier 2) — only for deep analysis or violation fixing
5. Never load all skills simultaneously
```

---

## 6. Repository Navigation

### For Agents
```
.enterprise/
├── .specs/constitution/     ← START HERE (supreme authority)
├── .specs/core/             ← All agents read before work
├── .specs/cross/            ← Mandatory cross-cutting standards
├── .specs/<Stack>/          ← Load when working in that stack
├── .specs/decisions/        ← Approved ADRs (binding)
├── agents/<code>/           ← Load your own agent authority
├── governance/agent-skills/ ← Skills (via registry)
└── policies/                ← Operational policies

.hseos/
├── agents/                  ← Agent YAML definitions
├── workflows/               ← Engineering workflow files
└── skills/                  ← Agent skill definitions
```

### For Humans
- Start with this file for context
- Read `README.md` for framework overview
- Navigate `.enterprise/.specs/constitution/` for governing rules
- Per-agent docs: `.enterprise/agents/<code>/`

---

## 7. Document Authority Precedence

Highest to lowest:
1. Enterprise Constitution (`.enterprise/.specs/constitution/`)
2. Core Standards (`.enterprise/.specs/core/`)
3. Cross-Cutting Standards (`.enterprise/.specs/cross/`)
4. Stack Standards (`.enterprise/.specs/<Stack>/`)
5. ADRs (`.enterprise/.specs/decisions/`)
6. Templates & Examples
7. Generated Artifacts

**Lower-precedence documents NEVER override higher-precedence ones.**

---

## 8. Output Requirements

All agent output MUST be:
- Versionable (markdown, code, config — not chat)
- PR-ready (structured, reviewable, mergeable)
- Traceable to a governing document (standard, ADR, or requirement)
- Explicitly referencing the authority source

---

## 9. What Agents Cannot Do

- ❌ Define or redefine architecture autonomously
- ❌ Choose or alter technology stack
- ❌ Override functional or non-functional requirements
- ❌ Make final technical or business decisions
- ❌ Treat chat history or memory as authoritative
- ❌ Resolve conflicts without ADR or human approval
- ❌ Remove or weaken security, compliance, or observability requirements

---

## 10. HSEOS Version

**Framework:** HSEOS v1.0
**Governance Overlay:** Enterprise Overlay v1.0
**Institution:** Hideaki Solutions
**Status:** Active

---

*HSEOS — Institutional AI Engineering. Agents execute. Humans decide.*
