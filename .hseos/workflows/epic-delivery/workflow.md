# Epic Delivery

## Intent
Execute a reusable, stateful epic delivery pipeline inside HSEOS.

This flow institutionalizes the previously implicit agentic pipeline as a first-class HSEOS workflow,
with explicit phases for GitOps deployment and runtime verification as separate governed steps.

## Owner
ORBIT

## Phase Model
0. Vault Context Load (Pre-flight)
   ORBIT reads strategic context from the second-brain vault before any phase begins.
   Condition: `second_brain.enabled = true` in `hseos.config.yaml` (check via SKILL-QUICK.md §1).
   Reads: `_memory/current-state.md` + `_knowledge/goals.md`.
   Fallback: vault unavailable → skip silently, proceed with HSEOS sources only.
1. Preflight Readiness
   ORBIT validates prerequisites, artifacts, tools, and prior planning steps.
2. Epic Scope Load
   NYX confirms epic objective, stories, and dependency order.
3. Planning and Experience
   VECTOR and PRISM validate story ordering and UX implications.
4. Architecture Readiness
   CIPHER confirms architecture constraints and ADR requirements.
5. Story Preparation
   RAZOR ensures sprint status and story artifacts are complete and executable.
6. Story Execution Loop
   GHOST implements one story at a time with traceable commits.
7. Validation Gate
   GLITCH executes adversarial review and quality gates.
8. Publish
   FORGE publishes validated artifacts to the container registry with immutable evidence.
9. GitOps Deploy
   KUBE updates platform-gitops manifests, creates PR, and monitors ArgoCD sync.
10. Deploy and Runtime
    SABLE receives KUBE handoff evidence and verifies rollout health, pod status, and smoke checks.
11. Consolidation
    QUILL and ORBIT emit execution evidence and PR-ready summary.
12. Knowledge Consolidation (second-brain, if enabled)
    QUILL identifies cross-project learnings and writes to vault. CIPHER writes approved ADRs to vault.
    ORBIT instructs user to run `hseos brain sync`. QUILL prompts: run `/end-session` in the second-brain to capture full session context.

## Handoff Chain (Phases 8–10)
```
FORGE → (image tag, digest, SHA) → KUBE → (PR URL, ArgoCD sync, deployment revision) → SABLE
```
Each agent receives explicit evidence from the previous phase. No phase may proceed without it.

## Stateful Execution
- persist run state under `.hseos/data/runs/epic-<id>/state.yaml`
- resume only from the last completed phase with repository evidence still matching run state
- re-run the last failed gate after every corrective action

## Required Inputs
- epic identifier
- epic planning artifact
- implementation artifact directory
- configured quality commands or equivalent stack-specific validation commands

## Gates
- hard-fail on contradictory specs, missing required artifacts, failed quality gates, failed publish verification, failed GitOps deployment, or unhealthy runtime
- clean-stop when preconditions are intentionally deferred and the workflow has not begun mutation
- warn when optional release/runtime capabilities are absent and the selected profile does not require them

## Batch Handoff
- interactive and planning-heavy phases stop at `story-prep`
- after `story-prep`, ORBIT may emit batch packets for `implementation` through `consolidation`
- batch packets are written as versionable handoff artifacts so an external executor can run long phases without losing state

## Phase 0 — Vault Context Load (detail)

Responsible: ORBIT
Condition: `second_brain.enabled = true` (SKILL-QUICK.md §1 detection)

Steps:
1. Read `.hseos/config/hseos.config.yaml` → check `second_brain.enabled`
2. If true: verify `CLAUDE.md` exists at `second_brain.path`
3. If verified: read `{vault_path}/_memory/current-state.md` and `{vault_path}/_knowledge/goals.md`
4. Surface any open items or strategic context relevant to the current epic
5. If vault unavailable at any step: log "vault unavailable — continuing without vault context" and proceed

Output: Vault context available to all downstream phases. No artifact required.

## Phase 12 — Knowledge Consolidation (detail)

Responsible: QUILL + CIPHER + ORBIT
Trigger: Phase 11 (Consolidation) complete
Condition: `second_brain.enabled = true`

QUILL steps:
1. Review epic artifacts in `.hseos-output/{epic-id}/`
2. Apply strategic threshold (SKILL.md §4): write only if cross-project value, not already documented, human-approved
3. For each qualifying learning: create `{vault_path}/_learnings/hseos-{topic}.md` (format: SKILL.md §2.2)
4. Prompt user: "Épico concluído. Execute `/end-session` no seu segundo-cérebro para capturar o contexto completo desta sessão."

CIPHER steps (if ADR was approved during epic):
1. For each approved ADR: create `{vault_path}/_decisions/hseos/{YYYY-MM-DD}-{kebab-name}.md` (format: SKILL.md §2.1)
2. Never overwrite — check file existence first; append `-v2` suffix if conflict

ORBIT steps:
1. If `hseos brain sync` is available: instruct user to run it to sync `.hseos-output/` artifacts to vault
2. If not available: append HSEOS block to `{vault_path}/_memory/current-state.md` (format: SKILL.md §3)
   Guard: skip if file already has `## HSEOS — {epic-id}` block

Stop condition: Phase 12 is optional enrichment. Never block delivery if vault write fails.
