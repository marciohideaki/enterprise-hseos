---
name: mcp-governance
tier: quick
version: "1.0"
---

# MCP Governance — Quick Reference

> Tier 1: use when deciding which tool to call, managing MCP-heavy workflows, or when spend/rate-limit awareness is needed.
> Load SKILL.md (Tier 2) for full policy, rate limits, and spend tracking procedures.

---

## Tool Selection Hierarchy (apply in order)

| Priority | Use when | Example |
|---|---|---|
| **1. MCP tool** | A dedicated MCP server covers the operation | `mcp__github__create_pull_request`, `mcp__kubernetes-mcp-server__resources_get` |
| **2. CLI via Bash** | No MCP covers it, but a standard CLI does | `kubectl`, `gh`, `az` |
| **3. Raw API via Bash** | No MCP, no standard CLI — direct HTTP call | `curl https://api.example.com/...` |

**MCP first** — always prefer MCP over equivalent shell commands.

---

## Installed MCP Servers (HSEOS standard)

| Server | Scope | Key operations |
|---|---|---|
| `mcp__github__*` | GitHub repos, PRs, issues | PR lifecycle, code search, branch ops |
| `mcp__kubernetes-mcp-server__*` | K8s cluster | Pod ops, resource CRUD, exec, logs |
| `mcp__argocd-mcp-server__*` | ArgoCD GitOps | App sync, resource tree, events |
| `mcp__azure-devops__*` | Azure DevOps | Work items, pipelines, repos, wiki |

---

## Spend Awareness Checklist

Before issuing high-volume MCP calls:
- [ ] Can one call return what multiple calls would? (batch/list over individual gets)
- [ ] Is the result cacheable in this session? Avoid re-fetching the same resource
- [ ] Are you in a loop? Add a loop guard (max iterations, stop condition)
- [ ] Pagination: request only the needed page size

---

## Rate Limit Signals

| Signal | Action |
|---|---|
| HTTP 429 / `rate limit exceeded` | Back off exponentially — wait 30s, then 60s, then escalate to user |
| HTTP 403 on GitHub | Check token scope — do not retry with same token |
| ArgoCD `sync already running` | Wait for current sync to finish; do not trigger parallel syncs |
| Azure DevOps `TF400898` | Request throttled — reduce batch size |

---

## Verdict

**Compliant** → MCP used where available, no unbounded loops, no redundant re-fetches.
**Violation** → Using `gh` CLI when `mcp__github__*` exists for the same operation, or issuing N+1 calls in a loop without pagination.
