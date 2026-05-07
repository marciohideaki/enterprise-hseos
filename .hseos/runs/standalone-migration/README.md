# Standalone Migration Run — `standalone-migration`

**Workflow:** dev-squad (heterogeneous parallel batch)
**Owner agent (Commander):** SWARM
**Started:** 2026-05-07 (Wave 0)
**Target version:** HSEOS v2.0.0
**Migration plan:** `~/.claude/plans/mapeie-o-ambiente-completamente-prancy-church.md`

---

## Purpose

Tracks the multi-wave migration of HSEOS from v1.x (≈92% standalone, three load-bearing global dependencies) to v2.0 (100% standalone, vendor-neutral, multi-adapter, MCP-native).

The migration is governed by:

- **ADR-0006** — Standalone Architecture (P1..P7 invariants)
- **ADR-0007** — Compiler v2 multi-adapter contract
- **ADR-0008** — MCP project-local + bundle policy
- **ADR-0009** — Plugin marketplace (dual-format)

---

## Artifacts

| File | Purpose |
|---|---|
| `STATUS.md` | Wave-by-wave progress tracker (current state) |
| `WAVE-<n>-REPORT.md` | Consolidation report at the end of each wave (created by SWARM) |
| `handoffs/wave-<n>-to-wave-<n+1>.md` | Inter-wave handoff bundles (decisions, open questions, follow-ups) |

---

## Governance

- **Branch pattern:** `feature/standalone-w<n>-<slug>` per wave
- **Task pattern:** `task/standalone-w<n>-t<m>-<slug>` for parallel sub-tasks
- **Worktrees:** `.worktrees/<wave-id>-<task-id>/` (isolated parallel execution)
- **Tags:** `pre-w<n>` (rollback), `v2.0.0-w<n>` (post-merge)
- **Rule:** 1 task = 1 commit, 1 wave = 1 PR, no auto-merge.

---

## Rollback

Each wave creates a `pre-w<n>` tag immediately before any task work begins.
To roll back a wave that has not yet been merged: `git reset --hard pre-w<n>`.
For a merged wave, revert the squashed PR commit and re-tag.
