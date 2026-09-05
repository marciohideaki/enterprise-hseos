# PCCP Governance State

Status: technically validated; pending human gates

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

Pending gates: accept ADR-0036; activate graph schema 2.0 and intake v3; reconcile EventEnvelope and
Unit of Work in one immutable Platform Core schema 2.0 fragment; review and pin the Backend
candidate; repair or govern the unreachable registered Cambio fragment revision.
