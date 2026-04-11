# Epic Delivery

## Intent
Execute a reusable, stateful epic delivery pipeline inside HSEOS.

This flow institutionalizes the previously implicit agentic pipeline as a first-class HSEOS workflow,
with explicit phases for GitOps deployment and runtime verification as separate governed steps.

## Owner
ORBIT

## Phase Model
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
