# KUBE — Kubernetes Delivery Operator

**Code:** KUBE | **Title:** Kubernetes Delivery Operator | **Activate:** `/kube`

---

## What KUBE does

KUBE handles the GitOps side of Kubernetes deployments. It reads FORGE's artifact evidence (image tag + digest), updates the Kubernetes manifests in the GitOps repository, creates a PR, and monitors ArgoCD until the sync completes.

KUBE never builds images, never deploys directly to the cluster, and never verifies runtime health. Those are FORGE's and SABLE's jobs respectively. KUBE's domain is the manifest update lifecycle.

---

## When to use KUBE

| Situation | Command |
|---|---|
| You need to deploy a new image version to a Kubernetes environment | `KD` — Kube Deploy |

---

## Commands

```
/kube
→ KD   Kube Deploy
```

---

## What KUBE produces

- Updated `kustomization.yaml` with the new image tag (in a feature branch)
- GitOps PR targeting the correct base branch
- ArgoCD sync status report
- Block report (when manifests don't exist and a new project/service needs to be created first)

---

## What KUBE cannot do

- **Build or push container images** — FORGE does this
- **Verify runtime health, pod readiness, or smoke tests** — SABLE does this
- **Modify infrastructure manifests** (outside of image tag updates) — infra changes require a separate change process
- **Set `prune: true` on infra ArgoCD Applications** — destructive; requires explicit human action
- **Define or alter cluster topology, namespaces, or AppProject configuration** — platform team territory
- **Approve or merge PRs in production flows without explicit human confirmation** — humans merge production PRs

---

## GitOps deployment profiles

KUBE auto-detects which GitOps model your project uses. Two profiles are supported:

### Centralized (monorepo)
- All services share one GitOps repository (e.g., `platform-gitops`)
- KUBE finds the service's path within the monorepo
- PR targets a shared main/develop branch

### App-paired (per-application)
- Each application has its own manifest repository
- KUBE clones and updates the app-specific repo
- PR targets the app repo's main branch

To see or override the active profile:
```bash
cat .hseos/config/kube-profile.yaml
```

If this file doesn't exist, KUBE will auto-detect by scanning the repository structure.

---

## Deployment flow

```
1. Read kube-profile.yaml (or auto-detect)
2. Locate kustomization.yaml for the target service + environment
3. Run validation command (kustomize build / kubeval / etc.)
4. Create feature branch: deploy/<service>/<env>/<timestamp>
5. Bump image tag in kustomization.yaml
6. Commit with governed message format
7. Push and open PR against pr-base-map[env]
8. Monitor ArgoCD Application until status = Healthy
```

---

## Human touchpoint — production deploys

In production environments, KUBE creates the PR but **does not merge it**. You must approve and merge the PR through your team's standard review process. After merge, KUBE watches ArgoCD and reports the sync result.

For non-production environments (dev, staging), auto-merge may be configured via the `kube-profile.yaml`.

---

## What to do when manifests don't exist

If KUBE cannot find a `kustomization.yaml` for the target service, it stops and redirects to the appropriate setup workflow:

- **New project** → use KUBE + `gitops-new-project` skill (or `/orbit` for full orchestration)
- **New service in existing project** → use `gitops-add-service` skill

KUBE will not create manifest structures from scratch during a deploy workflow.

---

## In the epic delivery pipeline

KUBE runs in **Phase 8** — GitOps Deploy:
- Reads FORGE's evidence record from Phase 7
- Executes the manifest update + PR lifecycle
- Reports ArgoCD sync status

Output flows to SABLE (Phase 9).
