# ADR-0022 — Governed Execution Runtime with Relational Event Ledger

**Status:** Accepted (human-approved 2026-08-21)
**Date:** 2026-08-21
**Authors:** Platform Architecture (draft prepared by execution agent)
**Affects Standards:** Event Sourcing Standard ES-01; CQRS Standard CQ-02/CQ-17; Agent Rules AR-17; Tool Design Governance; ADR-0001; ADR-0002; ADR-0003; ADR-0012; ADR-0014; ADR-0016
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

HSEOS exposes governed work through CLI commands, MCP servers, hook handlers, workflows, and SWARM. These surfaces currently resolve and execute tools through different code paths. Input validation, policy evaluation, approval, timeout, cancellation, sandbox selection, result formatting, evidence, and state projection therefore do not share one enforceable boundary.

State also has overlapping representations: legacy `state`, `tasks`, and `state_history` tables; newer `as_*` tables; Markdown run artifacts; and experimental JSONL event logs. The repository simultaneously describes Markdown, SQLite, and JSONL as authoritative in different artifacts. Health checks can consequently report healthy state even when only a small fraction of filesystem runs has relational coverage.

ADR-0002 requires a child ADR before event sourcing is activated. ADR-0003 requires the mutable write-side source of truth to be relational and all read models to be reconstructable. A standalone JSONL authority would violate ADR-0003 and lacks the transactional concurrency and projection checkpoint semantics required by the HSEOS runtime.

The DeepSeek Harness evaluation identified useful execution patterns—provider isolation, bounded scheduling, exclusive barriers, cancellation, and structured lifecycle events—but those patterns must enter HSEOS through its hexagonal and governance boundaries rather than as a parallel runtime.

## Decision

We propose to activate event sourcing specifically for HSEOS governed execution and to introduce a single Governed Execution Runtime.

### Relational event ledger

1. A SQLite append-only event table is the canonical write model for governed execution state.
2. Every aggregate stream uses a unique monotonic sequence enforced by a relational uniqueness constraint and optimistic compare-and-append.
3. Event records carry every ES-10 field: `event_id`, `event_type`, `aggregate_id`, `aggregate_type`, `schema_version`, `occurred_at`, `correlation_id`, `causation_id`, and self-contained `payload`. HSEOS additionally records `stream_sequence`, global `position`, actor, operation ID, and evidence references.
4. `as_runs`, `as_tasks`, `as_sessions`, evidence views, Markdown, Kanban, telemetry, and JSONL are projections or exports. None may be written as an independent authority.
5. Every projector stores a high-water mark and is idempotent. Projection failure after event commit is recoverable by replay.
6. JSONL remains an append-only interchange/export format only. Import validates schemas and commits through the relational command boundary.
7. Legacy state remains readable during a bounded compatibility release, is migrated through deterministic fixtures, and cannot receive new writes after cutover.
8. The append port requires `expected_version`. It atomically compares the current stream version, appends facts, allocates their global positions, and fails with a typed concurrency conflict when versions differ. Retry, reject, or merge remains an application-layer decision.
9. The global stream is ordered by `position` and is the sole input for catch-up projectors. Aggregate reads support version ranges.
10. Event applicators are pure and deterministic. They perform no I/O, logging, provider calls, or event publication.
11. Event payloads contain only the fact required for reconstruction. Secrets, credentials, raw approval tokens, and unnecessary personal data are forbidden; sensitive evidence is referenced through access-controlled records.
12. Any external integration event is explicitly mapped and versioned separately, then published through a relational transactional outbox. External consumers never read the internal ledger directly.
13. Additive schema changes increment `schema_version`; breaking semantic changes use a new past-tense event type and an accepted ADR. Old types remain deserializable through deterministic upcasters.

### Projection and snapshot strategy

- Each named projection owns a schema version and durable global-position checkpoint.
- Live tables are replaced only after a catch-up projection reaches the ledger high-water mark and passes integrity comparison; rebuild never mutates the active projection in place.
- Snapshots are disabled for the initial release because correctness does not require them and the expected local stream size is bounded. Aggregate reconstruction always works from version 0.
- Snapshot activation requires measured replay pressure and a follow-up ADR. Any snapshot must include aggregate ID/type, aggregate version, schema version, and creation time; snapshot operations are logged and traced.
- Append metrics cover count by aggregate type, concurrency conflicts, and write latency. Projection metrics cover processed events, lag, failures, and checkpoint position. These metrics are optional exports but their local counters/health evidence are mandatory.

### Governed execution port

All execution surfaces call one application port with these stages:

1. resolve tool and owning capability;
2. validate versioned input schema;
3. evaluate authority and policy;
4. allocate an `operation_id`, idempotency key, reversibility class, deadline, and cancellation policy;
5. obtain and validate explicit approval bound to that `operation_id` when required;
6. compare-and-append `ExecutionAuthorized` and `ExecutionStarted` before any provider side effect;
7. dispatch through a declared provider and optional sandbox using the idempotency key;
8. validate the versioned output schema;
9. append exactly one immediate outcome fact (`ExecutionSucceeded`, `ExecutionFailed`, `ExecutionCancelled`, or `ExecutionOutcomeUncertain`);
10. project read models and return the canonical result envelope.

The canonical envelope contains `schema_version`, `ok`, `data`, `error`, `evidence`, and `warnings`. Domain results may extend `data`; adapters may translate wire formatting but cannot change semantics.

An approval record is immutable and contains `approval_id`, authorizer identity, exact operation and resource scope, `operation_id`, issued/expiry timestamps, decision, and policy version. Approvals are single-operation and cannot be reused or broadened. Financial, compliance, production, and irreversible operations always require explicit per-run authorization under SI-48/SI-50.

Providers declare one reversibility class: `read_only`, `idempotent_mutation`, `compensatable_mutation`, or `irreversible_mutation`. A provider that cannot accept an idempotency key may execute only after an explicit policy and approval for its declared class. If dispatch may have succeeded but the terminal append fails, the operation remains `in_doubt`: it is never replayed automatically, required workflows stop, and reconciliation queries provider receipts or requires human resolution before recording a terminal/compensating fact.

A later compensation is recorded as a new immutable `ExecutionCompensated` or `ExecutionCompensationFailed` fact referencing the prior outcome; history is never rewritten. The run projection exposes exactly one current terminal status derived from the complete stream.

### Failure policy

- Required governance, authority, approval, ledger, and evidence stages fail closed.
- No provider dispatch occurs unless the pre-effect authorization/start facts have committed successfully.
- Optional telemetry, search indexing, and export projections may fail open only with a durable warning event.
- Started parallel tasks are drained or explicitly cancelled; skipped and aborted tasks produce lifecycle events.
- Exclusive tools form scheduler barriers and never overlap incompatible work.

### Capability contract

Every active tool declares an owning capability, input/output schemas, provider, prerequisites, policy, timeout, cancellation behavior, failure mode, install paths, and behavior tests. CLI, MCP, hooks, and SWARM are adapters, not independent execution authorities.

## Consequences

### Positive

- One transactional authority with replayable audit history.
- Identical governance semantics across all tool surfaces.
- Crash recovery and state-health checks can be proved through sequence checkpoints.
- DeepSeek scheduling and provider patterns are absorbed without creating a second harness.
- Markdown and JSONL remain useful portable views without competing for authority.

### Negative / Trade-offs

- Event schema evolution and projection migrations become permanent operational responsibilities.
- The existing state model needs a compatibility window and deterministic migration tooling.
- Direct handler invocation becomes unsupported and adapters require migration.
- SQLite concurrency constraints must be tested under the expected local-process workload.

### Risks

- **Partial cutover:** old and new write paths could diverge. Mitigation: freeze legacy writes before enabling the new path and add a single-writer invariant test.
- **Projection lag:** views may be stale. Mitigation: transactional high-water marks, lag health metrics, and replay on startup/reconcile.
- **Poison event:** an invalid historical event could stop replay. Mitigation: versioned schemas, quarantined import, deterministic upcasters, and explicit operator evidence.
- **Governance outage:** a ledger or policy failure could halt required workflows. Mitigation: fail closed with actionable recovery diagnostics; no silent fallback authority.
- **Scope expansion:** an all-at-once migration could be unsafe. Mitigation: adapter-by-adapter cutover with contract tests and compatibility telemetry.

## Mitigations

- Implement and validate against temporary database fixtures before touching operational state.
- Ship rebuild, dry-run migration, backup, integrity check, and rollback commands before cutover.
- Retain legacy readers for one documented release; record usage warnings to prove retirement readiness.
- Make coverage ratio and projector high-water marks mandatory health signals.
- Require each adapter migration to pass a shared conformance suite.
- The compatibility window starts in activation release `R` and is removed no earlier than `R+1`. Release `R` may activate only after 30 consecutive days with zero internal legacy writes/calls and migration-integrity evidence, and no later than 2026-10-31; otherwise activation is blocked pending a new accepted ADR. The compatibility path must be removed by 2026-11-30. The owner is `platform-governance`; any schedule extension requires a new accepted ADR with usage evidence.

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Event Sourcing Standard | ES-01 | Activates event sourcing only for HSEOS governed execution |
| CQRS Standard | CQ-02/CQ-17 | Defines relational event ledger as write model and all operational views as rebuildable projections |
| Agent Rules Standard | AR-17 | Preserves the relational-only mutable source-of-truth invariant |
| Hexagonal Architecture / ADR-0001 | Ports and adapters | Adds execution, ledger, projection, policy, approval, sandbox, and provider ports |
| ADR-0012 | Sandbox boundary | Makes sandbox an execution provider without granting authority |
| ADR-0014 | Telemetry bridge | Confirms telemetry is an optional projection and never canonical |
| ADR-0016 | Capability packaging | Extends capability definitions with executable contracts and exact materialization |
| Security & Identity Standard | SI-48/SI-50 | Records per-operation authorization and forbids implicit real-system mutation authority |
| Event Sourcing Standard | ES-10, ES-14–ES-20, ES-27–ES-39, ES-48–ES-54 | Defines the complete event, append, global stream, projection, snapshot, and metrics contracts |

The activation change set must also update `.hseos/AGENT-MANIFEST.md`, `.hseos/workflows/dev-squad/workflow.md`, resume workflows, the canonical dev-squad skill, state-tracking documentation, and every statement that currently assigns Markdown/JSONL authority or permits SQLite failure to bypass required governance.

## Compliance

- [x] Approved by Engineering Leadership — explicit project-authority approval recorded 2026-08-21
- [ ] Event Sourcing, CQRS, Agent Rules, and Tool Design standards updated to reference this ADR
- [ ] Legacy migration dry-run reviewed against a backup copy
- [ ] Adapter conformance suite passes
- [ ] Teams notified
- [ ] Activation date: pending approval
- [ ] Review date: 90 days after activation

## Validation

- Concurrent writes produce unique monotonic per-aggregate sequences.
- Compare-and-append rejects a stale `expected_version` and exposes the typed conflict without retrying implicitly.
- Global positions are unique and let every projection rebuild in the same deterministic order.
- Projections rebuild from an empty read side and match the live state.
- A forced crash after ledger commit and before projection is recovered exactly once.
- Health is non-green when projection coverage or high-water marks lag.
- Every active tool passes the shared schema/policy/evidence contract across every exposed adapter.
- A provider side effect cannot start before durable authorization/start facts; in-doubt outcomes are detected and never replayed automatically.
- Approval records bind authorizer, scope, expiry, policy, and operation ID, and expired/reused approvals fail closed.
- A selected capability profile materializes exactly its declared files plus mandatory baseline dependencies.

## Rollback

- Before operational cutover, discard the isolated feature branches.
- Before the first post-cutover command, the pre-migration backup may restore the legacy read path.
- After any post-cutover command, rollback must build a compatibility projection from the complete ledger, reach the ledger high-water mark, and pass integrity comparison before switching readers. A stale pre-migration backup must never become the visible state.
- Never delete the ledger during rollback; preserve it as audit evidence.
- A post-cutover authority reversal requires a superseding ADR.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| JSONL as canonical event store | Cannot satisfy ADR-0003 relational authority and complicates safe concurrent ordering and atomic checkpoints |
| Keep Markdown canonical per run | Permits multiple write authorities and cannot provide transactional cross-run invariants |
| CRUD relational state without events | Preserves authority but does not provide the audit, replay, recovery, and lifecycle evidence required by governed execution |
| Independent runtime per adapter | Retains policy and evidence divergence and makes correctness adapter-dependent |
| Replace HSEOS with DeepSeek Harness | Loses HSEOS governance/domain contracts and creates a parallel source of truth instead of absorbing capabilities |

## References

- ADR-0001, ADR-0002, ADR-0003, ADR-0012, ADR-0014, ADR-0016
- Event Sourcing Standard ES-06–ES-54; Security & Identity Standard SI-48–SI-50
- `_graph/harness-unification/BASELINE.md`
- `_graph/harness-unification/GOAL-GRAPH.md`
