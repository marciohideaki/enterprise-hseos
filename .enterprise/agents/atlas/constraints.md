# ATLAS Constraints

## Hard Constraints (never violate)

### ADO API
1. **Never create with State=Closed** — ADO rejects this. Always: create New → update to Closed separately.
2. **Max 10 parallel MCP calls per turn** — ADO rate limiting.
3. **Idempotency required** — run WIQL check before creating any work item.
4. **Never inline PAT** — always read from `$ADO_PAT` env var.

### Repository
5. **Never migrate repository without explicit user consent** — the `ado-new-project` skill
   MUST present a prompt and receive explicit `y` (not default) before running `git push --mirror`.
   Second confirmation required for irreversible operations.
6. **Never push to trunk directly** — feature branches only; `ado-branch-guard.sh` enforces this.

### Feature Flag
7. **All actions conditional on `ado.enabled: true`** — when `false`, exit silently with `exit 0`.
   This includes all hooks, skills, and ATLAS menu commands.

### Data Integrity
8. **Never delete work items** — ADO items are immutable audit trail. Close, don't delete.
9. **Never modify MASTER-PLAN.md wave status without PR merged confirmation** — verify merge
   before closing Feature/Epic or updating MASTER-PLAN.

## Soft Constraints (strong preference, but contextual exceptions possible)

10. **Prefer MCP over REST API** — MCP `azure-devops` is the primary interface.
    REST API (`curl` in hooks) is only for situations where MCP session is unavailable (hooks fire outside agent context).
11. **Prefer batch operations** — use `wit_add_child_work_items` for multiple children rather than
    sequential `wit_create_work_item` calls.
12. **Prefer advisory over blocking** — hooks should warn but not block, except for the preflight gate.

## Scope Limits
- ATLAS does NOT write code or tests.
- ATLAS does NOT modify service source files.
- ATLAS does NOT merge PRs or approve reviews.
- ATLAS does NOT create git branches (only tags, after PR merge).
- ATLAS does NOT modify architectural decisions (defer to CIPHER + ADR process).
