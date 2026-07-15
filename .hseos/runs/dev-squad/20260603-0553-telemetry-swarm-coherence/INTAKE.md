# INTAKE — telemetry bridge + dev-squad/SWARM coherence

run-id: 20260603-0553-telemetry-swarm-coherence
commander: SWARM (Opus)
base branch: feature/telemetry-bridge-dev-squad-coherence (from master)

## Brief

Incorporate the genuinely-absent portable capabilities into HSEOS (the rest of the
global skill/hook surface is already native — verified against the 49-skill / 24-hook
registries) and normalize the SWARM/dev-squad coherence defects.

Scope decided by the user (approved plan + AskUserQuestion):
- Telemetry OTel/Loki export bridge + optional `rtk-rewrite` / `build-resource-guard` adapters.
- Fix coherence: repo-side global-path leaks + model-matrix divergence + authority ADR.
- Global `~/.claude/` path fixes handled as an out-of-repo follow-up (Track C, main thread).

## Heterogeneity / parallelizability

4 tracks, non-colliding source files → suitable for SWARM parallel waves.
Constraint discovered during intake: `manifest.yaml` is a global compiled artifact and
`worktree-manager.sh validate` runs the full `npm test` (incl. `agent-core verify` drift
check). Therefore: a task editing a compiled SOURCE (skill SKILL.md, hook registry/handler)
MUST recompile in-task; only ONE recompiling task per wave (else manifest merge collision).
Doc-only tasks (workflow.md, SKILLS-REGISTRY.md, ADRs, _INDEX.md) skip recompile.

## Gate G2

Satisfied by the user's ExitPlanMode approval of the plan
(`~/.claude/plans/analise-os-hooks-e-kind-karp.md`) + explicit "SWARM completo" choice.
This PLAN.md is the operational decomposition of that approved plan.
