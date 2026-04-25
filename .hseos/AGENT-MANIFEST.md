---
type: agent-manifest
framework: hseos
version: "1.0"
---

# HSEOS Agent Manifest

> AI agents: read this file to discover all available agents and their entry points.
> Load the specific agent file only when activating that agent.

---

## Loading Protocol

1. Read this manifest to identify the correct agent for the current task
2. Load the agent YAML definition from `.hseos/agents/<code>.agent.yaml`
3. Load the agent authority from `.enterprise/agents/<code>/authority.md`
4. Load the agent constraints from `.enterprise/agents/<code>/constraints.md`
5. Execute the bootstrap sequence defined in the agent YAML

---

## Agent Registry

### NYX — Intelligence Broker
- **Code:** NYX
- **Domain:** Discovery
- **Definition:** `.hseos/agents/nyx.agent.yaml`
- **Authority:** `.enterprise/agents/nyx/authority.md`
- **Activate when:** requirements discovery, market research, domain analysis, product brief creation

### VECTOR — Mission Architect
- **Code:** VECTOR
- **Domain:** Planning
- **Definition:** `.hseos/agents/vector.agent.yaml`
- **Authority:** `.enterprise/agents/vector/authority.md`
- **Activate when:** PRD creation, scope definition, epics and stories, implementation readiness

### CIPHER — Systems Architect
- **Code:** CIPHER
- **Domain:** Solutioning
- **Definition:** `.hseos/agents/cipher.agent.yaml`
- **Authority:** `.enterprise/agents/cipher/authority.md`
- **Activate when:** architecture design, ADR drafting, system boundary definition, technical design

### GHOST — Code Executor
- **Code:** GHOST
- **Domain:** Execution
- **Definition:** `.hseos/agents/ghost.agent.yaml`
- **Authority:** `.enterprise/agents/ghost/authority.md`
- **Activate when:** story implementation, TDD, code review

### RAZOR — Sprint Commander
- **Code:** RAZOR
- **Domain:** Coordination
- **Definition:** `.hseos/agents/razor.agent.yaml`
- **Authority:** `.enterprise/agents/razor/authority.md`
- **Activate when:** sprint planning, story preparation, retrospectives, backlog management

### GLITCH — Chaos Engineer
- **Code:** GLITCH
- **Domain:** Validation
- **Definition:** `.hseos/agents/glitch.agent.yaml`
- **Authority:** `.enterprise/agents/glitch/authority.md`
- **Activate when:** test generation, risk-based testing, quality gate review, adversarial review

### PRISM — Interface Weaver
- **Code:** PRISM
- **Domain:** Experience
- **Definition:** `.hseos/agents/prism.agent.yaml`
- **Authority:** `.enterprise/agents/prism/authority.md`
- **Activate when:** UX design, accessibility audit, design system, interaction patterns

### BLITZ — Solo Protocol
- **Code:** BLITZ
- **Domain:** Autonomy
- **Definition:** `.hseos/agents/blitz.agent.yaml`
- **Authority:** `.enterprise/agents/blitz/authority.md`
- **Activate when:** solo development, proof-of-concept, compressed full-stack flow

### QUILL — Knowledge Scribe
- **Code:** QUILL
- **Domain:** Knowledge
- **Definition:** `.hseos/agents/quill.agent.yaml`
- **Authority:** `.enterprise/agents/quill/authority.md`
- **Activate when:** documentation, API docs, developer guides, knowledge capture

### ORBIT — Flow Conductor
- **Code:** ORBIT
- **Domain:** Orchestration
- **Definition:** `.hseos/agents/orbit.agent.yaml`
- **Authority:** `.enterprise/agents/orbit/authority.md`
- **Activate when:** end-to-end delivery orchestration, readiness validation, workflow resume, artifact gatekeeping

### FORGE — Release Engineer
- **Code:** FORGE
- **Domain:** DevOps
- **Definition:** `.hseos/agents/forge.agent.yaml`
- **Authority:** `.enterprise/agents/forge/authority.md`
- **Activate when:** artifact publication, CI-backed promotion, registry verification, release evidence capture

### KUBE — Kubernetes Delivery Operator
- **Code:** KUBE
- **Domain:** GitOps
- **Definition:** `.hseos/agents/kube.agent.yaml`
- **Authority:** `.enterprise/agents/kube/authority.md`
- **Activate when:** platform-gitops manifest update, image tag bump, PR creation, ArgoCD sync monitoring, deployment orchestration between FORGE and SABLE

### SABLE — Runtime Operator
- **Code:** SABLE
- **Domain:** Operations
- **Definition:** `.hseos/agents/sable.agent.yaml`
- **Authority:** `.enterprise/agents/sable/authority.md`
- **Activate when:** rollout verification, pod health checks, runtime smoke tests, operational readiness after KUBE deployment

### SWARM — Parallel Execution Commander
- **Code:** SWARM
- **Domain:** Parallel Orchestration
- **Definition:** `.hseos/agents/swarm.agent.yaml`
- **Authority:** `.enterprise/agents/swarm/authority.md`
- **Activate when:** heterogeneous batch of tasks, parallelizable decomposition, token-cost optimization via model tiering (Opus plan → Sonnet/Haiku execute), independent fixes across one or more repos, need for worktree-isolated parallel execution under a single Commander

---

## Standard Flow

```
NYX → VECTOR → PRISM → CIPHER → RAZOR → GHOST → GLITCH → QUILL
```

## Solo Fast Flow

```
BLITZ (end-to-end)
```

## Epic Delivery Flow

```
ORBIT → NYX → VECTOR → PRISM → CIPHER → RAZOR → GHOST → GLITCH → FORGE → KUBE → SABLE → QUILL
```

## Parallel Batch Flow

```
SWARM (plans in Opus) → [GHOST-equivalent × N in parallel worktrees with Sonnets/Haikus] → SWARM (debrief)
```

- **Commander:** SWARM (Opus 4.7 — planning, dispatch, handoff extraction, consolidation)
- **Workers:** N general-purpose subagents in isolated worktrees (`.worktrees/T{n}/`) on model tier per task (matrix in `dev-squad` skill)
- **Governance:** `worktree-manager.sh` + `validate-commit-msg.sh` + `check-branch.sh` mandatory; 1 task = 1 commit; 1 wave = 1 PR; human reviewer only for merge
- **When to use:** heterogeneous batch of 3+ tasks with real parallelizable decomposition; complements ORBIT (sequential delivery) and BLITZ (solo compressed flow)

---

**End of Manifest**
