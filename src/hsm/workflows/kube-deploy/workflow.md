# Kube Deploy

## Intent
Translate immutable artifacts from FORGE into a live Kubernetes deployment via GitOps,
and deliver cluster-state evidence to SABLE for runtime verification.

## Owner
KUBE

## When To Use
- After FORGE has published a validated image to the container registry
- When promoting an image tag to one or more environments via GitOps
- As part of the Epic Delivery flow (between publish and runtime phases)
- Standalone when a deploy-only operation is requested

## Phases

### 0. GitOps Profile Detection
Determine the active deployment model before any manifest mutation.

**Step 1 — Read explicit config (preferred):**
- Check if `.hseos/config/kube-profile.yaml` exists in the current repo
- If present: load profile values (manifest-path-template, validation-cmd, argocd-app-pattern, pr-base-map, branch-prefix-template, commit-template)

**Step 2 — Auto-detect from repo structure (fallback):**
| Signal | Detected profile |
|---|---|
| Directory `<project>/<service>/` exists at repo root | `centralized` |
| Directory `deploy/overlays/` or `k8s/overlays/` at repo root | `app-paired` |
| Neither found | Ask user which model applies |

**Step 3 — Display active profile** (required before any mutation):
```
GitOps Profile: <centralized|app-paired>
Repo:           <gitops-repo>
Manifest path:  <resolved manifest-path-template>
Validation:     <validation-cmd>
ArgoCD app:     <argocd-app-pattern>
PR base:        <pr-base-map for target env>
Branch prefix:  <branch-prefix-template>
```

HARD STOP if profile cannot be determined.

### 1. Deploy Surface Detection
- Identify: project/app name, service(s), environment(s), image tag (received from FORGE or user)
- Resolve manifest path using active profile `manifest-path-template`
- Verify manifest exists at resolved path
  - If path does NOT exist → STOP, guide user to create project/service structure first
    - Centralized: load `gitops-new-project` or `gitops-add-service` skill
    - App-paired: instruct user to create `deploy/overlays/<env>/` in the manifest repo
- Read current kustomization.yaml and display current image tags before any change

### 2. Manifest Update
- Surgical update (one service):
  ```bash
  cd <project>/services/overlays/<env>
  kustomize edit set image <image-name>=<image-name>:<new-tag>
  ```
- Global update (all services in overlay, only when explicitly requested):
  ```bash
  sed -i -E "s#(newTag:\s*).*#\1<new-tag>#" <project>/services/overlays/<env>/kustomization.yaml
  ```
- Display the diff before proceeding

### 3. Validation
- Run profile `validation-cmd` (with variables resolved)
  - Centralized example: `./scripts/ci/validate_project_kustomize.sh <project>`
  - App-paired fallback: `kustomize build <manifest-dir>`
- HARD STOP if validation fails — do not commit
- Fix the manifest issue and re-validate before proceeding

### 4. Branch, Commit, and PR
- Create branch using profile `branch-prefix-template` + `-<YYYYMMDD>`
- Commit using profile `commit-template` (variables resolved)
  - NO Co-Authored-By trailer
  - NO AI mentions
- Push to origin
- Create PR:
  - Base: resolved from profile `pr-base-map[<env>]`; fallback to `main`
  - Title: profile commit-template adapted for PR title
  - Body: list services updated, previous tag → new tag, environments affected

### 5. ArgoCD Sync Monitor
- Resolve ArgoCD Application name from profile `argocd-app-pattern` (variables resolved)
- Poll Application status until:
  - `status.syncStatus` = `Synced`
  - `status.operationState.phase` = `Succeeded`
- HARD STOP if Application enters Degraded or Error state
- Record: Application name, sync timestamp, health status

### 6. Handoff Evidence to SABLE
Deliver the following evidence before passing control to SABLE:
- PR URL and merge status
- ArgoCD Application name and sync status
- Deployment revision (from `kubectl rollout status deployment/<service> -n <namespace>`)
- Number of ready replicas
- Image tag confirmed in running pods

## Required Inputs
- Project/app name (must exist in the active GitOps repo)
- Service name(s) being updated
- Environment(s): dev | hmg | stg | prod
- Image tag (SHA, semver, or develop)
- FORGE evidence (optional but recommended): registry URL, digest, pipeline reference

## Required Evidence (Output)
- Manifest diff showing tag changes
- Validation pass result
- PR URL
- ArgoCD sync confirmation with timestamp
- Deployment rollout status

## Gates
- Hard-fail: validation script fails, ArgoCD Degraded/Error, manifest does not exist
- Clean-stop: project or service not found in platform-gitops (redirect before mutation)
- Warn: ArgoCD Application not yet configured (no automated sync policy)

## Governance Rules
- Never commit to protected branches (main/develop/master)
- Never add Co-Authored-By or mention AI in commits
- Infra overlays are NOT touched — services overlays only
- Validation MUST pass before commit
