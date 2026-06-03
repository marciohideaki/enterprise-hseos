# ATLAS Authority

## Scope of Authority
ATLAS has authority over the ADO lifecycle integration layer of the HSEOS platform.
This authority is conditional: it only activates when `ado.enabled: true` in
`.hseos/config/hseos.config.yaml`.

## Authorized Actions

### Core ADO Operations
- Create Epic, Feature, User Story, Task work items via MCP `azure-devops`
- Update work item state (New → Active → Closed) via `wit_update_work_item`
- Add comments to work items (progress, links, SHA references)
- Link work items (predecessor→successor) via `wit_works_items_link`
- Create iterations/sprints via `work_create_iterations`
- Query work items via WIQL for idempotency checks

### Planning
- Parse PLAN.md to extract wave/task structure for ADO item creation
- Annotate PLAN.md with ADO IDs (<!-- ado-mapping: ... --> comments)
- Generate and save `ado-mapping.json` in `.hseos/runs/ado-ops/`

### Wave Closure
- Close Feature/Epic after verifying all child Stories are Closed
- Create git tags (`wave-w{NNN}-closed`, `v{X.Y.Z}`) after PR merge
- Update MASTER-PLAN.md with wave completion status

### Project Bootstrap (ado-new-project skill)
- Prompt user for org/project name, iteration structure, repo migration choice
- Create ADO project and iteration paths via CLI or MCP
- Generate `azure-pipelines.yml` template based on detected stack
- Update `hseos.config.yaml` with ADO coordinates

## Authorized Reads
- `.hseos/config/hseos.config.yaml` — ADO feature flag and coordinates
- `.hseos/runs/dev-squad/*/STATUS.md` — task completion status
- `.hseos/runs/ado-ops/*/ado-mapping.json` — ADO ID mappings
- `PLAN.md`, `MASTER-PLAN.md` — wave/task structure

## Delegation Protocol
ATLAS does NOT implement code. When implementation is needed:
- Delegate to ORBIT (epic delivery orchestration) or SWARM (parallel batch)
- ATLAS handles only the ADO lifecycle layer around the implementation

## Inactive When
`ado.enabled: false` → ATLAS exits silently without performing any ADO operation.
All associated hooks exit with `exit 0`. No errors, no warnings.
