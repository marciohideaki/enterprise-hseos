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
| `ORBIT` | Flow Conductor | Multi-agent Delivery Orchestration | Orchestration |
| `FORGE` | Release Engineer | DevOps, CI Artifact Promotion & Publication | DevOps |
| `KUBE` | Kubernetes Delivery Operator | GitOps Manifest Update, PR & ArgoCD Sync | GitOps |
| `SABLE` | Runtime Operator | Rollout Verification & Runtime Smoke | Operations |

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

### Orchestrated Epic Delivery

```
ORBIT (preflight + readiness)
→ NYX / VECTOR / PRISM / CIPHER / RAZOR / GHOST / GLITCH
→ FORGE (build + push image to registry)
→ KUBE (update platform-gitops manifests + PR + ArgoCD sync)
→ SABLE (rollout health + pod verification + smoke)
→ QUILL (evidence)
```

Use `hseos workflow list` to inspect registered workflows and
`hseos workflow validate <workflow-id> --repo <path> --profile <core|release|runtime|full>`
to detect missing predecessor steps, artifacts, and tooling before execution.
Then use `hseos workflow init`, `status`, and `advance` to persist the active phase, responsible agent, and execution evidence.
For epic execution, use `story-status`, `story-commit`, and `gate` to keep the HSEOS run-state aligned with BMAD story progress and quality gates.
If work began outside HSEOS, use `sync` or `resume` to reconstruct the active handoff from BMAD planning and sprint artifacts.
For long-running execution after preparation, use `batch` to generate phase packets and logs for the remaining phases.

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

## License

MIT — Hideaki Solutions

---

*HSEOS is institutional software. Built for teams that take engineering seriously.*
