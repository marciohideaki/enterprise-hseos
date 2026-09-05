# PCCP Governance State

Status: technically validated; ADR accepted (2026-09-05); schema 2.0/intake v3 activation still pending

Current mini-goal: complete the audited handoff of the additive PCCP candidate without
activating normative state.

Completed checkpoints:

- `state/checkpoints/01-authority-and-compatibility.md`
- `state/checkpoints/02-implementation-and-validation.md`
- `state/checkpoints/03-completion-audit.md`

The owner selected the JVM projection migration to `Package.role=projection`. The candidate schema
and validator now preserve the legacy Module as a deprecated migration tombstone and permit only
that narrowly evidenced cross-type `SUPERSEDES`. Backend Wave 1 and JVM content are consolidated in
one candidate fragment; the separate overlay was removed.

ADR-0036 was accepted by the Platform Architecture Owner on 2026-09-05 (PR #168). The proposal
and its taxonomy are the target design; the checkpoints above are ported into this repository
at `.enterprise/.specs/decisions/ADR-0036-platform-capability-contract-pattern.md`.

Remaining pending gates: activate graph schema 2.0 and intake v3 (separate approval, still
open); reconcile EventEnvelope and Unit of Work in one immutable Platform Core schema 2.0
fragment; review and pin the Backend candidate; repair or govern the unreachable registered
Cambio fragment revision (cross-repo access to `cambio-real-v2`, `backend-core` and
`platform-core` is also still required for the `capability-graph-composition` CI gate to run
at all).
