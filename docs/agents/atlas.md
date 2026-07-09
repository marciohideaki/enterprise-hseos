# ATLAS — ADO Lifecycle Orchestrator

**Code:** ATLAS | **Title:** ADO Tracking and Lifecycle Automation System | **Activate:** `/atlas`

> ⚠️ **Feature-flagged.** ATLAS only operates when `ado.enabled: true` is set in
> `.hseos/config/hseos.config.yaml` (plus an `ADO_PAT` in the environment). When the flag
> is off, ATLAS and every ADO hook exit silently (`exit 0`) — zero friction for
> non-ADO projects. See ADR-0011.

---

## What ATLAS does

ATLAS is the axis between `PLAN.md` and the Azure DevOps board. It keeps the **ADO-first
invariant**: every task starts with an ADO Task ID, every commit maps to an ADO Task,
every PR links to an ADO Story. It orchestrates the work-item lifecycle
(Epic/Feature/Story/Task) from plan through sync to close — and never executes code
itself; implementation is always delegated to ORBIT/SWARM.

---

## When to use ATLAS

| Situation | Command |
|---|---|
| A dev-squad `PLAN.md` was approved and needs ADO work items (gate G1-ADO) | `PLAN` |
| A dev-squad run finished and the board must reflect reality | `SYNC` |
| A wave is done: close Tasks + Stories + Feature, tag the repo | `CLOSE` |
| A repository needs full ADO bootstrap (project, iterations, pipeline) | `SETUP` |

---

## Commands

```
/atlas
→ PLAN   G1-ADO gate: create Epic/Feature/Stories/Tasks from the approved PLAN.md
→ SYNC   Synchronize post-run dev-squad state to the ADO board
→ CLOSE  Close a wave: ADO items + git tag + MASTER-PLAN update
→ SETUP  Bootstrap a complete ADO project (iteration paths, pipeline)
```

---

## What ATLAS produces

- ADO work-item tree (Epic → Feature → Stories → Tasks) mirroring the approved `PLAN.md`
- Wave ↔ ADO mapping tables (its preferred reporting format, always citing ADO IDs)
- PR ↔ Story links and commit ↔ Task progress updates
- Wave closure evidence: closed items + git tag + MASTER-PLAN entry

---

## What ATLAS cannot do

- **Execute or modify code** — implementation belongs to ORBIT/SWARM/GHOST
- **Create work items with `State=Closed`** — always create as `New`, close in a separate update
- **Migrate a repository without asking** — `ado-new-project` step 4 always requires an explicit human answer
- **Block execution on ADO REST failures** — API failures are silent/advisory; delivery never waits on the board
- **Operate with `ado.enabled: false`** — every entry point exits 0 silently

---

## Key principles

- **ADO-first:** no task starts without a registered ADO Task ID.
- **1 ADO Task = 1 worktree = 1 commit** — same granularity the SWARM protocol enforces.
- **Idempotency via WIQL:** query before create; never duplicate work items.
- **Hooks are advisory;** the only hard block is the G1-ADO preflight gate.

---

## Integration surface

- Agent definition: `.hseos/agents/atlas.agent.yaml` (tool policy `read-mostly`, MCP `azure-devops` tools)
- Workflow: `.hseos/workflows/ado-ops/workflow.md` (`#g1-plan`, `#sync`, `#close-wave`, `#new-project`)
- Skills: `ado-plan`, `ado-ops`, `ado-sync`, `ado-close-wave`, `ado-new-project`
- Hooks: `ado-branch-guard`, `ado-preflight-gate`, `ado-task-progress`, `ado-pr-link`, `ado-tag-close`, `ado-inbox-check`
- Authority: `.enterprise/agents/atlas/authority.md` + `constraints.md`
