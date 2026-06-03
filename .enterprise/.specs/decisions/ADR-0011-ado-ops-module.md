# ADR-0011 — ADO-Ops Module: Azure DevOps Integration for HSEOS

**Status:** Accepted
**Date:** 2026-05-28
**Authors:** ATLAS (HSEOS ADO Agent)
**Supersedes:** None
**Superseded by:** None

---

## Context

HSEOS projects have been managing Azure DevOps work items retroactively and manually.
After wave execution, work items were created in batch upon user request, with no
traceability during development. The SWARM/dev-squad protocol dispatches squad agents
without prior ADO task registration, making it impossible to track granular progress
in real time.

Additionally, the existing ADO skill (`~/.claude/skills/ado/SKILL.md`) was:
- Scoped to a single project (`runtime-one`) with hardcoded coordinates
- Outside the HSEOS standalone architecture (violates ADR-0006 P1)
- Not integrated with dev-squad granularity (Epic/Feature only, no Story/Task)
- Without automation hooks for branch protection, PR linking, or tag closure

The ADO-first pattern requires that every work item exists **before** execution begins,
enabling real-time traceability from planning through delivery.

---

## Decision

Create a standalone, feature-flagged ADO integration module (`ado-ops`) within HSEOS.

**Core design decisions:**

### 1. Feature-flag gating via `ado.enabled`
All module components (skills, hooks, agent) check `ado.enabled` in
`.hseos/config/hseos.config.yaml` before any operation. When `false`, all components
exit silently with `exit 0`. This ensures zero impact on projects that don't use ADO.

### 2. ADO-first invariant
Work items MUST be created before execution. The G1-ADO gate (`ado-plan` skill) creates
the full Epic → Feature → Story → Task hierarchy from the approved PLAN.md. The
`ado-preflight-gate.sh` hook warns when dev-squad dispatch attempts to run without
ADO mapping.

### 3. SWARM granularity alignment
ADO hierarchy maps 1:1 to HSEOS execution units:
- ADO Epic = Phase/cluster multi-wave (strategic)
- ADO Feature = Wave group/Sprint (tactical)
- ADO Story = Wave (1 dev-squad run)
- ADO Task = 1 squad agent worktree (≤4 files, ≤1000 LOC, ≤60% Sonnet context)

This ensures each ADO Task can be executed independently by a squad agent within
safe context boundaries.

### 4. Idempotent operations
All item creation goes through a WIQL idempotency check first. Running `/atlas plan`
twice does not create duplicate items.

### 5. REST API for hooks, MCP for skills
Hooks fire outside the Claude session context and cannot use MCP tools. They use
`curl` + REST API for lightweight operations (comments, state transitions). Skills
and the ATLAS agent use the full MCP `azure-devops` server for complex operations.

### 6. Dedicated agent ATLAS
A new agent (ATLAS — ADO Tracking and Lifecycle Automation System) owns the ADO
lifecycle. ATLAS does not implement code; it delegates implementation to SWARM/ORBIT.
ATLAS is the single point of contact for ADO operations in HSEOS.

### 7. Global installation with confirmation
The `scripts/ado-install.sh` script installs ADO hooks globally (`~/.claude/mcp.json`
and `~/.claude/settings.json`) after explicit user confirmation. Per-project activation
is via `ado.enabled: true` in `hseos.config.yaml`.

---

## Consequences

### Positive
- Full ADO traceability from planning to delivery
- Real-time task progress visible in ADO boards during dev-squad execution
- Branch protection enforced by `ado-branch-guard.sh` (no direct trunk pushes)
- PRs automatically linked to ADO Stories
- Tags automatically trigger Feature/Epic closure via inbox pattern
- Portable to any HSEOS project (no hardcoded coordinates)
- Zero impact when disabled (`ado.enabled: false`)

### Negative
- `ADO_PAT` must be managed in `pass` and exported before ADO operations
- Hook REST calls add ~100ms overhead per git commit (negligible, non-blocking)
- WIQL idempotency check adds 1 MCP call per item before creation
- `azure-devops` MCP server must be installed: `npx @azure-devops/mcp-server`

### Neutral
- Existing `~/.claude/skills/ado/SKILL.md` deprecated and removed (superseded by this module)
- Projects must run `/atlas setup` once to configure ADO coordinates
- `ado-mapping.json` adds a new artifact to `.hseos/runs/ado-ops/` per wave

---

## Alternatives Considered

### A. Continue with global skill only
Keep `~/.claude/skills/ado/SKILL.md` and use it manually.
**Rejected:** violates ADR-0006 P1 (standalone), hardcoded to one project, no automation.

### B. ADO as a plugin (`.agents/plugins/`)
Package as a marketplace plugin instead of a core module.
**Rejected:** plugins are for optional UI/workflow extensions; ADO lifecycle is a
first-class HSEOS capability equivalent to dev-squad or gitops-deploy.

### C. External CI-only integration (webhooks)
Integrate ADO via webhooks from GitHub Actions, without in-session hooks.
**Rejected:** provides traceability only after PR merge, not during development.
Does not address the ADO-first invariant.

---

## Implementation

Implemented in `feature/hseos-ado-ops-module` (4 waves):
- Wave 1: 5 skills + helper lib + config section
- Wave 2: ATLAS agent + 6 hooks + registries
- Wave 3: Manifest + compiled outputs
- Wave 4: Installer + tests + docs

Files: see `.agents/manifest.yaml` entries for `ado-ops`, `ado-plan`, `ado-sync`,
`ado-close-wave`, `ado-new-project`.

---

## References
- ADR-0006: Standalone Architecture (P1: zero global path dependencies)
- ADR-0007: Compiler v2 Multi-Adapter Contract
- ADR-0008: MCP Project-Local Bundle Policy
- `.hseos/agents/atlas.agent.yaml`
- `.hseos/workflows/ado-ops/workflow.md`
- `scripts/ado-install.sh`
