# Pull Request — Phase Completion

> **Governance:** Generated under HSEOS execution governance (SWARM dev-squad run 20260603-0553).
> **Merge authority:** Human reviewer only.

## Phase

**Phase:** `feature/telemetry-bridge-dev-squad-coherence`

**Task(s) completed:**
- [x] `task/T1` — Track A: telemetry export bridge + optional adapters
- [x] `task/T2` — Track B: dev-squad model-matrix reconciliation
- [x] `task/T3` — Track B: repo-side global-path ref fixes
- [x] `task/T4` — Track B: ADR-0014 + ADR-0015 + index

## Execution Summary

### Objectives
- Incorporate the genuinely-absent portable capabilities into HSEOS (the rest of the global
  skill/hook surface is already native — verified against the 49-skill / 24-hook registries).
- Normalize the dev-squad/SWARM coherence defects (matrix drift, global-path leaks) and pin the
  canonical authority hierarchy in an ADR.

### Changes Made
- **Telemetry export bridge (opt-in, zero default dependency):** two env-gated TEE hooks export OTLP
  metrics (PostToolUse) and OTLP/Loki session logs (Stop) IN ADDITION to the canonical SQLite sink.
  Inert unless `OTEL_EXPORTER_OTLP_ENDPOINT` / `HSEOS_LOKI_ENDPOINT` is set. Runbook folded into the
  `ai-observability` skill. (ADR-0014; reuses the ADR-0010 shared collector.)
- **Optional adapters (default-off):** `rtk-rewrite` (token-saving, requires the `rtk` binary) and
  `build-resource-guard` (`HSEOS_BUILD_MAX_JOBS` parallelism cap, decoupled from axon) registered
  `status: inactive` — not compiled into any adapter until a consumer opts in.
- **dev-squad model matrix:** reconciled into a single version-less form (pins in a footnote) across the
  canonical `SKILL.md` + `SKILL-QUICK.md` (they previously disagreed); version → 1.2.
- **Global-path leaks removed (ADR-0006 P5):** `workflow.md` + `SKILLS-REGISTRY.md` no longer point at
  `~/.claude/...` as canonical; they reference the in-repo source of truth.
- **ADR-0015** pins the dev-squad authority hierarchy (enterprise source → `.agents` compiled mirror →
  `~/.claude` external mirror for non-HSEOS only). `_INDEX.md` updated (+ backfilled 0010/0011).

### Files Modified
- New handlers: `.agents/hooks/handlers/{telemetry-export-tool,telemetry-export-session,rtk-rewrite,build-resource-guard}.sh`
- `.agents/hooks/registry.yaml`, `.agents/hooks/handlers/README.md`
- `.enterprise/governance/agent-skills/ai-observability/{SKILL.md,SKILL-QUICK.md}`
- `.enterprise/governance/agent-skills/dev-squad/{SKILL.md,SKILL-QUICK.md}`
- `.hseos/workflows/dev-squad/workflow.md`, `.enterprise/governance/agent-skills/SKILLS-REGISTRY.md`
- `.enterprise/.specs/decisions/{ADR-0014-telemetry-export-bridge.md,ADR-0015-dev-squad-canonical-authority.md,_INDEX.md}`
- Compiler-regenerated: `.agents/manifest.yaml`, `.claude/hooks.json`, `.codex/hseos-hooks.json`, `.agents/skills/{ai-observability,dev-squad}/*`

## Validation Results

| Gate | Status | Notes |
|------|--------|-------|
| Governance Structure | ✅ | per-task + integration |
| Documentation Quality | ✅ | placeholder/markdown checks |
| Code Quality (lint) | ✅ | `eslint . --max-warnings=0` |
| Code Quality (tests) | ✅ | full `npm test` EXIT 0; `agent-core verify` 65, `audit` 91 — no drift |
| Security Scan | ✅ | no secret patterns |
| Commit Hygiene | ✅ | conventional, no trailers/AI mentions |

**Result:** PASSED. (`format:check` fails on a pre-existing missing devDep `prettier-plugin-packagejson` — not in quality-gates/npm test, not a regression.)

## Worktree Isolation Confirmation
- [x] Each task executed in a dedicated `task/*` worktree (T1–T4)
- [x] Worktrees removed after merge
- [x] No cross-task contamination (disjoint files; only one recompiler per wave)

## Governance Compliance
- [x] No direct commits to `master`
- [x] No co-author trailers
- [x] No AI system mentions in commit messages
- [x] One commit per task
- [x] Conventional commit format
- [x] Phase validation passed before PR

## Out-of-repo follow-up (Track C)
Global `~/.claude/` fixes (broken `.hseos/hsm/` paths + demote the external dev-squad mirror) are
applied separately as they live outside this repo. The AXON path in `~/.claude/CLAUDE.md` (points to a
non-existent `.hseos/agents/axon` agent) is **flagged for human decision** — not fixed blind.
