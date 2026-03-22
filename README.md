# HSEOS — Hideaki Software Engineering Operating System

> *"Where human intent becomes institutional intelligence."*

**A spec-driven, AI-assisted development framework combining architecture governance, cyberpunk agents, skills, MCPs and engineering workflows.**

---

## What Is HSEOS?

HSEOS is the **Hideaki Engineering Framework** — an institutional operating system for software engineering teams that:

- Enforces governance through **immutable constitutional rules**
- Orchestrates work through **cyberpunk-named AI agents** with strict authority boundaries
- Scales from solo feature development to enterprise multi-team delivery
- Treats AI as an **executor**, never a decision-maker

---

## The Seven Laws of HSEOS

1. **Specs are sovereign** — all agents read specs before acting
2. **Ambiguity triggers stop** — no autonomous resolution of conflicts
3. **ADRs are mandatory** for every architectural trade-off
4. **Authority is explicit** — every agent knows exactly what it can and cannot do
5. **GitHub is truth** — chat, memory, and assumption are not authoritative
6. **Enforcement is structural** — governance is not optional
7. **Humans decide** — agents execute

---

## Agent Roster

| Code | Name | Role | Domain |
|------|------|------|--------|
| `NYX` | Intelligence Broker | Business Analysis & Requirements | Discovery |
| `VECTOR` | Mission Architect | Product Vision & PRD Ownership | Planning |
| `CIPHER` | Systems Architect | Technical Design & Architecture | Solutioning |
| `GHOST` | Code Executor | Story Implementation & TDD | Execution |
| `RAZOR` | Sprint Commander | Sprint Planning & Story Preparation | Coordination |
| `GLITCH` | Chaos Engineer | QA, Testing & Risk Discovery | Validation |
| `PRISM` | Interface Weaver | UX Research & Interaction Design | Experience |
| `BLITZ` | Solo Protocol | Full-stack Solo Dev Fast Flow | Autonomy |
| `QUILL` | Knowledge Scribe | Technical Documentation | Knowledge |

---

## Repository Structure

```
hseos/
├── .hseos/                         # HSEOS Agent Framework Core
│   ├── agents/                     # Agent definitions (YAML)
│   ├── workflows/                  # Engineering workflows
│   ├── skills/                     # Reusable agent skills
│   ├── teams/                      # Multi-agent team configs
│   ├── data/                       # Templates and data files
│   └── config/                     # Framework configuration
│
├── .enterprise/                    # Institutional Governance Overlay
│   ├── .specs/                     # All governance specifications
│   │   ├── constitution/           # Enterprise Constitution (supreme law)
│   │   ├── core/                   # Organizational invariants
│   │   ├── cross/                  # Cross-cutting standards
│   │   ├── <Stack>/                # Stack-specific standards
│   │   └── decisions/              # Architecture Decision Records (ADRs)
│   ├── agents/                     # Agent authority & constraint definitions
│   ├── governance/                 # Skills registry + architecture policies
│   ├── policies/                   # Operational governance policies
│   ├── playbooks/                  # How to operate within governance
│   ├── exceptions/                 # Approved time-bound deviations
│   ├── modes/                      # Operational modes (Replay, etc.)
│   └── ci-cd/                      # CI/CD enforcement
│
└── CLAUDE.md                       # Master AI entry point
```

---

## Quick Start

### For AI Agents
> Read `CLAUDE.md` first — always.

### For Humans
1. Read `CLAUDE.md` for session setup
2. Navigate `.enterprise/.specs/constitution/` for governing rules
3. Select an agent from the roster above
4. Activate by name: `NYX`, `VECTOR`, `CIPHER`, etc.

### Engineering Flow

```
NYX (discover) → VECTOR (plan) → CIPHER (architect) → PRISM (ux)
→ RAZOR (sprint prep) → GHOST (implement) → GLITCH (validate)
→ QUILL (document)
```

For solo/fast delivery: activate **BLITZ** directly.

---

## Governance Layers

| Layer | Location | Purpose |
|-------|----------|---------|
| Constitution | `.enterprise/.specs/constitution/` | Supreme law for all agents |
| Core Standards | `.enterprise/.specs/core/` | Org-wide invariants |
| Cross-Cutting | `.enterprise/.specs/cross/` | Security, observability, data |
| Stack Standards | `.enterprise/.specs/<Stack>/` | Language/framework specifics |
| ADRs | `.enterprise/.specs/decisions/` | Traceable architectural decisions |
| Agent Authority | `.enterprise/agents/<code>/` | Per-agent scope and limits |
| Skills | `.enterprise/governance/agent-skills/` | Tiered executable skills |

---

## Wave 1 Runtime Capabilities

Wave 1 consolidates HSEOS around five runtime capabilities with one coherent vocabulary:

| Capability | Purpose | Primary Surface |
|---|---|---|
| Integration Governance Bootstrap | Establishes controlled integration through `develop` | governance workflow |
| Structural Execution Governance | Enforces deterministic runtime boundaries before mutation | `hseos policy` |
| Mission Execution Runtime | Claims, isolates, and reconciles queued work items | `hseos run` |
| Execution Observability Surface | Aggregates runtime posture, evidence, and blockers | `hseos ops` |
| CORTEX Recall Intelligence | Encodes, retrieves, traces, and impacts context | `hseos cortex` |

These capabilities are intended to operate as one HSEOS system, not as separate products.

---

## License

MIT — Hideaki Solutions

---

*HSEOS is institutional software. Built for teams that take engineering seriously.*
