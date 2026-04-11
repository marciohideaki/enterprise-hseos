---
name: multi-agent-orchestration
tier: quick
version: "1.0"
---

# Multi-Agent Orchestration — Quick Reference

> Tier 1: use when ORBIT is coordinating multiple agents or deciding which orchestration pattern to apply.
> Load SKILL.md (Tier 2) for full pattern definitions, decision criteria, and anti-patterns.

---

## Pattern Selection Matrix

| Pattern | When to use | ORBIT role |
|---|---|---|
| **Sequential Chain** | Steps have strict dependencies (A must finish before B) | Executes phases in order; stops on gate failure |
| **Parallel Fan-Out** | Steps are independent and can run concurrently | Dispatches all agents simultaneously; collects results |
| **Map-Reduce** | Same task applied to N items; results aggregated | Maps work across agents; reduces to single artifact |
| **Critic Loop** | Output quality is uncertain; needs iterative refinement | Alternates Generator↔Critic until acceptance criteria met |
| **Routing** | Input type determines which specialist handles it | Classifies input; dispatches to correct agent |
| **Human-in-the-Loop** | Decision or validation requires human judgment | Pauses workflow; surfaces structured request; resumes on approval |

---

## Quick Decision Tree

```
Is the workflow a single continuous flow?
  YES → Sequential Chain
  NO →
    Are steps independent?
      YES → Parallel Fan-Out (or Map-Reduce if same task over N items)
      NO →
        Does quality need iteration?
          YES → Critic Loop
          NO →
            Does input type vary?
              YES → Routing
              NO → Sequential Chain with conditional branching
```

---

## Gate Conditions (always define before starting)

Every orchestrated workflow MUST declare:
- **Prerequisites**: what must exist before Phase 1
- **Phase outputs**: what artifact each phase produces
- **Stop condition**: what causes ORBIT to halt and report

Never advance to the next phase if outputs of the current phase are missing or invalid.

---

## Inter-Agent Communication Options

| Method | Use case | Tooling |
|---|---|---|
| Sequential hand-off | Agent A finishes, passes artifact to Agent B | Context passing in workflow state |
| Parallel + collect | All agents work simultaneously; ORBIT collects | Parallel dispatch + results aggregation |
| Real-time cross-session | Live coordination between active agent sessions | `claude-peers` MCP (if available) |

---

## ORBIT Constraints Reminder

- ORBIT coordinates authority — it does not absorb it
- Scope changes require returning to FORGE/RAZOR/responsible agent
- Resume only from persisted state with validated evidence
- Gate failures are final until artifact is produced — ORBIT does not bypass them
