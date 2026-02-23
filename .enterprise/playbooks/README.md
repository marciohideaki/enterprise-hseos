# Playbooks

> **For human contributors.** AI agents load specific playbooks referenced by name in governance policies — not this README.

---

## What This Directory Is

Playbooks are **step-by-step operational guides** for recurring governance activities. Unlike policies (which define rules), playbooks define *how to execute* within those rules — the practical "how to" for engineers and agents.

---

## Documents in This Directory

| Playbook | Audience | Purpose |
|---|---|---|
| `agent-onboarding.md` | AI Agents | How a new agent context loads and validates itself before starting work |
| `conceptual-lint.md` | AI Agents + Humans | How to detect and fix conceptual-level issues in specs and code |
| `developer-onboarding.md` | Human Engineers | Complete onboarding guide for the enterprise overlay and governance model |
| `enterprise-flow.md` | AI Agents + Humans | End-to-end flow from task inception to merge — governance checkpoints |
| `escalation-rules.md` | AI Agents | When and how to stop execution and escalate to humans |
| `git-workflow.md` | AI Agents + Humans | Branching, commit, and PR workflow with governance compliance |
| `repository-vitrine-checklist.md` | Human Engineers | Checklist for presenting a repository as governance-compliant |
| `repository-curation-replay.md` | AI Agents | How to replay and audit a repository against governance standards |

---

## Key Playbooks at a Glance

### `developer-onboarding.md`
The human entry point for understanding the enterprise overlay. Covers:
- Repository structure and navigation
- How governance standards work together
- Reading order for specs
- How to create ADRs
- How to use agent skills
- Compliance scorecard and remediation process

### `agent-onboarding.md`
The agent equivalent of developer onboarding — loaded before any task execution:
- Constitution loading sequence
- Core standards pre-flight
- Stack identification
- Skill registry loading
- Go/No-go decision before execution begins

### `escalation-rules.md`
Critical for agent safety. Defines conditions under which agents MUST STOP and escalate:
- Standards conflict detected
- Missing required ADR
- Security concern without approved exception
- Ambiguous requirements that could affect architecture

### `git-workflow.md`
Covers the commit hygiene protocol:
- Branch naming conventions
- Commit message format (no AI/tool attribution)
- PR title and description requirements
- When the commit-hygiene skill must be loaded

---

## Playbook vs. Policy vs. Standard

| Document Type | Answers | Example |
|---|---|---|
| **Standard** | What must be true | "All services MUST have structured logging" |
| **Policy** | When/how to enforce | "Observability is checked at PR merge gate" |
| **Playbook** | How to execute step-by-step | "Step 1: Verify log format. Step 2: Check metric names..." |
