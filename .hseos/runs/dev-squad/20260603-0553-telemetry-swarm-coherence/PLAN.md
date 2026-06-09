# PLAN — telemetry bridge + dev-squad/SWARM coherence

run-id: 20260603-0553-telemetry-swarm-coherence
Gate G2: APPROVED (ExitPlanMode + "SWARM completo")
base: feature/telemetry-bridge-dev-squad-coherence

## Model matrix (per dev-squad skill; version-less + footnote pins Haiku 4.5 / Sonnet 4.6 / Opus 4.8)
Commander = Opus. Squad default = Sonnet. All squad tasks here = Sonnet (architecture already
decided by Commander; squad executes from precise specs → execution, not strategic design).

## Recompile rule (collision invariant)
Only ONE recompiling task per wave. Recompile = `node tools/cli/hseos-cli.js agent-core compile
--directory <worktree>`. After compile, the worktree holds consistent source + `.agents/manifest.yaml`
+ `.claude/hooks.json` + `.codex/hseos-hooks.json` + compiled mirrors → full `npm test` passes.

## Wave / task DAG

### Wave 1 (1 task — sole recompiler)
- **T1 `track-a-hooks`** [Sonnet, large] — recompiles.
  Create handlers `telemetry-export-tool.sh`, `telemetry-export-session.sh`, `rtk-rewrite.sh`,
  `build-resource-guard.sh`; append 4 entries to `.agents/hooks/registry.yaml` (telemetry ×2
  `status: active`; adapters ×2 `status: inactive`); update `.agents/hooks/handlers/README.md`;
  add "Telemetry Export Bridge" section to `ai-observability/SKILL.md` + `SKILL-QUICK.md`; then
  recompile. Files compiled-source → recompile mandatory.

### Wave 2 (3 tasks — only T2 recompiles; T3/T4 doc-only, disjoint files)
- **T2 `track-b-skill-matrix`** [Sonnet, medium] — recompiles.
  Reconcile model matrix in `dev-squad/SKILL.md` + `SKILL-QUICK.md` (single form), bump versions
  to 1.2, drop the `~/.claude` canonical claim; then recompile (regenerates dev-squad mirror).
- **T3 `track-b-refs`** [Sonnet, small] — doc-only, no recompile.
  Fix repo-side global-path leaks: `dev-squad/workflow.md` (HANDOFF path L52, canonical-skill
  pointer L127, Opus-4.7→version-less L4) + `SKILLS-REGISTRY.md` (two `~/.claude/.../SKILL.md`
  → `.enterprise/.../dev-squad/SKILL.md`).
- **T4 `track-b-adrs`** [Sonnet, medium] — doc-only, no recompile.
  Author `ADR-0014-telemetry-export-bridge.md` + `ADR-0015-dev-squad-canonical-authority.md`
  from `_TEMPLATE.md`; add both rows to `_INDEX.md` (+ backfill missing ADR-0010/0011 rows).

### Consolidate (Commander)
Full `npm test` + `agent-core verify`/`audit` on feature branch; WAVE reports; draft PR body
(G4 = human runs `gh pr create`). Track C (`~/.claude/` fixes) = out-of-repo follow-up.

## Collision matrix (verified disjoint)
- W1: T1 only → registry.yaml, handlers, ai-observability, manifest (recompiled). No peer.
- W2: T2 = dev-squad/{SKILL,SKILL-QUICK}.md + manifest; T3 = workflow.md + SKILLS-REGISTRY.md;
  T4 = ADR-0014, ADR-0015, _INDEX.md. Pairwise disjoint; only T2 touches manifest.

## Governance invariants
worktree-manager.sh create→validate→commit→merge→remove per task; 1 task = 1 commit;
conventional commits (no Co-Authored-By, no AI mentions); base feature/*; quality-gates 6 gates.
