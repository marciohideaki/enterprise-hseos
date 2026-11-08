# Deterministic-First Policy
**Status:** Mandatory (ADR-0052, accepted 2026-11-08)
**Scope:** All AI agent work, skills, workflows, hooks and the systems agents build
**Version:** 1.0

---

## 1. Purpose

Anything that can be decided or triggered by code **must** be decided or triggered by code. Model judgment
(LLM, agent) is reserved for what code cannot decide: interpretation, design, wording and the choice between
legitimate alternatives. Even then, the result passes a deterministic gate before it takes effect.

A rule that depends on a model remembering to apply it is a suggestion, not a control.

---

## 2. Rules

### DF-1 Events trigger effects
Recording, auditing, notification, state transitions, escalation and cleanup are triggered by an event, hook,
CI trigger or schedule. "The agent must remember to record / notify" is a design defect.

### DF-2 What is verifiable becomes a gate
Format, schema, policy, permission, allowlists, identifiers, hashes, counts, CI status and artifact presence are
decided by code that fails closed. A model's reading or assertion is never the decision.

### DF-3 Facts come from tools, not from generated text
Test counts, verdicts, commit SHAs, PR and deployment states are taken from real tool output. Generated text is
never the source of truth for a verifiable fact.

### DF-4 Mechanism preference order
1. Native platform event
2. Hook or gate supported by the tool or runtime
3. Versioned script or test
4. Instruction to the model (last resort)

### DF-5 Every directive declares its mechanism
Each new rule (constitution, policy, project `AGENTS.md`, skill, workflow) states how it is enforced
deterministically (hook, test, gate, schema). If it is not, it states `NOT DETERMINISTIC`, why, and the
compensating control (independent review, reconciliation, alert).

### DF-6 Exceptions are explicit and compensated
Where determinism is impossible or costs more than the risk, the exception is recorded in the plan or ADR with
its compensating control and owner. Silence is not an exception.

### DF-7 Non-determinism is never the last barrier
For irreversible or external effects (merge, deploy, publication, spend, credential handling) the final decision
passes a deterministic gate or a recorded human approval, never a model's judgment alone.

---

## 3. Applying the policy

| Situation | Non-compliant | Compliant |
|---|---|---|
| Conversation audit trail | An agent is told to log what it says | Platform events and runtime hooks emit every message to a recording service; two layers reconciled by message id |
| Test results in a report | The agent writes "all tests pass" | The report copies the runner's `N passed` line, or CI status is read from the forge API |
| Secret handling | "Never print the token" in a prompt | A guard writes the secret only when a fail-closed policy check passes; scanners run in CI |
| Cleanup after a job | "Remember to remove temp files" | A job-completed hook that cannot fail silently |

---

## 4. Enforcement

**NOT DETERMINISTIC** in v1.0 (behavioral). Compensating controls:
- DF-5 makes every new directive declare its own mechanism, which reviews check.
- Independent skeptical review (blind + confrontation) verifies DF-2 and DF-3 claims against tool output.

Planned deterministic enforcement (tracked in ADR-0052): a lint over policies, ADRs and plans that flags a rule
without an `Enforcement` statement.

---

## 5. References
- Enterprise Constitution §7 (Standards Enforcement), §8 (Agent Behavior Rules)
- `automated-validation.md`
- ADR-0052
