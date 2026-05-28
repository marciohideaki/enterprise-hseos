# PLAN — ado-ops Module

**G2: APPROVED 2026-05-28** (ExitPlanMode — usuário aprovou)
**Run ID:** 20260528-0900-ado-ops-module
**Branch:** feature/hseos-ado-ops-module (base: master)

## Wave 1 — Skills Foundation (7 tasks paralelas)

| Task | Files | Status |
|---|---|---|
| W1-T1 | `.enterprise/governance/agent-skills/ado-ops/SKILL.md` + `SKILL-QUICK.md` | ⚪ |
| W1-T2 | `.enterprise/governance/agent-skills/ado-plan/SKILL.md` + `SKILL-QUICK.md` | ⚪ |
| W1-T3 | `.enterprise/governance/agent-skills/ado-sync/SKILL.md` + `SKILL-QUICK.md` | ⚪ |
| W1-T4 | `.enterprise/governance/agent-skills/ado-close-wave/SKILL.md` + `SKILL-QUICK.md` | ⚪ |
| W1-T5 | `.enterprise/governance/agent-skills/ado-new-project/SKILL.md` + `SKILL-QUICK.md` | ⚪ |
| W1-T6 | `.agents/hooks/handlers/_ado-lib.sh` | ⚪ |
| W1-T7 | `.hseos/config/hseos.config.yaml` (append `ado:` section) | ⚪ |

Acceptance W1: yamllint config, bash -n _ado-lib.sh, frontmatter válido nas 5 skills

## Wave 2 — Agent ATLAS + Hooks + Registries (9 tasks paralelas)

| Task | Files | Status |
|---|---|---|
| W2-T1 | `.hseos/agents/atlas.agent.yaml` + `.enterprise/agents/atlas/authority.md` + `constraints.md` | ⚪ |
| W2-T2 | 6 hook handlers (ado-preflight-gate, ado-branch-guard, ado-on-plan-write, ado-task-progress, ado-pr-link, ado-tag-close) | ⚪ |
| W2-T3 | `.hseos/workflows/ado-ops/workflow.md` | ⚪ |
| W2-T4 | `.enterprise/governance/agent-skills/SKILLS-REGISTRY.md` (append 5 entries) | ⚪ |
| W2-T5 | `.agents/hooks/registry.yaml` (append 6 entries) | ⚪ |
| W2-T6 | `.agents/mcp/bundles/enterprise.yaml` (append azure-devops) | ⚪ |
| W2-T7 | `.agents/commands/registry.yaml` (4 commands) | ⚪ |
| W2-T8 | `.hseos/workflows/registry.yaml` (ado-ops entry) | ⚪ |
| W2-T9 | `.hseos/config/hseos.config.yaml` (append ATLAS agent entry) | ⚪ |

## Wave 3 — Compiler + Manifest + ADR (sequencial)

| Task | Files | Status |
|---|---|---|
| W3-T1 | `.agents/manifest.yaml` (bump counts + 5 skill entries) | ⚪ |
| W3-T2 | `.agents/skills/ado-*/` + `.claude/hooks.json` + `.codex/hseos-hooks.json` | ⚪ |
| W3-T3 | `.enterprise/.specs/decisions/ADR-0010-ado-ops-module.md` | ⚪ |

## Wave 4 — Installer + Tests + Docs (6 tasks paralelas)

| Task | Files | Status |
|---|---|---|
| W4-T1 | `scripts/ado-install.sh` | ⚪ |
| W4-T2 | `scripts/ado-doctor.sh` | ⚪ |
| W4-T3 | `scripts/governance/ado-task-from-branch.sh` | ⚪ |
| W4-T4 | `test/ado-ops/preflight-gate.test.sh` + `branch-guard.test.sh` + `pr-link.test.sh` + `tag-close.test.sh` | ⚪ |
| W4-T5 | `test/ado-ops/feature-flag-disabled.test.sh` | ⚪ |
| W4-T6 | `docs/ado-ops/README.md` + `docs/ado-ops/GRANULARITY.md` | ⚪ |

## Commit message format (HSEOS)
`feat(platform): <summary>` — sem Co-Authored-By, sem menção a AI
