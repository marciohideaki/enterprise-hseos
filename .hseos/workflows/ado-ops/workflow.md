# ADO-Ops Workflow

## Intent
Orchestrate the complete ADO-first lifecycle for HSEOS projects:
plan → track → close. Ensures every wave has ADO traceability from
Epic down to individual Task (worktree agent).

## Owner
ATLAS

## Feature Flag
This workflow is only active when `ado.enabled: true` in
`.hseos/config/hseos.config.yaml`. When disabled, all phases exit silently.

---

## Phase: Preflight {#preflight}

### Entry Conditions
- `.hseos/config/hseos.config.yaml` exists
- `ADO_PAT` present in environment
- MCP server `azure-devops` reachable (or `az devops` CLI available)

### Actions
1. Read `ado.enabled` from config — if false, exit with advisory message
2. Verify `ADO_PAT` is set: `[[ -n "$ADO_PAT" ]]`
3. Ping ADO: `az devops project list --org "https://dev.azure.com/{org}" --query "[0].name" -o tsv 2>/dev/null`
4. Run `scripts/ado-doctor.sh` for full health check

### Outputs
- Preflight OK report
- Advisory if any check fails (non-blocking)

---

## Phase: G1-ADO Gate {#g1-plan}

### Entry Conditions
- PLAN.md approved by human (G2 gate passed)
- Preflight passed

### Actions
Load skill: `.enterprise/governance/agent-skills/ado-plan/SKILL.md`

Execute the 6-step ado-plan protocol:
1. Parse PLAN.md for wave/task structure
2. WIQL idempotency check per item
3. Create Epic (if new)
4. Create Feature (wave group)
5. Create Stories + Tasks (per wave, batch of ≤10)
6. Annotate PLAN.md with `<!-- ado-mapping: ... -->` and save `ado-mapping.json`

### Gate: G1-ADO Complete
Only proceed to execution after this phase produces `ado-mapping.json`.
Hook `ado-preflight-gate.sh` enforces this at dispatch time.

### Outputs
- `<!-- ado-mapping: ... -->` in PLAN.md
- `.hseos/runs/ado-ops/{timestamp}/ado-mapping.json`
- Console output: list of created ADO IDs

---

## Phase: Execute {#execute}

### Entry Conditions
- G1-ADO phase complete (`ado-mapping.json` exists)
- G2 human approval obtained
- Feature branch created: `feature/{epic-slug}-wave-{NNN}-{title}`

### Actions
Delegate to `dev-squad` workflow passing ADO Task IDs:
- Each ADO Task → 1 squad agent worktree
- Branch per task: `ado-{TASK_ADO_ID}-{slug}`
- Hook `ado-task-progress.sh` auto-updates Task state on commit
- Commander tracks via STATUS.md + ado-mapping.json

### Delegation
```
SWARM executes dev-squad with:
  tasks[].ado_task_id = <id from ado-mapping.json>
  tasks[].branch = "ado-{id}-{slug}"
```

---

## Phase: PR Link {#pr-link}

### Entry Conditions
- Wave execution complete (all tasks in STATUS.md = success)
- `/atlas sync` run and Tasks are Closed in ADO

### Actions
1. Run `/atlas sync` to close all Tasks in ADO
2. Open PR via `gh pr create` (human action or agent-assisted)
3. Hook `ado-pr-link.sh` auto-links PR to Story
4. PR body includes Story ADO ID and wave summary

### PR Body Template
```markdown
## Wave W{NNN} — {title}

ADO Story: #{story_id}
ADO Feature: #{feature_id}

### Changes
{wave summary}

### ADO Traceability
| Task | ADO ID | Status |
|------|--------|--------|
| [IMPL] ... | #{task_id} | Closed |
| [TEST] ... | #{task_id} | Closed |
```

---

## Phase: Sync {#sync}

### Entry Conditions
- `ado-mapping.json` exists
- dev-squad STATUS.md updated

### Actions
Load skill: `.enterprise/governance/agent-skills/ado-sync/SKILL.md`

1. Read STATUS.md for task completion states
2. Batch update Task states in ADO (max 10/turn)
3. Auto-close Stories when all Tasks closed
4. Save `sync-result.json`

---

## Phase: Close Wave {#close-wave}

### Entry Conditions
- PR merged (verified via `gh pr view --json state`)
- CI green on merged commit
- All Tasks and Stories closed in ADO

### Actions
Load skill: `.enterprise/governance/agent-skills/ado-close-wave/SKILL.md`

1. Verify PR merged
2. Verify all Stories closed (WIQL query)
3. Close Feature in ADO
4. Check Epic: close if all Features closed
5. Create git tag: `wave-w{NNN}-closed` or `v{X.Y.Z}`
6. Update MASTER-PLAN.md: mark wave 🟢 Done + tag
7. Comment on Epic with tag link

### Trigger for ado-tag-close.sh
Hook fires on `git push --tags` → emits event to `.hseos/runs/ado-ops/inbox/`
→ ATLAS processes inbox on next `/atlas close` invocation.

---

## Phase: New Project {#new-project}

### Entry Conditions
- `ado.enabled: false` (bootstrap scenario)
- User invoked `/atlas setup`
- `ADO_PAT` available

### Actions
Load skill: `.enterprise/governance/agent-skills/ado-new-project/SKILL.md`

Execute the 5-step interactive bootstrap:
1. Pré-flight (CLI/MCP availability, PAT validation)
2. Create ADO org/project (interactive prompt)
3. Create Iteration Paths (Phase N structure)
4. Repo migration prompt (EXPLICIT — never assume y)
5. Pipeline creation (auto-detect stack → template)

### Output
`.hseos/config/hseos.config.yaml` updated with:
- `ado.enabled: true`
- `ado.org`, `ado.project`, `ado.project_id`
- `ado.repo_url`, `ado.pipeline_id`

---

## Gates

| Gate | Phase | Description |
|------|-------|-------------|
| G-preflight | Preflight | ADO health OK |
| G1-ADO | G1-ADO | All items created, ado-mapping.json exists |
| G2 | Execute | Human approved PLAN.md (inherited from dev-squad) |
| G3-PR | PR Link | PR merged + CI green |
| G4-close | Close Wave | Feature/Epic closed, tag created |

---

## Invariants

1. `ado.enabled: false` → all phases exit silently (exit 0)
2. State=Closed NEVER on creation — always New → update separately
3. Max 10 MCP calls per turn
4. WIQL idempotency check before any item creation
5. Repo migration: ALWAYS explicit user prompt, NEVER silent
6. Hooks are advisory except G1-ADO preflight (which warns but doesn't block by default)
