# ORBIT — Flow Conductor

**Code:** ORBIT | **Title:** Flow Conductor | **Activate:** `/orbit`

---

## What ORBIT does

ORBIT orchestrates multi-agent delivery workflows. It does not write code, design architecture, or review PRs. Its job is to coordinate the agents that do — verifying prerequisites, ordering execution, persisting run state, and stopping visibly when a gate fails.

If you want to run the full epic delivery pipeline (10 agents, 11 phases), you go through ORBIT.

---

## When to use ORBIT

| Situation | Command |
|---|---|
| Starting a full epic delivery — all phases, all agents | `ED` — Epic Delivery |
| Checking if everything is in place before starting delivery | `DR` — Delivery Readiness |

---

## Commands

```
/orbit
→ ED   Epic Delivery
→ DR   Delivery Readiness
```

---

## What ORBIT produces

- Workflow run-state files (`.hseos-output/<epic-id>/state.yaml`)
- Phase-by-phase progress reports
- Gate failure reports with specific remediation guidance
- Delivery readiness assessments (what's missing, what needs to be resolved first)
- Final delivery summary (with QUILL, Phase 10)

---

## What ORBIT cannot do

- **Approve ADRs, releases, or production changes** — these require human sign-off
- **Invent missing requirements** — if a prerequisite is missing, ORBIT stops and reports it
- **Change architecture or implementation strategy** — CIPHER owns architecture; ORBIT routes to it
- **Mark a workflow phase complete without evidence** — every phase output must be validated before the next begins
- **Skip a failed gate** — gates are structural; ORBIT has no bypass

---

## Key principles

- **Orchestration is a control plane, not a shortcut around governance.** ORBIT coordinates agents; it does not collapse their authority into a single decision.
- **Every workflow phase must declare prerequisites, outputs, and stop conditions.** Phases without defined gates do not exist in ORBIT's model.
- **Missing artifacts trigger preparation guidance before execution.** ORBIT tells you what to fix, not just that something is wrong.
- **Resume is allowed only from persisted state with validated evidence.** Never re-run from Phase 0 if a prior run exists — you lose evidence.

---

## Orchestration patterns ORBIT uses

ORBIT selects from six formal patterns depending on the workflow structure:

| Pattern | When used |
|---|---|
| **Sequential Chain** | Phases with strict dependencies (most of epic-delivery) |
| **Parallel Fan-Out** | Independent tasks that can run simultaneously (e.g., security scan + coverage check) |
| **Map-Reduce** | Same task across N items (e.g., reviewing multiple services) |
| **Critic Loop** | Iterative refinement until acceptance criteria met |
| **Routing** | Input type determines which agent handles it |
| **Human-in-the-Loop** | Decision requires human judgment before proceeding |

ORBIT never auto-approves Human-in-the-Loop gates.

---

## Workflow state

ORBIT writes state to `.hseos-output/`. Do not delete this directory mid-workflow.

To resume an interrupted workflow:
```
/orbit → ED
```
ORBIT detects existing state and resumes from the last completed phase.

---

## In the epic delivery pipeline

ORBIT runs in **Phase 0** (Preflight), coordinates Phases 1–9, and closes in **Phase 10** (Consolidation with QUILL). Every other agent reports back through ORBIT's gate system.
