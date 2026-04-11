# Runtime Deploy

## Intent
Verify that a deployment applied by KUBE is healthy and the runtime is ready for functional use.

## Owner
SABLE

## When To Use
- After KUBE has confirmed ArgoCD sync and delivered deployment evidence
- As part of the Epic Delivery flow (after the gitops-deploy phase)
- Standalone when a runtime health check or smoke verification is requested

## Phases

### 1. Receive KUBE Handoff and Verify Evidence
- Confirm KUBE evidence is present:
  - PR URL and merge status
  - ArgoCD Application name and sync timestamp
  - Deployment revision identifier
  - Expected image tag in running pods
- If evidence is missing or stale: STOP and redirect to KUBE to complete the deployment phase

### 2. Rollout Verification
- Check rollout status: `kubectl rollout status deployment/<service> -n <namespace>`
- Verify all replicas are ready and no pods are in CrashLoopBackOff or Pending state
- Confirm current image tag matches the tag from KUBE's evidence
- HARD STOP if rollout stalls or pods are unhealthy

### 3. Health and Smoke Checks
- Run health endpoint checks (if declared by workflow or project config)
- Verify application responds correctly on expected ports/paths
- Check for critical errors in recent logs: `kubectl logs -n <namespace> -l app=<service> --tail=100`
- HARD STOP on crash loops, OOM kills, or repeated 5xx errors

### 4. Runtime Regression
- Run browser or E2E regression suite if declared by workflow configuration
- Verify no critical functional regressions from the previous deployment
- Record test results as deployment evidence

### 5. Consolidation Evidence
Deliver the following to QUILL/ORBIT for final consolidation:
- Rollout status (ready replicas, pod count)
- Image tag confirmed running in cluster
- Health check results
- Log inspection summary (no critical errors or documented known issues)
- Smoke/regression test results (if applicable)

## Required Inputs
- KUBE handoff evidence: PR URL, ArgoCD Application name, sync status, deployment revision
- Namespace and service names
- Expected image tag

## Required Evidence (Output)
- Rollout completion confirmation with timestamp
- Pod health status
- Log inspection result (clean or known issues documented)
- Smoke/health endpoint result

## Gates
- Hard-fail: rollout stalls, pods in CrashLoopBackOff, health checks fail, critical log errors
- Hard-fail: KUBE handoff evidence is missing or ArgoCD shows stale sync
- Warn: optional smoke/regression assets not present

## Interaction
- SABLE does NOT update manifests — if deployment did not apply, redirect to KUBE
- SABLE does NOT re-trigger deploys — stop and escalate to KUBE or human
