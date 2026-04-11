---
name: mcp-governance
tier: full
version: "1.0"
---

# MCP Governance — Full Policy

> Tier 2: Full policy for MCP usage governance, spend control, rate limits, and operational hygiene.
> For quick checks, use SKILL-QUICK.md (Tier 1).

---

## 1. Tool Selection Policy

### 1.1 Hierarchy (strict precedence)

```
MCP tool  >  standard CLI (gh, kubectl, az)  >  raw HTTP (curl)  >  no-op + user escalation
```

Every deviation from this hierarchy requires an explicit comment in the agent's reasoning: _"No MCP covers this because [reason]."_

### 1.2 Scope mapping

| Domain | Preferred MCP | Allowed fallback | Prohibited |
|---|---|---|---|
| GitHub | `mcp__github__*` | `gh` CLI (only if MCP lacks the operation) | Direct `curl` to GitHub API |
| Kubernetes | `mcp__kubernetes-mcp-server__*` | `kubectl` | Manual YAML patching via `sed/awk` |
| ArgoCD | `mcp__argocd-mcp-server__*` | `argocd` CLI | `kubectl apply` to ArgoCD CRDs directly |
| Azure DevOps | `mcp__azure-devops__*` | `az devops` CLI | REST calls without auth check |
| Filesystem | Edit/Write/Read tools | `cat`, `sed` (read-only) | `rm -rf`, destructive ops without confirmation |

---

## 2. Spend Control

### 2.1 Call budget guidelines

| Operation type | Max calls per task | Mitigation if exceeded |
|---|---|---|
| List / search | 5 | Narrow the query; paginate |
| Get single resource | 10 | Cache result in session memory |
| Write / mutate | 3 | Batch where API supports it |
| Sync / trigger | 1 per environment | Sequential; wait for completion |

### 2.2 Loop guards

Every loop over MCP calls **must** define:
- Maximum iteration count (hard stop)
- Stop condition checked before each iteration
- Backoff delay for retries (min 5s, max 60s)

```
# Pattern
for item in items[:MAX_ITEMS]:
    result = mcp_call(item)
    if stop_condition(result): break
```

### 2.3 Session caching

Within one agent session, never re-fetch the same resource twice. Store results in working context after first fetch. If the resource may have changed (e.g., pod status after a deploy), explicitly note the re-fetch reason.

---

## 3. Rate Limit Handling

### 3.1 Response codes and actions

| Code | Platform | Required action |
|---|---|---|
| `429` | Any | Exponential backoff: 30s → 60s → 120s → escalate to user |
| `403 insufficient_scope` | GitHub | Report missing OAuth scope; do not retry |
| `503 Service Unavailable` | Any | Single retry after 10s; if repeated, escalate |
| `sync already running` | ArgoCD | Poll `get_application` every 15s until idle; do not trigger new sync |
| `TF400898` / throttled | Azure DevOps | Reduce batch to 20 items; add 2s delay between batches |

### 3.2 Parallel call constraints

- Do not issue > 5 MCP calls in parallel (risk of burst rate limit)
- For bulk operations, batch in groups of 10 with a 2s pause between groups
- Never fan-out without a bound: `for x in unlimited_list` is a violation

---

## 4. Observability

### 4.1 What to log (in agent reasoning output)

For each MCP operation sequence:
1. **Intent**: what the call chain is attempting
2. **Result summary**: key fields extracted (not full payloads)
3. **Deviation**: if fallback CLI was used, state why MCP was insufficient

### 4.2 Sensitive data handling

- Never print full API responses if they contain tokens, secrets, or PII
- Mask fields: `token`, `password`, `secret`, `key`, `authorization`
- Pod exec outputs may contain credentials — truncate if pattern matches `(password|token|secret)\s*[=:]\s*\S+`

---

## 5. Escalation Policy

Escalate to the user (do not auto-proceed) when:

| Condition | Reason |
|---|---|
| MCP call failed 3 times consecutively | May indicate infra issue, not transient error |
| Operation requires scope/permission not available | Token may need rotation |
| Write operation would affect > 3 resources | Confirm blast radius |
| Rate limits hit on critical path (deploy/sync) | User may want to re-schedule |
| MCP response is ambiguous (e.g., partial sync) | Manual verification needed |

---

## 6. Governance Checklist (pre-task)

Before any multi-step MCP workflow:
- [ ] Identified which MCP servers are relevant (no unnecessary calls to irrelevant servers)
- [ ] Estimated call count — within budget guidelines?
- [ ] Loop guards defined if iterating
- [ ] Write operations confirmed or scoped to dry-run first
- [ ] Fallback plan if MCP is unavailable for a critical step
