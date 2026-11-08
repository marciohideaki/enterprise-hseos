# ADR-0052 — Deterministic-first policy

**Status:** Accepted (2026-11-08, by the owner as Engineering Leadership).
**Date:** 2026-11-07
**Authors:** Platform Architecture Owners (proposal requested by the owner)
**Affects Standards:** New policy `.enterprise/policies/deterministic-first.md` (v1.0); `policies/README.md` index
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

Several controls in the agent environment were written as instructions to the model and were bypassed by habit
or omission: temporary files written to `/tmp` despite a convention (later enforced by a hook), behavioral rules
with no enforcement, and reports whose facts were asserted rather than copied from tools. In the `pantheon-forge`
Dark Software Factory, the conversation audit trail was first sketched as something an agent would do; the owner
asked instead for every message to be emitted deterministically to a service. The owner then asked that this be
a global rule: whatever can be deterministic must be.

## Decision

We will adopt `policies/deterministic-first.md` (rules DF-1 to DF-7):

1. Effects such as recording, notification, state transitions and cleanup are triggered by events, hooks, CI or
   schedules, not by a model remembering to act.
2. Verifiable decisions are fail-closed gates in code.
3. Verifiable facts are copied from tool output.
4. Mechanisms are chosen in the order: native platform event, supported hook or gate, versioned script or test,
   instruction to the model.
5. Every directive declares its deterministic mechanism, or states `NOT DETERMINISTIC` with a compensating control.
6. Exceptions are recorded with a compensating control and an owner.
7. Irreversible or external effects never rest on model judgment alone.

The Constitution is not changed by this ADR. A later amendment may reference the policy from §7 or §8 under §13
change control.

## Consequences

### Positive
- Controls stop depending on a model's memory or compliance.
- Audit and reporting become reproducible from tool output.
- New directives carry their enforcement with them.

### Negative / Trade-offs
- Building hooks, gates and event pipelines costs more up front than writing an instruction.
- Some rules remain behavioral; DF-5 makes that visible instead of hiding it.

### Risks
- The policy itself is behavioral in v1.0. Mitigation: DF-5 review plus a planned lint that flags rules without an
  `Enforcement` statement.
- Over-engineering of low-risk steps. Mitigation: DF-6 allows recorded exceptions when determinism costs more
  than the risk.

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| `policies/deterministic-first.md` | DF-1..DF-7 | New |
| `policies/README.md` | Documents table | Extends |

## Compliance

- [x] Approved by Engineering Leadership (owner, 2026-11-08)
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [x] Activation date: 2026-11-08
- [ ] Review date: 2027-05-07

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep relying on per-rule instructions | Repeatedly bypassed; no way to tell an applied rule from an ignored one |
| Amend the Constitution directly | Heavier change control (§13); a policy can be adopted and measured first |
| Enforce only through hooks, no policy | Hooks cover a few commands; the principle must also guide design of systems agents build |
