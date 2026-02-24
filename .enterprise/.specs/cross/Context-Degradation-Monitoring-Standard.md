# Context Degradation Monitoring Standard

**Standard ID:** CE-DEG
**Version:** 1.0.0
**Scope:** All agent-driven workflows
**Applicability:** Mandatory for multi-turn agentic sessions and orchestration pipelines
**Authority:** Cross-Cutting

---

## Purpose

Context window degradation causes silent quality loss in long-running agent sessions. Without monitoring, agents produce increasingly unreliable outputs as context fills — with no visible error signal. This standard defines detection patterns and mitigation strategies.

---

## 1. Degradation Patterns (CE-DEG-01 to CE-DEG-10)

### CE-DEG-01 — Lost Thread
**Pattern:** Agent forgets earlier requirements, constraints, or decisions mid-session.
**Indicator:** Output contradicts a constraint that was explicitly established in the same session.
**Mitigation:** Summarize active constraints into a "session state" block before any multi-file operation.

### CE-DEG-02 — Instruction Dilution
**Pattern:** Early instructions lose effect as context fills with intermediate content.
**Indicator:** Later outputs ignore formatting rules, naming conventions, or standards that were stated early.
**Mitigation:** Re-anchor critical instructions at the start of each major task phase. Use a persistent instruction block.

### CE-DEG-03 — Reference Drift
**Pattern:** Agent refers to an outdated version of a decision, file, or requirement.
**Indicator:** Agent says "as we discussed" and refers to something that was subsequently revised.
**Mitigation:** Use explicit versioned checkpoints. Summarize "current state" at major decision points.

### CE-DEG-04 — Sycophantic Drift
**Pattern:** Agent progressively agrees with user framing rather than maintaining its standards.
**Indicator:** Quality gates that were enforced early in the session are silently dropped later.
**Mitigation:** Periodic re-assertion of non-negotiables. Use CLAUDE.md rules as fixed anchors.

### CE-DEG-05 — Context Contamination
**Pattern:** Large intermediate tool results (file reads, search outputs) crowd out active instructions.
**Indicator:** Agent stops applying standards it was applying before a large tool read.
**Mitigation:** Summarize large reads to key findings rather than raw content where possible.

### CE-DEG-06 — Hallucination Escalation
**Pattern:** As context fills, agent begins confabulating details not present in source.
**Indicator:** Agent states facts about the codebase that don't match actual files.
**Mitigation:** Re-read critical files when context is long. Do not rely on remembered file content in long sessions.

### CE-DEG-07 — Scope Creep via Context
**Pattern:** Agent incorporates adjacent context into the current task's scope.
**Indicator:** Agent modifies files or makes decisions not requested by the active task.
**Mitigation:** Define explicit task scope at session start. Use task isolation (subagents) for multi-task workflows.

### CE-DEG-08 — Repetition Injection
**Pattern:** Agent repeats content already in context (from previous turns), inflating context with low-value data.
**Indicator:** Long responses that restate what the user just said.
**Mitigation:** Instruct agents to reference prior context by pointer ("as established above"), not by re-quoting.

### CE-DEG-09 — Standard Bypass
**Pattern:** When context is full, agent defaults to simpler output that skips required sections.
**Indicator:** ADR outputs missing governance sections, PR reviews missing required gates.
**Mitigation:** Use structured templates as fixed output anchors. Validate completeness against template.

### CE-DEG-10 — Silent Truncation
**Pattern:** Agent answers a question but omits important caveats that would have been included in a fresh session.
**Indicator:** Outputs that are correct but incomplete, with no indication of what was omitted.
**Mitigation:** Prefer shorter, focused sessions over single sessions that span many tasks.

---

## 2. Context Usage Rules

- **CE-DEG-11:** Agents MUST use subagents (Task tool) for research tasks that would load large volumes of file content into the main context.
- **CE-DEG-12:** Tool reads MUST be targeted — read the specific sections needed, not entire large files.
- **CE-DEG-13:** Search results MUST be summarized to relevant findings before inclusion in reasoning.
- **CE-DEG-14:** For multi-phase tasks, agents SHOULD create structured checkpoints summarizing decisions made, not raw conversation history.
- **CE-DEG-15:** Sessions with more than 5 major tasks SHOULD be split into separate sessions with explicit handoff artifacts.

---

## 3. Detection Checklist

Before concluding a long-running session, verify:

- [ ] Agent still references constraints established at session start
- [ ] Output quality (detail, standards compliance) is comparable to session start
- [ ] No required governance sections were silently omitted in final outputs
- [ ] Files modified match the explicitly requested scope
- [ ] No "remembered" facts are used without re-verification from source

---

## 4. Escalation

If degradation patterns CE-DEG-01, CE-DEG-02, or CE-DEG-06 are detected:
1. STOP the session
2. Create a handoff summary capturing current state
3. Start a new session with that summary as context initialization

**End**
