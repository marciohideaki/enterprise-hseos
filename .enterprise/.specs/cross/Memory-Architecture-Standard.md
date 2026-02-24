# Memory Architecture Standard

**Standard ID:** CE-MEM
**Version:** 1.0.0
**Scope:** Agentic systems, AI-assisted workflows, multi-session agent pipelines
**Applicability:** Mandatory when designing or implementing agent memory strategies
**Authority:** Cross-Cutting

---

## Purpose

Memory architecture determines what an agent "knows" and when. Poor memory design leads to context overflow, repeated work, inconsistent state, and brittle handoffs between sessions. This standard defines the four memory types and governs their use.

---

## 1. The Four Memory Types

### Type 1 — In-Context Memory (Working Memory)

**What it is:** Information present in the active context window — tool results, conversation history, loaded files, instructions.

**Characteristics:**
- Immediately available; zero retrieval cost
- Finite — degrades performance as it fills (see Context-Degradation-Monitoring-Standard)
- Ephemeral — lost when session ends
- Not shareable between sessions or agents

**Rules:**
- **CE-MEM-01:** In-context memory MUST be treated as a scarce, finite resource.
- **CE-MEM-02:** Only load what is actively needed for the current task step.
- **CE-MEM-03:** Completed task context MUST NOT be kept in working memory if it can be summarized to external memory.

---

### Type 2 — External Memory (Persistent Storage)

**What it is:** Information stored outside the context window: files, databases, documents, knowledge bases, task lists.

**Characteristics:**
- Durable — persists across sessions
- Unlimited capacity
- Retrieval cost: requires explicit tool call
- Shareable across sessions and agents

**Rules:**
- **CE-MEM-04:** Decisions, completed artifacts, and architectural context MUST be written to external memory (repo files, ADRs, task artifacts).
- **CE-MEM-05:** External memory artifacts MUST be versioned and traceable (git-committed, dated).
- **CE-MEM-06:** Agents MUST NOT assume in-context facts persist across sessions — re-read from external memory at session start.
- **CE-MEM-07:** Long-lived context (architecture decisions, non-negotiables, standards) belongs in external memory, not repeated in every context window.

---

### Type 3 — Cached Memory (Prompt Caching)

**What it is:** Frequently-used context pre-loaded via prompt caching mechanisms (Anthropic prompt cache, system prompt injection).

**Characteristics:**
- Fast retrieval; lower token cost on cache hit
- Suitable for stable, reusable context (standards, personas, invariants)
- Not suitable for volatile or session-specific content

**Rules:**
- **CE-MEM-08:** Stable governance documents (CLAUDE.md, constitution, core standards) SHOULD be candidates for cached memory.
- **CE-MEM-09:** Cached memory MUST be versioned — cache invalidation required on document update.
- **CE-MEM-10:** Agent personas and behavioral rules are high-priority candidates for cached memory.

---

### Type 4 — Computed Memory (Derived Artifacts)

**What it is:** Artifacts generated from other memory types: summaries, indexes, embeddings, distillations.

**Characteristics:**
- Reduces retrieval cost by pre-processing large information sets
- Must be regenerated when source changes
- Trade-off: computation cost vs. retrieval efficiency

**Rules:**
- **CE-MEM-11:** Large documentation sets MUST have computed indexes (e.g., `_INDEX.md`) to avoid full-content scans.
- **CE-MEM-12:** Session summaries (handoffs between sessions) are computed memory — MUST be created at session end when state needs to persist.
- **CE-MEM-13:** Computed summaries MUST reference their source and generation date to avoid stale-data confusion.

---

## 2. Memory Selection Rules

| Information Type | Primary Memory | Secondary |
|---|---|---|
| Active task context | In-context | — |
| Completed artifacts | External (files) | — |
| Architectural decisions | External (ADRs) | — |
| Session handoff state | External (handoff doc) | — |
| Governance standards | Cached | External |
| Agent personas | Cached | External |
| Large doc corpus | Computed index + External | — |
| Real-time tool results | In-context (summarized) | — |

---

## 3. Handoff Protocol

When a session must end with work in progress:

1. **Write a handoff artifact** to external memory containing:
   - Tasks completed (with artifact references)
   - Tasks in progress (with current state)
   - Tasks pending (with dependencies)
   - Active decisions and constraints
   - Next step for the continuing session

2. **Format:** Named file in `.enterprise/sessions/YYYY-MM-DD-<topic>-handoff.md`

3. **Next session opens** by reading the handoff artifact as first action.

---

## 4. Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Loading entire files when only sections needed | Wastes context budget; triggers degradation faster |
| Relying on "memory" of prior sessions without re-reading | Prior context is gone; hallucination risk |
| Long single-session workflows covering many unrelated tasks | Maximizes degradation risk; no isolation |
| Keeping completed task context in working memory | Crowds out active task; no benefit |
| Duplicating governance docs in every context instead of referencing | Unsustainable; version drift |

**End**
