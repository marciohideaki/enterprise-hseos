# Workflows

> The 5 delivery workflows in HSEOS — what they do, how humans participate, and how to resume if interrupted.

---

## Overview

Workflows are orchestrated, stateful pipelines. ORBIT coordinates them. Each workflow:

- Declares prerequisites before starting
- Produces a typed artifact at each phase
- Stops visibly when a gate fails — it never silently skips
- Can be resumed from the last validated phase

---

## 1. Epic Delivery — `ED`

**Activated by:** ORBIT (`/orbit` → `ED`)  
**Duration:** Multi-session (hours to days for a full epic)  
**Use when:** Delivering a complete epic end-to-end with multiple agents

This is the full pipeline. 11 phases, 10 agents.

### Phase sequence

| Phase | Agent | What happens | Human action required? |
|---|---|---|---|
| 0 — Preflight | ORBIT | Validates prerequisites, tools, and workflow state | Fix blockers if reported |
| 1 — Epic Scope | NYX | Confirms epic objective and story dependency order | Approve scope or correct |
| 2 — Planning & UX | VECTOR + PRISM | Validates story ordering and UX implications | Review and approve artifacts |
| 3 — Architecture Readiness | CIPHER | Confirms architecture constraints and ADR requirements | Approve or request ADR |
| 4 — Story Preparation | RAZOR | Ensures sprint status and story artifacts are ready | Review stories for completeness |
| 5 — Story Execution | GHOST | Implements stories with TDD, commits to feature branch | Review commits, resolve blockers |
| 6 — Validation Gate | GLITCH | Adversarial review, test coverage, quality gates | Must pass — no override |
| 7 — Publish | FORGE | Publishes artifact to registry with immutable evidence | Confirm image tag and digest |
| 8 — GitOps Deploy | KUBE | Updates manifests, creates GitOps PR, monitors ArgoCD | **Approve the GitOps PR** |
| 9 — Runtime Verification | SABLE | Verifies pod health, smoke tests, readiness gates | Review runtime report |
| 10 — Consolidation | QUILL + ORBIT | Emits execution evidence, PR-ready delivery summary | Final sign-off |

### Artifact chain

```
NYX (scope doc)
  → VECTOR (PRD, epics)
    → CIPHER (architecture doc, ADRs)
      → RAZOR (ready stories)
        → GHOST (code, commits, tests)
          → GLITCH (quality gate report)
            → FORGE (image tag, digest, SHA, pipeline URL)
              → KUBE (GitOps PR URL, ArgoCD sync status)
                → SABLE (runtime health report)
                  → QUILL (delivery summary, changelog)
```

### How to resume after interruption

ORBIT persists state in `.hseos-output/<epic-id>/state.yaml`. If a session ends mid-workflow:

```
/orbit
→ ED
→ ORBIT will detect existing state and resume from last completed phase
```

Never re-run from Phase 0 if state exists — you'll lose validated evidence.

---

## 2. Delivery Readiness — `DR`

**Activated by:** ORBIT (`/orbit` → `DR`)  
**Duration:** Minutes  
**Use when:** Checking if prerequisites are in place before starting Epic Delivery

Runs a pre-flight checklist. ORBIT validates:
- Required artifacts exist (PRD, architecture doc, stories)
- Tools are accessible (GitHub MCP, Kubernetes MCP, ArgoCD)
- No blocking issues in the current branch state
- Workflow state from a previous run is consistent

**Output:** Green (proceed) or a list of missing prerequisites with resolution guidance.

Use this before `ED` when you're unsure if the epic is ready to start, or after a long break to verify state integrity.

---

## 3. Kube Deploy — `KD`

**Activated by:** KUBE (`/kube` → `KD`)  
**Duration:** 5–15 minutes  
**Use when:** Deploying a new image version to a Kubernetes environment

Handles the GitOps side of a deployment. Does not build or push images — that's FORGE.

### Phase sequence

| Phase | What happens |
|---|---|
| 0 — Profile Detection | Reads `.hseos/config/kube-profile.yaml` or auto-detects GitOps model |
| 1 — Manifest Location | Finds `kustomization.yaml` for the target service and environment |
| 2 — Validation | Runs profile-defined validation command (`kustomize build`, `kubeval`, etc.) |
| 3 — Branch + Commit | Creates feature branch, bumps image tag, commits with governed format |
| 4 — PR Creation | Opens PR against the correct base branch (from `pr-base-map`) |
| 5 — ArgoCD Monitor | Watches sync status until Healthy or surfaces the error |

### Human touchpoint

KUBE creates the GitOps PR but **does not merge it in production flows**. You must approve and merge manually (or via your team's PR process). KUBE will wait and report ArgoCD sync status after merge.

### GitOps profiles

| Profile | What it means |
|---|---|
| `centralized` | Manifests live in a shared monorepo (e.g., `platform-gitops`) |
| `app-paired` | Each application has its own manifest repository |

KUBE auto-detects which model your project uses. To override, edit `.hseos/config/kube-profile.yaml`.

---

## 4. Runtime Deploy — `RD`

**Activated by:** SABLE (`/sable` → `RD`)  
**Duration:** 5–20 minutes  
**Use when:** Verifying a deployment is healthy after KUBE has synced

Run after KUBE reports ArgoCD sync complete. SABLE checks:

- Pod readiness and restart counts
- Application logs for critical errors (first 5 minutes post-deploy)
- Smoke test endpoints or health checks declared in the workflow
- Seed/data readiness steps (if declared)

**Output:** Runtime health report. If any check fails, SABLE stops, reports the root cause, and does not advance to the next phase. It never reinterprets a failing signal as acceptable.

---

## 5. Release Publish — `RP`

**Activated by:** FORGE (`/forge` → `RP`)  
**Duration:** 5–10 minutes  
**Use when:** Publishing a release artifact to a container registry or package registry

FORGE handles the publication step. It does not deploy — that's KUBE + SABLE.

What FORGE does:
- Inspects CI workflow for presence and configuration
- Builds and publishes the artifact (image push, npm publish, etc.)
- Records immutable evidence: image tag, digest, SHA, pipeline URL
- Blocks promotion if publication evidence is incomplete

**Hard rule:** No release without evidence. FORGE will refuse to proceed if CI state is missing or the build has not passed.

---

## Workflow state files

All workflow state is written to `.hseos-output/`. Do not delete this directory mid-workflow.

```
.hseos-output/
└── <epic-id>/
    ├── state.yaml          ← current phase, completed phases, artifact references
    ├── phase-7-output.yaml ← FORGE evidence (image tag, digest, SHA)
    └── phase-8-output.yaml ← KUBE evidence (PR URL, sync status)
```

These files are gitignored by default (delivery evidence, not source code).

---

## When a workflow stops

ORBIT and individual agents stop visibly when a gate fails. You will see:

```
[GATE FAIL] Phase 6 — Validation Gate
Reason: Test coverage dropped below threshold (58% < 80%)
Required action: Fix failing tests in services/payments/
Do not advance to Phase 7 until this gate passes.
```

Do not try to skip the gate. Fix the reported issue and re-run the phase. Gates exist because downstream phases depend on their outputs being valid.
