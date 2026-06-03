# INTAKE — ado-ops Module

**Run ID:** 20260528-0900-ado-ops-module
**Date:** 2026-05-28
**Commander:** SWARM (Sonnet 4.6)
**Squad:** Sonnet 4.6 × worktrees

## Brief

Criar o módulo `ado-ops` no enterprise-hseos — integração Azure DevOps desacoplada via
feature flag `ado.enabled: false`. Cobre o ciclo completo ADO-first para projetos HSEOS:
planejamento (G1-ADO), execução rastreada, fechamento automatizado.

## Scope

- 5 skills novas (ado-ops, ado-plan, ado-sync, ado-close-wave, ado-new-project)
- 1 agent ATLAS + authority + constraints
- 1 workflow ado-ops (7 fases)
- 6 hooks handlers + 1 helper lib
- Registries: hooks, commands, workflows, MCP bundle, SKILLS-REGISTRY, manifest
- Scripts: ado-install.sh (global), ado-doctor.sh, ado-task-from-branch.sh
- Tests: 5 test scripts (invariante de zero side-effect quando disabled)
- ADR-0010, docs

## Plano aprovado

Localização: `/home/annonymous/.claude/plans/planeje-e-implemente-a-ancient-karp.md`
G2 gate: aprovado pelo usuário em 2026-05-28 via ExitPlanMode.

## Decisões fixas

- Skill global `~/.claude/skills/ado/` removida após W2
- ADR-0010 em `.enterprise/.specs/decisions/`
- Installer global: atualiza `~/.claude/mcp.json` + `~/.claude/settings.json`
- Granularidade: Epic=Phase, Feature=Wave group, Story=Wave, Task=worktree ≤60% ctx

## Waves

```
W1 (7 tasks paralelas) — Skills Foundation
W2 (9 tasks paralelas) — Agent ATLAS + Hooks + Registries
W3 (3 tasks sequenciais) — Compiler + Manifest + ADR
W4 (6 tasks paralelas) — Installer + Tests + Docs
```

## Branch

`feature/hseos-ado-ops-module` (base: master)
