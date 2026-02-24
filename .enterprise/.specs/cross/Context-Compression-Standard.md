# Context Compression Standard

**Standard ID:** CE-COMP
**Version:** 1.0.0
**Scope:** All agent-driven workflows where context budget is a constraint
**Applicability:** Mandatory for long-running sessions; recommended for all sessions exceeding 5 turns
**Authority:** Cross-Cutting

---

## Purpose

Compression is the discipline of reducing context volume while preserving semantic density. It is not summarization for the sake of brevity — it is precision removal: eliminating what the agent doesn't need now without losing what it will need later.

---

## 1. Compression Principles

### CE-COMP-01 — Preserve Decisions, Compress Reasoning

The reasoning path that led to a decision is low-value after the decision is made. The decision itself is high-value.

**Compress:** "After reviewing options A, B, and C, considering the trade-offs of each..."
**Keep:** "Decision: Use option B. Rationale: lower blast radius."

### CE-COMP-02 — Reference, Don't Repeat

Content that is already in external memory (a file, an ADR, a standard) MUST be referenced by pointer, not re-quoted into context.

**Compress:** [pasting 200 lines of the Security Standard into context]
**Keep:** "Apply Security & Identity Standard (`.enterprise/.specs/cross/Security & Identity Standard.md`)."

### CE-COMP-03 — State Not History

For multi-turn tasks, preserve the current state, not the history of how you got there.

**Compress:** [entire conversation thread about implementation approach]
**Keep:** "Current state: authentication module refactored to use OIDC. Remaining: token refresh logic. Blocked by: no spec for refresh token rotation policy."

### CE-COMP-04 — Exceptions, Not Rules

When a standard is being applied correctly, it doesn't need to be in context. Only deviations and exceptions need representation.

**Compress:** "The following 47 rules from the naming standard apply..."
**Keep:** "Exception to naming standard: legacy field `userId` retained for BC compatibility per ADR-007."

---

## 2. Compression Techniques

### 2.1 — Task Checkpoint Summary

At the end of each major task phase, compress the work done into a checkpoint:

```markdown
## Checkpoint — [Phase Name] — [Date]

**Completed:**
- [Artifact 1]: [file path or description]
- [Artifact 2]: [file path or description]

**Decisions Made:**
- [Decision]: [rationale] [reference if applicable]

**Active Constraints:**
- [Constraint 1]: [source]

**Next Phase:** [what comes next and its inputs]
```

This checkpoint replaces the raw conversation history for that phase. It fits in ~20 lines vs. potentially hundreds of lines of discussion.

### 2.2 — Tool Result Compression

When a tool returns a large result, compress to relevant findings before including in further reasoning:

**Raw result (1000 lines of search output):**
→ **Compressed:** "Search found 3 files touching auth logic: `src/auth/middleware.ts:45`, `src/auth/token.ts:12`, `tests/auth/middleware.spec.ts:89`. No direct dependencies in other services."

**Rule CE-COMP-05:** Tool results that exceed 50 lines MUST be summarized to key findings before being used in multi-step reasoning.

### 2.3 — Conversation Distillation

For long conversations, distill to:
1. **Agreed requirements** (bullet list, no prose)
2. **Active constraints** (bullet list with source reference)
3. **Deferred items** (parking lot — not forgotten, not in context)

**Rule CE-COMP-06:** Sessions exceeding 20 turns SHOULD produce a distillation checkpoint to replace prior conversation history.

### 2.4 — Progressive Summarization

For ongoing projects, maintain a rolling summary document:

```markdown
## Project State — [date]

### What's Built
[2-3 bullet points max]

### What's In Progress
[current task, owner, blockers]

### What's Decided (with ADR refs)
[key decisions as 1-liners with references]

### What's Deferred
[parking lot items with reason for deferral]
```

**Rule CE-COMP-07:** Long-running projects MUST maintain a project state document in external memory, updated at each session end.

---

## 3. Compression Quality Rules

- **CE-COMP-08:** Compression MUST preserve all actionable information — if an item would change an agent's behavior, it MUST survive compression.
- **CE-COMP-09:** Compression MUST NOT introduce ambiguity — if precise wording matters (a constraint, a non-negotiable), the exact wording must be preserved or referenced.
- **CE-COMP-10:** Compressed summaries MUST reference their source — do not compress without noting what was compressed and where the original is.
- **CE-COMP-11:** Compression MUST NOT remove constraints silently — if a constraint is removed from context, it MUST be written to external memory first.

---

## 4. When NOT to Compress

- **CE-COMP-12:** Do NOT compress legal/compliance language — preserve exact wording.
- **CE-COMP-13:** Do NOT compress security invariants — if a security rule applies, quote it exactly, don't paraphrase.
- **CE-COMP-14:** Do NOT compress ADR decisions in flight — wait until the ADR is finalized before compressing the decision discussion.
- **CE-COMP-15:** Do NOT compress code that is actively being modified — keep it in context until the modification is complete and tested.

---

## 5. Compression vs. Loss Spectrum

| Operation | Correct Classification |
|---|---|
| Removing completed-task reasoning | Compression — value-neutral removal |
| Removing a constraint that still applies | LOSS — forbidden without external storage |
| Replacing 200 lines of pasted doc with a reference | Compression |
| Summarizing "the PR looks good" to nothing | Compression |
| Summarizing "do not use MD5 for passwords" to nothing | LOSS — constraint must survive |
| Replacing file content with "file exists" | LOSS — agent can't act without content |

**End**
