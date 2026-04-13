---
name: context-compression
tier: full
version: "1.0"
description: "Use when context window is approaching its limit, when resuming a long session, or when a session handoff needs to preserve maximum information in minimum tokens."
license: Apache-2.0
metadata:
  owner: platform-governance
---

# Context Compression — Full Protocol

> Tier 2: complete compression strategy catalogue with triggers, output formats, and session continuity rules.

---

## Core Principle

> Context window is a finite resource. Compression is not loss — it is curation. The goal is to retain decision-relevant information and discard reasoning artifacts.

Two failure modes exist:
- **Under-compression:** context becomes stale, bloated, and degrades response quality
- **Over-compression:** critical decisions or constraints are lost, causing regressions

---

## 1. Compression Triggers

| Trigger | Severity | Recommended Strategy |
|---|---|---|
| Responses becoming generic or less specific | Low | `summarize-recent` |
| Task switch after long implementation | Low | `compress-by-task` |
| Session handoff (HANDOFF.md creation) | Medium | `tree-structured` |
| Context window >70% used | Medium | `compress-by-task` or `summarize-recent` |
| Context window >90% used | High | `emergency-strip` |
| Active debugging with many failed attempts | Medium | `error-only` |
| Resuming a session cold | Any | Load L5 only, then L1–L3 fresh from files |
| Agent-to-agent handoff (ORBIT → GHOST) | Medium | `tree-structured` + task contract |

---

## 2. The Twelve Compression Strategies

### 2.1 `summarize-recent`
**Use when:** Session has grown long but task is continuous.
**Keep:** Last N decisions, current state, files actively modified, next step.
**Discard:** Exploratory dialogue, reasoning that led to discarded options, verbose command output.
**Output length:** 1–3 paragraphs.

---

### 2.2 `compress-by-task`
**Use when:** Multiple tasks completed; switching to a new task.
**Keep:** Per completed task — name, outcome (DONE/BLOCKED/DONE_WITH_CONCERNS), key decision, files changed.
**Discard:** Implementation detail of completed tasks — only outcomes matter.
**Output format:**
```
[TASK LOG]
✓ task-001 — DONE — Created AuthService; decision: JWT over sessions (ADR-0023)
✓ task-002 — DONE — Migrated user table; files: migrations/0042_user.sql
⚠ task-003 — DONE_WITH_CONCERNS — Tests skipped; concern: missing fixture
▶ task-004 — IN PROGRESS — Implement refresh token endpoint
```

---

### 2.3 `tree-structured`
**Use when:** Session handoff; creating HANDOFF.md; context must survive to next session.
**Keep:** Decision tree only — Problem → Options → Decision → Consequence → Status.
**Discard:** All implementation detail, exploratory dialogue, verbose outputs.
**Why:** Decisions are what must survive. Code is in git. Reasoning that was discarded is irrelevant.

---

### 2.4 `error-only`
**Use when:** Active debugging session with accumulated error history.
**Keep:** Current error message (exact text), current hypothesis, last 2 fix attempts and outcomes.
**Discard:** All previous errors, previous hypotheses, unrelated context.
**Critical:** Replace, do not accumulate. Stale errors poison reasoning.

---

### 2.5 `emergency-strip`
**Use when:** Context window >90% — immediate action required.
**Keep:** L1 rules reference (do not re-read, just note "CLAUDE.md loaded"), current task contract (acceptance criteria only), current error if in debug mode.
**Discard:** Everything else — L2, L3, L4 history, all conversation.
**After strip:** Reload L2 and L3 from source files — they are authoritative and current.

---

### 2.6 `decision-log`
**Use when:** Long architecture discussion or design session.
**Keep:** Each decision in format: `Decision: X | Rejected: Y (reason) | Consequence: Z`.
**Discard:** All discussion leading to the decision.

---

### 2.7 `checkpoint-snapshot`
**Use when:** Mid-task interruption; need to resume exactly where left off.
**Keep:** Exact line/file being edited, exact next action, any partial output.
**Discard:** Everything completed before the checkpoint.
**Output:** Feeds directly into SESSION-CHECKPOINT.md format.

---

### 2.8 `file-manifest`
**Use when:** Large L3 source load; need to track what was read.
**Keep:** List of files read + reason for each + key finding per file.
**Discard:** Full file content (it's in the files — re-read if needed).
**Format:** `{file} | {reason loaded} | {key finding}`

---

### 2.9 `multi-agent-relay`
**Use when:** Passing context from one agent to another (ORBIT → GHOST, CIPHER → GHOST).
**Keep:** Task contract (full), relevant ADR reference, governance constraints for this task.
**Discard:** Orchestration history, other agents' completed tasks, ORBIT's reasoning.
**Format:** Matches HandoffState structure in multi-agent-orchestration skill.

---

### 2.10 `spec-strip`
**Use when:** Spec/design phase complete; moving to implementation.
**Keep:** Acceptance criteria (verbatim), file list from output_contract, ADR reference.
**Discard:** Rationale, options considered, NFR elaboration — keep only what implementation requires.

---

### 2.11 `rolling-window`
**Use when:** Very long sessions where recency matters more than history.
**Keep:** Last K turns verbatim; everything older compressed to summary.
**K recommendation:** 5–8 turns for implementation; 3–5 turns for debugging.
**Discard:** Turns older than K (after summarizing decisions from them).

---

### 2.12 `semantic-dedup`
**Use when:** Same information appears multiple times (e.g., same error repeated, same rule re-stated).
**Keep:** First authoritative occurrence.
**Discard:** All repetitions.
**Why:** LLMs over-weight repeated information. Dedup restores proportional attention.

---

## 3. What to ALWAYS Preserve (Inviolable)

Regardless of which strategy is applied, these are NEVER compressed away:

- Any unresolved BLOCKED state and the reason it is blocked
- Open questions requiring human resolution (from Stop Conditions)
- Current task's acceptance criteria (verbatim — not summarized)
- ADR numbers referenced in this session
- Files with uncommitted changes (list, not content)
- Security constraints relevant to current work

---

## 4. Compression Output Format

All compression strategies produce output in this format:

```
[COMPRESSED — {strategy} — {YYYY-MM-DD HH:MM}]
Session type: {interactive | batch | agent-to-agent}
Agent mode: {read-only | write-safe | admin}

Completed tasks:
  {task log using compress-by-task format}

Current state:
  Task: {active task name}
  Status: {IN_PROGRESS | BLOCKED}
  Last action: {what was just done}
  Next action: {immediate next step}

Key decisions:
  - {decision 1 — brief}
  - {decision 2 — brief}

Files with changes:
  - {file list}

Open items:
  - {blocked items or questions}
```

---

## 5. Integration with Context Hierarchy

Compression operates on L4 and L5 only during active sessions:

| Level | Compression Rule |
|---|---|
| L1 — Rules | NEVER compress. Re-read from file if needed. |
| L2 — Spec | NEVER summarize. Re-read from spec.md if needed. |
| L3 — Source | NEVER summarize. Source files are authoritative. |
| L4 — Errors | Replace each iteration. `error-only` strategy applies here. |
| L5 — History | Primary compression target. All strategies apply here. |

---

## 6. Session Type Detection

Compression strategies differ by session type:

| Session Type | Signals | Best Strategy |
|---|---|---|
| **Interactive** | User typing; short turns; frequent clarifications | `summarize-recent`, `rolling-window` |
| **Batch** | Long autonomous task; few interruptions | `compress-by-task`, `checkpoint-snapshot` |
| **Agent-to-agent** | Receiving from ORBIT; outputting to another agent | `multi-agent-relay`, `tree-structured` |
| **Debug** | Many error/fix iterations | `error-only` |
| **Design** | Architecture discussion, ADR drafting | `decision-log` |
| **Resume** | Cold start from HANDOFF.md | `emergency-strip` then reload L1–L3 |

---

## Relationship to Other Skills

- `context-engineering` — L5 compression is the last level of the 5-level hierarchy
- `session-handoff` — `tree-structured` and `checkpoint-snapshot` feed HANDOFF.md
- `multi-agent-orchestration` — `multi-agent-relay` implements HandoffState protocol
- `verification-before-completion` — Gate 4 (no regressions) requires preserved task history
