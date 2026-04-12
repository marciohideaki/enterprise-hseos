---
name: inter-agent-comms
tier: quick
version: "1.0"
description: "Use when designing or implementing communication protocols between two or more agents in a workflow"
---

# Inter-Agent Communication — Quick Reference

> Tier 1: use when ORBIT needs to coordinate between active agent sessions, or when designing cross-agent workflows.
> Load SKILL.md (Tier 2) for full A2A protocol, message schema, and troubleshooting.

---

## Communication Methods

| Method | Latency | Use case | Requires |
|---|---|---|---|
| **Sequential hand-off** | Async (next session) | One agent finishes; next picks up from artifact | Shared workflow state file |
| **Shared state file** | Async | Long-running workflows; resume across sessions | `.hseos-output/<workflow>/state.yaml` |
| **claude-peers MCP** | Real-time | Live coordination between active sessions | `claude-peers` MCP server installed |

---

## claude-peers MCP — When to Use

Use `claude-peers` when:
- Two or more agent sessions are **simultaneously active** (e.g., ORBIT orchestrating while KUBE deploys)
- You need to pass results back in real-time without ending a session
- A blocking gate requires confirmation from another session

**Check availability first:**
```
mcp__claude-peers__list_sessions → lists active peer sessions
```
If not available → fall back to shared state file hand-off.

---

## Standard Hand-Off Pattern (no claude-peers)

```
ORBIT writes:  .hseos-output/<run-id>/phase-<N>-output.yaml
  contents:
    phase: deploy
    status: complete
    artifact: { service: api, image: registry/api:v1.2.0, env: staging }

KUBE reads:   .hseos-output/<run-id>/phase-<N>-output.yaml
              validates artifact exists and is well-formed
              proceeds with deployment
```

---

## Message Types (with claude-peers)

| Type | Direction | Payload |
|---|---|---|
| `task` | ORBIT → Specialist | `{ workflow_phase, artifact, context }` |
| `result` | Specialist → ORBIT | `{ status: success|failure, artifact, errors }` |
| `gate_request` | ORBIT → User/Agent | `{ gate_id, required_action, timeout_minutes }` |
| `gate_response` | User/Agent → ORBIT | `{ gate_id, decision: APPROVE|ABORT, evidence }` |

---

## Constraints

- Never assume a peer session is available — always check before sending
- Never block indefinitely waiting for a peer — set timeout (default: 5 minutes)
- Sensitive artifacts (tokens, secrets) must NOT be transmitted via inter-agent messages
- All cross-session communication must be logged in workflow state
