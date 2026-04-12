---
name: context-policy
tier: full
version: "1.0"
description: "Use when designing stateless execution contracts, applying context compression strategies, or auditing context budget governance"
---

# Context Policy — Full Policy

> Tier 2: full context governance policy for HSEOS AI-assisted development.
> Source: AI-SDLC v1.0 §4 (Stateless Execution), §6 (Context Policy), §5 (Anti-patterns).

---

## 1. Why Context Governance Matters

LLM context windows are finite resources. As context fills, models exhibit:

- **Quality degradation** — less precise, shorter, less consistent outputs
- **Instruction drift** — early constraints and rules are "pushed back" and weighted less
- **Cost growth** — every token in context is paid on every call within that session
- **Non-determinism** — the same task produces different results at 20% vs 80% context

The AI-SDLC treats AI development as a distributed execution system, not a conversation. Context is a resource budget, not an infinite whiteboard.

---

## 2. Context Budget Policy

### 2.1 Thresholds

| Level | Range | Meaning |
|---|---|---|
| Ideal | 0%–40% | Full quality. All instructions and context fully weighted. |
| Warning | 40%–60% | Quality risk zone. Plan a session boundary at next task boundary. |
| Critical | > 60% | Quality likely degraded. Stop and resume from contract. |
| Blocked | > 60% (middleware enforced) | Execution rejected. Open new session. |

### 2.2 Enforcement today vs future

**Today (Guideline):** Claude Code does not expose context percentage to agents. Engineers and agents must self-monitor using the signals in §3 and the per-agent sizing rules in §4.

**Future (with LLM Middleware):** `policylayer-intercept` or equivalent middleware will enforce the 60% hard block and emit warnings at 40%. See `policy-layer` skill for middleware configuration reference.

---

## 3. Signals of Context Overrun

Apply these heuristics to estimate context health during a session:

| Signal | Implication |
|---|---|
| > 15 files read in session | Likely approaching 40%+ |
| Session spans > 3 distinct task groups | Context fragmentation; close soon |
| Output is shorter and less specific than earlier in session | Quality degradation in progress |
| Agent repeats earlier decisions without prompting | Context cycling — old content being re-summarized |
| Agent contradicts a rule established earlier in session | Instruction drift — rule pushed out of effective context |
| Task scope > 200 lines of new code | Will likely hit limit before task completes |
| Workflow phase count > 3 in one session | Resume from ORBIT state instead |

---

## 4. Sizing Rules per Agent

### GHOST — Code Executor

Maximum task size per session:
- **Small:** ≤ 100 lines new code + tests → safe for one session
- **Medium:** 100–200 lines → one session if no context already consumed
- **Large:** > 200 lines → **split into subtasks**, each with its own `input_contract`

Signs a story is too large: more than 4 files to create, more than 2 architectural layers touched, acceptance criteria covers > 3 distinct behaviors.

Split trigger: if RAZOR's story has > 6 tasks, evaluate whether any tasks should be separate stories.

### ORBIT — Flow Conductor

ORBIT's context is dominated by workflow state, not code. Rules:

- Always read state from `.hseos-output/<epic>/state.yaml` at session start
- Never rely on previous session conversation to know current workflow phase
- After Phase 5+ (GHOST execution loop), start a new session and load from state
- Do not attempt to run > 3 workflow phases in a single session

### CIPHER — Systems Architect

- One architecture document per session (spec.md OR design.md — not both)
- ADR drafts: one ADR per session
- Boundary checks: up to 3 services per session

### BLITZ — Solo Protocol

BLITZ compresses the pipeline. Context risk is highest here because multiple phases share one session. Compensating rules:

- Scope MUST fit in one session at session start — no expanding mid-session
- If scope grows beyond estimate, stop and switch to ORBIT + GHOST pipeline
- Maximum: 150 lines of new code + spec + tests in one BLITZ session

### All agents

The golden rule: **any task must be resumable from its `input_contract` alone.** If context is lost, the new session starts from the contract — not from "what we were doing before."

---

## 5. Session Resume Protocol

When context reaches Critical or a session must end mid-task:

**Step 1 — Save current state**
```
# For workflow tasks (ORBIT):
Write current phase + completed items to .hseos-output/<epic>/state.yaml

# For implementation tasks (GHOST):
Commit all completed work with clear commit message
Save partial task state to .specs/features/<name>/tasks.md (mark completed items)
```

**Step 2 — Document the resume point**
```
# In tasks.md, mark:
- [x] T1 — complete
- [ ] T2 — IN PROGRESS: completed steps 1-3, resume from step 4
         input_contract.files: [the specific files needed for step 4]
```

**Step 3 — Start new session from contract**
```
# New session prompt pattern:
"I am resuming task T2 from contract:
 Input: [list from input_contract]
 Already done: [steps 1-3]
 Next: [step 4 description]"
```

---

## 6. Anti-Patterns (AI-SDLC §5)

| Anti-pattern | Why it fails |
|---|---|
| Continuous chat development | Context grows unbounded; early instructions degrade |
| Multi-task in same context | Tasks contaminate each other; non-deterministic outputs |
| Passing context via conversation history | Session dependency — unresumable if session dies |
| Sending full codebase as context | Wasteful; pushes relevant instructions out of effective range |
| Implementing without `input_contract` | No clear scope boundary; task creep common |
| Never closing sessions | Compounding quality degradation across all tasks in the session |

---

## 7. Future: LLM Middleware Enforcement

When `policylayer-intercept` or equivalent middleware is configured with token/context tracking:

```yaml
# policy.yaml — context enforcement
"*":
  rules:
    - name: "context-budget-warning"
      action: evaluate
      conditions:
        - path: "state.context_usage_pct"
          op: "gt"
          value: 40
      on_deny: "[CONTEXT WARNING] Session at 40%+ context. Finish current task and start new session."

    - name: "context-budget-block"
      action: deny
      conditions:
        - path: "state.context_usage_pct"
          op: "gt"
          value: 60
      on_deny: "[CONTEXT BLOCKED] Session exceeded 60% context budget. Save state and open new session."
```

Until middleware is available, these thresholds are guidelines enforced by engineering discipline.
