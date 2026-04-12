# Engineering Playbook

**Version:** 1.0

## Purpose
Operational guide for applying standards.

## Topics
- Creating a new service
- Adding a use case
- Publishing events
- Versioning APIs
- Handling exceptions

## Eval-First Loop

Before implementing any significant feature or change, define observable success criteria first — not after. This pattern (inspired by AgenticDesignPatterns Chapter 19) prevents "done but broken" delivery.

### Protocol

1. **Define Evals** — what does success look like? Write it down before coding.
   - Capability eval: "The service returns 404 for non-existent resources with `{error: 'not_found'}` body"
   - Regression eval: "Existing endpoints still return 200 with same response shape"

2. **Capture Baseline** — run current state, record what passes and what fails.

3. **Implement** — write code to make the capability evals pass.

4. **Re-run Evals** — compare against baseline.
   - New capability evals: should pass
   - Regression evals: should still pass
   - Delta failures: investigate before merging

### When to Apply
- New features or user-facing behavior changes
- Performance-affecting refactors
- Changes to integration contracts (APIs, events)

### Relationship to Test Coverage
This is not a replacement for the test-coverage skill — it's a planning protocol. Evals inform what tests to write. Tests are the executable form of evals.

---

## Subagent-Driven Development

For epic delivery with multiple parallel tasks, ORBIT dispatches fresh subagents per task rather than accumulating context in a single long-running session.

### Benefits
- Context isolation: each implementer has clean context for its task
- Parallelism: independent tasks execute concurrently in worktrees
- Quality: two-stage review per task (spec compliance → code quality)

### Protocol
1. Controller (ORBIT) extracts ALL tasks upfront from plan
2. For each task: dispatch fresh implementer (GHOST) with full task text
3. Implementer runs → two-stage review (GLITCH for regression, ORBIT for spec) → mark complete
4. Controller does not dispatch parallel implementers for dependent tasks

### Implementer Status Values
- `DONE` — all gates passed
- `DONE_WITH_CONCERNS` — passed with noted concern
- `NEEDS_CONTEXT` — requires additional information
- `BLOCKED` — escalate to ORBIT/human

### Reference
See `.enterprise/governance/agent-skills/verification-before-completion/SKILL-QUICK.md` for gate definitions.

---

## Scope Lock — One Step at a Time

The most expensive AI coding failure is doing 40% of five things instead of 100% of one. Scope Lock prevents this.

### Rules

1. **One step at a time.** Step N+1 does not start until Step N is deployed, reviewed, and logged.
2. **Out-of-scope items go to Known Gaps — not the current step.** If work is discovered that wasn't in the current brief/story, log it with a `KG-N` identifier and stop. Do not expand scope.
3. **No speculative additions.** Features, helpers, or improvements not explicitly requested are out of scope by definition.

### Known Gaps Protocol

When out-of-scope work is discovered during implementation:

```
Known Gap KG-{N}: {title}
Discovered by: {agent} during: {step or task}
Description: {what was found}
Impact: {what breaks or degrades if not addressed}
Priority: {High / Medium / Low}
```

Known Gaps are logged in the active story file or `HANDOFF.md` under `## Known Gaps`. They become explicit backlog items — not forgotten technical debt.

### Why This Matters

Scope creep during AI-assisted development is silent and fast. An implementer that "fixes a few things while I'm here" destroys traceability, introduces untested changes, and makes review impossible. Scope Lock makes the boundary explicit and enforced.

---

## Summary
This playbook explains *how* to apply existing standards.
