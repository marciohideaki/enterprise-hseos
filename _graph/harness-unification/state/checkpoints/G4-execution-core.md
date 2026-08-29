# G4 Checkpoint — Governed Execution Core

**Status:** completed for temporary fixtures; operational activation prohibited
**Baseline:** feature integration `cef9dc8`
**Decision:** accepted ADR-0022 and ADR-0023

## Delivered

- A single governed execution runtime with versioned input/output contracts, authority and policy checks, immutable approval consumption, absolute deadlines, cancellation, provider dispatch, durable terminal outcomes, projection reconcile, and a canonical result/evidence envelope.
- A sealed, fail-closed event registry for every execution fact and schema version, with field classifications, sensitive-data allowlists, strict payload validation, and deterministic declarative upcasters.
- A sealed tool-contract registry covering capability, provider, authority, policy, reversibility, approval, cancellation, exclusivity, sandbox, prerequisites, idempotency support, timeout, and failure mode.
- Atomic approval consumption plus `ExecutionAuthorized` and `ExecutionStarted` persistence on the same SQLite connection before any provider effect.
- Durable warnings, evidence, retryability, idempotent replay, and an explicit in-doubt result whenever a mutating provider may have run without a trustworthy terminal fact.
- Pending-activation migration 007 for immutable, operation-bound approval records and uses; migration 005 now also seals the registered event type/version catalog at the database boundary.

## Deliberate fail-closed boundaries

- `optional_warning` is reserved vocabulary only. Runtime v1 rejects it before provider or ledger effects until a later node defines its complete semantics.
- `exclusive` scheduling and barrier behavior are deferred to G6; prerequisite/capability materialization is deferred to G7. No adapter may claim either behavior before those nodes land.
- Compensatable contracts are classified, but automatic compensation orchestration is not introduced by this node.

## Deterministic evidence

- Focused ledger/projection/runtime suite: `56` passed, `0` failed.
- Full state suite: passed.
- Governed quality gate: `0` failures, `1` pre-existing documentation-placeholder warning.
- Lint and `git diff --check`: passed.
- Quality log SHA-256: `d4141c174b266d2cbbcbd4062bc960d537dbbb53be0fcdc1cc179952344343b0`.
- Independent verification approved the frozen 56-test snapshot with zero blocker, high, or medium findings after independently reproducing the approval, deadline, failure-mode, replay, atomicity, and isolation boundaries.

## Activation boundary

Migrations 005, 006, and 007 remain under `migrations-pending-activation`. The production runner still ends at schema version 4. No operational CLI, MCP, hook, workflow, or database is wired to this runtime. Schema/data migration still requires a separate explicit human authorization.

## Required next

G5 must implement the protocol adapter without bypassing this port, including current MCP behavior and bounded legacy negotiation. G6 must then route CLI, hooks, project-state, and SWARM through the same execution boundary and add the scheduler/exclusivity semantics.

## Rollback

Discard/revert the isolated G4 commit. Only owned in-memory or temporary fixtures contain schemas 005–007, and fixture cleanup removes them.
