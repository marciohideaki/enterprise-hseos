# G2 Checkpoint — Gated Relational Event Ledger

**Status:** completed for temporary fixtures; operational activation prohibited
**Baseline:** feature commit `fa77b89`
**Decision:** accepted ADR-0022

## Delivered

- A pending-activation schema v2 migration for an append-only `execution_events` ledger.
- Complete ES-10 metadata plus stream sequence, global position, actor, operation ID, and evidence references.
- Atomic `expected_version` compare-and-append with typed concurrency and event-ID conflicts.
- Exact idempotent replay, including correct current stream version after later facts.
- Immutable rows protected against update, delete, and SQLite `INSERT OR REPLACE` identity collisions.
- Strict lossless JSON, sensitive-key family rejection, canonical UTC timestamps, UUID event IDs, and SQL constraints.
- Aggregate stream/version-range and paginated global-stream reads.
- Metrics for events appended and concurrency conflicts by aggregate type plus write latency.
- A file-fixture factory that owns creation under a private `mkdtemp`; arbitrary paths, symlinks, hardlinks, and operational databases cannot cross the activation gate.

## Deterministic evidence

- Focused ledger suite: `12` passed, `0` failed.
- Full state suite: passed.
- Governed quality gate: `0` failures, `1` pre-existing documentation-placeholder warning.
- Lint and `git diff --check`: passed.
- Quality log SHA-256: `9dab442f06f4020c8f1f2893524aa40067ff6d2c384ef755e93b84e2da545dd1`.
- Independent fault injection verified batch rollback, same-stream and cross-stream concurrency, global ordering, range reads, append-only bypass resistance, strict timestamp/UUID rejection, and the symlink/hardlink activation boundary.

## Activation boundary

The production migration runner still ends at schema version 4 and does not scan `migrations-pending-activation`. No existing CLI, MCP, hook, workflow, or operational database uses the ledger. Moving migration 005 into the operational directory requires the later explicit schema/data-migration gate.

## Required before activation

G4 must add a fail-closed registry for past-tense event types and supported schema versions, deterministic upcasters, and per-event payload allowlists/classification. The G2 name-based sensitive-key filter is defense in depth, not a substitute for those schemas.

## Rollback

Discard/revert the isolated G2 commit. Only temporary fixtures contain schema 005, and their owned directories are removed by fixture cleanup.
