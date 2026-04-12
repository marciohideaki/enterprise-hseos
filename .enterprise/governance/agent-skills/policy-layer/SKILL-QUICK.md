---
name: policy-layer
tier: quick
version: "1.0"
description: "Use when enforcing or auditing policy-layer intercepts for agent tool calls or reviewing tool call governance"
---

# Policy Layer — Quick Reference

> Tier 1: use when SABLE is auditing AI agent governance, configuring spend controls, or enforcing tool access policies.
> Load SKILL.md (Tier 2) for full policy specification, configuration reference, and compliance checklist.

---

## What the Policy Layer Governs

| Dimension | What it controls |
|---|---|
| **Spend caps** | Maximum cost per agent session / per day |
| **Rate limits** | Maximum MCP/API calls per minute per agent |
| **Tool access** | Which tools each agent role is allowed to call |
| **Tool hiding** | Tools visible in some sessions but hidden in others (role-based) |
| **Audit trail** | Log of all tool calls, costs, and rejections |

---

## SABLE's Policy Audit Checklist

When auditing AI agent governance for a project:

**Spend Controls**
- [ ] Is there a daily spend cap defined per agent or per project?
- [ ] Are sessions time-bounded (e.g., max 60 minutes per autonomous session)?
- [ ] Is cost tracked per agent role (ORBIT, KUBE, FORGE, etc.)?

**Rate Limiting**
- [ ] Are external API call rates capped? (GitHub, Azure DevOps, Kubernetes)
- [ ] Is there backoff logic for 429 responses?
- [ ] Are bulk operations batched to avoid burst limits?

**Tool Access (Least Privilege)**
- [ ] Does each agent have access only to the tools it needs?
- [ ] Are destructive tools (delete, force-push, drop-table) restricted to specific roles?
- [ ] Is tool access documented in `.claude/settings.json` or equivalent?

**Audit Trail**
- [ ] Are agent actions logged with timestamp, agent ID, and tool called?
- [ ] Are failed/rejected tool calls logged?
- [ ] Is there a retention policy for agent audit logs?

---

## Tool Access Matrix (HSEOS reference)

| Tool category | ORBIT | KUBE | FORGE | RAZOR | SABLE | CIPHER |
|---|---|---|---|---|---|---|
| Read files/code | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Write files | ✓ (workflow state only) | ✓ (manifests) | ✓ (pipeline configs) | ✗ | ✗ | ✗ |
| kubectl / K8s MCP | ✗ (delegate to KUBE) | ✓ | ✗ | ✗ | ✓ (read-only) | ✗ |
| GitHub MCP (write) | ✗ | ✓ (GitOps PRs) | ✓ (pipeline PRs) | ✓ (review only) | ✗ | ✗ |
| Delete / destructive | ✗ | Requires HITL gate | Requires HITL gate | ✗ | ✗ | ✗ |

---

## Escalate to SABLE when

- An agent requests access outside its column in the Tool Access Matrix
- Spend cap is approaching or exceeded
- A destructive operation is proposed without a HITL gate
- Audit logs are missing for a completed workflow
