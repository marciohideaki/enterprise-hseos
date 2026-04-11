# Kube Deploy

## Intent
Translate immutable artifacts from FORGE into a live Kubernetes deployment via GitOps,
and deliver cluster-state evidence to SABLE for runtime verification.

## Owner
KUBE

## When To Use
- After FORGE has published a validated image to the container registry
- When promoting an image tag to one or more environments in platform-gitops
- As part of the Epic Delivery flow (between publish and runtime phases)
- Standalone when a deploy-only operation is requested

## Phases

### 1. Deploy Surface Detection
- Identify: project name, service(s), environment(s), image tag (received from FORGE or user)
- Verify manifests exist: `<project>/services/overlays/<env>/kustomization.yaml`
  - If project does NOT exist in platform-gitops → STOP, redirect to `gitops-new-project`
  - If service has no base manifest → STOP, redirect to `gitops-add-service`
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
- Run: `./scripts/ci/validate_project_kustomize.sh <project>`
- HARD STOP if validation fails — do not commit
- Fix the manifest issue and re-validate before proceeding

### 4. Branch, Commit, and PR
- Create branch: `chore/<project>-deploy-<env>-<YYYYMMDD>`
- Commit: `chore(<project>): bump <service> image tag to <tag> on <env>`
  - NO Co-Authored-By trailer
  - NO AI mentions
- Push to origin
- Create PR:
  - Base: `develop` for dev/hmg/stg — `main` for prod
  - Title: `chore(<project>): deploy <service> <tag> → <env>`
  - Body: list services updated, previous tag → new tag, environments affected

### 5. ArgoCD Sync Monitor
- Confirm ArgoCD Application exists: `<project>-services-<env>`
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
- Project name (must exist in platform-gitops)
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
