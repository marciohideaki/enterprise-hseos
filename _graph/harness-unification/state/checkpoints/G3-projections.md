# G3 Checkpoint — Rebuildable Execution Projections

**Status:** completed for temporary fixtures; operational activation prohibited
**Baseline:** feature commit `671f70c`
**Decision:** accepted ADR-0022

## Delivered

- Pending-activation schema 006 for versioned projection generations, checkpoints, and execution-run read models.
- Pure deterministic projection of registered execution lifecycle facts.
- Transactional batch application and checkpoint CAS, preventing partial commits and stale-worker checkpoint regression.
- Side-by-side rebuild with integrity verification and atomic generation switch; a failed or incompatible candidate cannot retire the active generation.
- Reconcile that resumes exactly once after interruption between apply and checkpoint.
- Truthful health across lag, checkpoint-ahead corruption, row coverage, semantic state integrity, projection errors, and schema-version compatibility.
- Fail-closed reads and reconcile when the active projection schema is incompatible.
- Per-projection processed-event, failure, processing-lag, and checkpoint-position metrics.

## Deterministic evidence

- Focused ledger/projection suite: `26` passed, `0` failed.
- Full state suite: passed.
- Governed quality gate: `0` failures, `1` pre-existing documentation-placeholder warning.
- Lint and `git diff --check`: passed.
- Quality log SHA-256: `869ad7d813ffecd5e4c683163afbdc878ec5f8d71aba1c0b570763e4b6b69877`.
- Independent verification ended with zero blocker, high, or medium findings after reproducing and closing semantic tampering, ineligible activation, stale checkpoint, checkpoint-ahead, metrics, and schema-version cases.

## Activation boundary

Migration 006 remains under `migrations-pending-activation` with migration 005. The production runner still ends at schema version 4. No operational CLI, MCP, hook, workflow, or database reads or writes these tables. Activating either migration requires a later explicit schema/data-migration authorization.

## Required next

G4 must provide the common governed execution port plus the fail-closed event-type/schema registry, deterministic upcasters, event payload allowlists, policy/approval lifecycle, and common result/evidence envelope. The G3 projector intentionally supports only the accepted lifecycle types and must be wired through that registry before operational activation.

## Rollback

Discard/revert the isolated G3 commit. Only owned temporary fixtures contain schema 006, and fixture cleanup removes them.
