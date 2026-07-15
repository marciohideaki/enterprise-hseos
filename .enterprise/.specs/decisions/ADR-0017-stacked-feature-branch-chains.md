# ADR-0017 - Stacked Feature Branch Chains

**Status:** Accepted
**Date:** 2026-06-05
**Authors:** Platform Governance
**Approved by:** Marcio Hideaki (explicit implementation request, 2026-06-05)
**Affects Standards:** `AGENTS.md` execution governance, `.enterprise/governance/execution-governance.md`, `dev-squad` workflow and skill, SWARM constraints
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

HSEOS already requires isolated `feature/*` branches for execution phases and short-lived `task/*`
branches for individual tasks. The dev-squad protocol also requires `1 task = 1 commit` and
`1 wave = 1 PR`.

Some initiatives are naturally sequential while still benefiting from isolated review. A later wave
may depend on an unmerged foundation branch, making a direct PR to `master` misleading or impossible
without mixing unrelated work. Previous runs used stacked branches in practice, but the governance
standard did not define when that was allowed or how it should be merged.

---

## Decision

We will allow stacked `feature/*` branch chains when a later phase or wave has a real dependency on
an earlier unmerged phase or wave.

Each link in the chain remains a normal governed `feature/*` branch. All implementation work must
still enter through `task/*` worktrees, pass validation before commit, and preserve `1 task = 1
commit`. Pull requests in the chain target the immediate upstream branch until that upstream branch
merges. The chain must merge in order from base to tip; after each upstream merge, downstream PRs
must be retargeted or updated before they are merged.

`task/*` branches are never stacked directly. A task branch belongs to exactly one `feature/*` branch.

---

## Consequences

### Positive

- Enables small, reviewable PRs for dependent waves without collapsing work into one large branch.
- Preserves HSEOS isolation rules while supporting real sequencing.
- Makes branch dependency order explicit in plans, status files, and PR bodies.

### Negative / Trade-offs

- Downstream PRs require retargeting or update after upstream merges.
- Reviewers must understand base branch context when reviewing a non-root PR.
- CI may run multiple times as the chain advances.

### Risks

- **Risk:** A chain is used to hide unrelated work. **Mitigation:** every link must declare its
  upstream base and downstream dependents; each task still has its own commit and worktree.
- **Risk:** Downstream branches diverge after an upstream merge. **Mitigation:** downstream PRs must
  be retargeted or updated before merge.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| `AGENTS.md` | Execution Governance / Task Isolation / Pull Request Policy | Adds stacked `feature/*` branch chain rules |
| `.enterprise/governance/execution-governance.md` | Execution Model / Pull Request Policy | Defines allowed branch chain structure and merge order |
| `.hseos/workflows/dev-squad/workflow.md` | Required Inputs / Governance Invariants | Requires SWARM to declare stacked branch plans when used |
| `.enterprise/governance/agent-skills/dev-squad/` | Governance invariants | Adds branch-chain constraints to the canonical dev-squad protocol |
| `.enterprise/agents/swarm/constraints.md` | SWARM constraints | Requires `PLAN.md` declaration for any chain |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Affected standards updated to reference this ADR
- [x] Teams notified through committed governance artifacts
- [x] Activation date: 2026-06-05
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Forbid stacked branches entirely | Forces either oversized PRs or blocked dependent work even when governance can preserve isolation |
| Allow any `feature/*` branch to target any base | Too loose; hides dependency order and complicates cleanup |
| Stack `task/*` branches directly | Violates the task isolation lifecycle and makes cleanup unsafe |
