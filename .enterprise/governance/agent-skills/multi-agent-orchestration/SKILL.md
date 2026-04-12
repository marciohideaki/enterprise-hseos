---
name: multi-agent-orchestration
tier: full
version: "1.0"
description: "Use when designing complex multi-agent workflows, ORBIT dispatch chains, orchestration patterns, or reviewing agent coordination architecture"
---

# Multi-Agent Orchestration — Full Patterns Reference

> Tier 2: Full pattern definitions, implementation guidance, and anti-patterns.
> Source: AgenticDesignPatterns (Gulli, 2024) — Chapters 1–7, 11–13, 15, 20.
> For quick selection, use SKILL-QUICK.md (Tier 1).

---

## 1. Core Patterns

### 1.1 Sequential Chain (Chapter 1 — Prompt Chaining)

**What it is:** Each agent/step receives the output of the previous one. Strict linear execution.

**Use when:**
- Steps have data dependencies
- Order of operations matters for correctness
- Each step transforms or enriches the artifact

**ORBIT implementation:**
```
Phase 1: [FORGE] Build → artifact: build-report
Phase 2: [RAZOR] Review → artifact: review-approval (requires build-report)
Phase 3: [KUBE] Deploy → artifact: deployment-record (requires review-approval)
```

**Stop condition:** Gate fails at any phase → stop; surface missing artifact; do not advance.

---

### 1.2 Parallel Fan-Out (Chapter 3 — Parallelization)

**What it is:** Multiple agents work independently on separate tasks. ORBIT collects all results before proceeding.

**Use when:**
- Tasks are independent (no shared state, no ordering requirement)
- Latency reduction is a priority
- Results will be merged into a single artifact

**ORBIT implementation:**
```
Fan-out:
  - [CIPHER] Security scan → artifact: security-report
  - [RAZOR]  Code review   → artifact: review-checklist
  - [BLITZ]  Perf profile  → artifact: perf-baseline
Collect: wait for all 3; aggregate into delivery-readiness report
```

**Guard:** Cap parallel agents at 5. Beyond this, use Map-Reduce with sequential batches.

---

### 1.3 Map-Reduce (Chapter 3 — Parallelization variant)

**What it is:** Same task applied to N items (map phase); results combined into one output (reduce phase).

**Use when:**
- Large number of homogeneous items (e.g., reviewing 20 microservices)
- Each item is independent
- Final output requires aggregation across all items

**ORBIT implementation:**
```
Map:    For each service in services[:MAX]:
          [RAZOR] review(service) → review_{service}
Reduce: aggregate(review_0..N) → consolidated-review-report
```

**Guard:** MAX = 10 per batch; add 2s pause between batches; log batch progress.

---

### 1.4 Critic Loop (Chapter 4 — Reflection)

**What it is:** Generator agent produces output; Critic agent evaluates it; loop continues until acceptance criteria met.

**Use when:**
- Output quality is uncertain
- Iterative refinement improves results
- Acceptance criteria can be formally defined

**ORBIT implementation:**
```
iteration = 0
while iteration < MAX_ITERATIONS:
    output = generator_agent(task)
    verdict = critic_agent(output, criteria)
    if verdict == PASS: break
    iteration += 1
if iteration == MAX_ITERATIONS: escalate_to_user("Max iterations reached; manual review required")
```

**Guard:** MAX_ITERATIONS = 3 (default). Escalate, never silently degrade acceptance criteria.

---

### 1.5 Routing (Chapter 2 — Routing)

**What it is:** Input is classified; routed to the appropriate specialist agent.

**Use when:**
- Input type is variable (bug vs feature vs security vs doc)
- Different agents own different input types
- Classification is deterministic or low-ambiguity

**ORBIT implementation:**
```
input_type = classify(input)
match input_type:
  "security"    → CIPHER
  "performance" → BLITZ
  "bug"         → GLITCH
  "architecture"→ RAZOR + ADR workflow
  "deployment"  → KUBE
  _             → escalate_to_user("Unrecognized input type; classify manually")
```

---

### 1.6 Human-in-the-Loop (Chapter 13 — Human-in-the-Loop)

**What it is:** Workflow pauses at a defined gate; presents structured request to user; resumes on explicit approval.

**Use when:**
- Decision has irreversible consequences (deploy to production, schema migration)
- Ambiguity cannot be resolved autonomously
- Compliance or governance requires human sign-off

**ORBIT implementation:**
```
[GATE] Production deploy approval
Required action: User must confirm:
  - Service: {service}
  - Image: {image_tag}
  - Environment: production
  - Blast radius: {affected_endpoints}
Type "APPROVE" to proceed or "ABORT" to cancel.
```

**ORBIT never auto-approves Human-in-the-Loop gates.**

---

## 2. Memory and State Management (Chapter 8)

| State type | Scope | Use for |
|---|---|---|
| In-session context | Current session only | Intermediate artifacts, step outputs |
| Persisted state | Cross-session | Workflow resume, long-running deliveries |
| Shared state | Cross-agent | Only via explicit hand-off artifact; never implicit |

**Rules:**
- ORBIT maintains workflow state in `.hseos-output/<workflow>/<run-id>/state.yaml`
- Agents read state at start of their phase; write outputs at phase end
- Never pass raw LLM output as state — always structure into a typed artifact

---

## 3. Goal Setting and Monitoring (Chapter 11)

Every workflow initiated by ORBIT must define:

```yaml
goal:
  objective: "Deploy v1.2.0 to production"
  success_criteria:
    - "ArgoCD app status = Healthy"
    - "Zero new error logs in 5 minutes post-deploy"
    - "Smoke test suite passes"
  stop_conditions:
    - "Error rate > baseline by 10%"
    - "Manual ABORT received"
  timeout_minutes: 30
```

ORBIT monitors criteria and stop conditions throughout the workflow. Reports status at each phase boundary.

---

## 4. Exception Handling and Recovery (Chapter 12)

| Failure type | Recovery strategy |
|---|---|
| Transient (timeout, rate limit) | Retry with backoff (max 3); continue |
| Agent output invalid | Trigger Critic Loop (max 2 iterations); escalate if unresolved |
| Gate failure (missing artifact) | Stop; surface preparation guidance; do not advance |
| Unrecoverable (infra down, auth failure) | Stop workflow; preserve state; report to user |

**Fallback chain:** retry → degrade gracefully → escalate → stop with state preserved.

---

## 5. Inter-Agent Communication (Chapter 15)

### A2A (Agent-to-Agent) Protocol

When `claude-peers` MCP is available, ORBIT can coordinate cross-session:

```
ORBIT (session A) → claude-peers → KUBE (session B)
  message: { type: "task", payload: { workflow_phase: "deploy", artifact: "image:v1.2.0" } }

KUBE (session B) → claude-peers → ORBIT (session A)
  message: { type: "result", payload: { status: "deployed", argocd_app: "healthy" } }
```

Without `claude-peers`: Use sequential hand-off via shared workflow state file.

---

## 6. Subagent-Driven Development Pattern

For epic delivery, ORBIT should dispatch fresh subagents per task rather than accumulating context in a single long-running session.

### Context Isolation Model
```
ORBIT (controller)
  ├── Extracts ALL tasks upfront from plan
  ├── Dispatches GHOST (implementer) per task — fresh context, full task text
  │     └── GHOST → GLITCH (regression review) → ORBIT (spec review) → DONE
  └── Only dispatches next task after current is fully complete and reviewed
```

### Implementer Dispatch Template
When ORBIT dispatches GHOST for a task:
```
Task: <full task text, not a file reference>
Input artifacts: <list of files to read>
Acceptance criteria: <exactly what DONE looks like>
Constraints: <what must not be changed>
Known complications: <from previous agents>
Return format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
```

### Dev↔Validation Loop
- GHOST implements → GLITCH validates → pass/fail
- If fail: GHOST retries (max 2 more attempts = 3 total)
- If 3rd failure: escalate to CIPHER (architectural issue) or human (trade-off decision)
- See `escalation-rules.md §5`

---

## 7. Reality Checker Gate

Before any phase gate that promotes work to the next phase (e.g., dev → staging, staging → prod), GLITCH operates in "Reality Checker" mode:

**Reality Checker Questions:**
1. Does the evidence actually prove the success criteria, or does it assume them?
2. What could still be wrong that the tests don't cover?
3. Are there any presuppositions in the spec that weren't validated?
4. If this is wrong, what's the worst-case impact?

**Gate format:**
```
REALITY CHECK — Phase Gate: <phase-name>
Evidence reviewed: [list]
Confirmed: [what is proven]
Unconfirmed: [what is assumed, not proven]
Risk: [worst case if assumption is wrong]
Verdict: PASS | CONDITIONAL_PASS (with stated condition) | FAIL
```

ORBIT does NOT advance to next phase if Reality Checker returns FAIL.

---

## 8. Anti-Patterns (never do)

| Anti-pattern | Why it fails |
|---|---|
| ORBIT absorbs specialist authority | Violates bounded expertise; produces incorrect outputs |
| Advancing past a failed gate | Creates invalid delivery state; downstream phases built on bad assumptions |
| Unbounded retry loops | Can run indefinitely; masks root cause |
| Implicit shared state between agents | Race conditions; non-deterministic results |
| Auto-approving HITL gates | Bypasses governance; creates audit liability |
| Fan-out > 5 agents without batching | Rate limits, context overflow, hard to debug |
| Dispatcher keeping task context in memory | Context bloat; use shared state file instead |
| Skipping Reality Checker at phase gates | Assumptions ship to production |
