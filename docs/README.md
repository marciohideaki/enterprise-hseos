# HSEOS Documentation

> Engineering documentation for humans working with the HSEOS framework.
> If you are an AI agent, start from `CLAUDE.md` and `AGENTS.md` in the repository root — not here.

---

## What is HSEOS?

HSEOS (Hideaki Software Engineering Operating System) is a governance framework for AI-assisted software delivery. It wraps a team of 13 specialized AI agents around your engineering workflow, each with a defined role, explicit authority boundaries, and skill-based decision rules.

The goal: AI agents multiply engineering capacity without degrading quality, security, or architectural discipline.

---

## Navigation

| Document | What you'll find |
|---|---|
| [getting-started.md](getting-started.md) | Day 1 setup — install CLI, configure project, first commands |
| [agents/](agents/) | Every agent: what it does, when to activate it, what it cannot do |
| [workflows.md](workflows.md) | The 5 delivery workflows — phases, human touchpoints, how to resume |
| [skills.md](skills.md) | Governance skills catalog — what gets enforced, when, and why |

---

## The 13 Agents at a Glance

| Code | Title | Domain |
|---|---|---|
| **NYX** | Intelligence Broker | Research, requirements elicitation, domain analysis |
| **VECTOR** | Mission Architect | PRDs, epics, stories, product scope |
| **CIPHER** | Systems Architect | Architecture, system design, ADRs |
| **PRISM** | Interface Weaver | UX design, interaction flows, design systems |
| **RAZOR** | Sprint Commander | Sprint planning, story preparation, backlog |
| **GHOST** | Code Executor | Implementation, TDD, story execution |
| **GLITCH** | Chaos Engineer | Test automation, quality gates, coverage |
| **BLITZ** | Solo Protocol | Full-stack solo delivery at speed |
| **QUILL** | Knowledge Scribe | Technical documentation, API docs, guides |
| **ORBIT** | Flow Conductor | Multi-agent workflow orchestration |
| **FORGE** | Release Engineer | Artifact publication, CI/CD, build promotion |
| **KUBE** | Kubernetes Delivery Operator | GitOps manifest updates, ArgoCD sync |
| **SABLE** | Runtime Operator | Rollout verification, pod health, smoke tests |

---

## The Seven Laws

These are non-negotiable across every agent, workflow, and skill:

1. **Specs are sovereign** — `.specs/` is the source of truth. Agents that contradict specs are wrong.
2. **Ambiguity triggers a stop** — agents never guess scope, architecture, or requirements.
3. **ADRs are mandatory** — every significant architectural decision requires a documented record.
4. **Authority is explicit** — each agent's scope is defined in `.enterprise/agents/<code>/authority.md`.
5. **GitHub is truth** — no local state that isn't committed counts as evidence.
6. **Enforcement is structural** — quality gates are automated, not advisory.
7. **Humans decide** — agents produce options and evidence; final calls belong to the engineering team.

---

## How Agents are Activated

Every agent is a Claude Code subagent command. In your project, after `hseos install`:

```bash
# Claude Code command palette or slash commands:
/nyx       # Intelligence Broker
/vector    # Mission Architect
/kube      # Kubernetes Delivery Operator
# ... etc
```

Or start the orchestrated epic delivery pipeline:
```bash
/orbit
# Then type: ED    (Epic Delivery)
# Or type:   DR    (Delivery Readiness check)
```
