# Goal Graph — Uniform and Robust HSEOS Harness

**Artifact type:** Executable goal graph
**Objective:** Correct all identified deprecations, normalization gaps, duplicate surfaces, and harness fragmentation without weakening governance.
**Authority:** User authorization dated 2026-08-21; architectural activation remains subject to accepted ADRs.
**Baseline:** `BASELINE.md`

## Global invariants

1. The relational write side remains the only mutable source of truth.
2. Generated adapter surfaces are never authoring sources.
3. Every state transition is ordered, versioned, idempotently projectable, and auditable.
4. Every active tool has input/output schemas, an owning capability, policy, timeout, cancellation semantics, and evidence behavior.
5. CLI, MCP, hooks, and SWARM invoke the same governed execution port.
6. A resolved installation profile exactly matches the materialized file surface.
7. Compatibility is bounded, observable, and removable; it never creates a second authority.
8. Required governance fails closed; optional telemetry and indexes may fail open with warnings.
9. No mutation is performed against the primary worktree or operational database during development.

## Nodes

| Node | Deliverable | Depends on | Deterministic verification | Gate / stop condition |
|---|---|---|---|---|
| G0 | Baseline, goal graph, ADR-0022 and ADR-0023 drafts | none | ADR structure and graph references validated | Stop before architectural implementation until human acceptance |
| G1 | Dead-code and stale-status cleanup | G0 | focused tests, lint, documentation fact tests | Stop if a consumer of a removal is found |
| G2 | Relational append-only event ledger and schema v2 | accepted ADR-0022 | migration tests on temporary DBs; concurrent ordering; idempotency | Stop before operational data migration |
| G3 | Rebuildable state projections and truthful reconcile/health | G2 | crash recovery, replay, high-water, and 2/14 false-green regression tests | Stop on unreconciled destructive migration |
| G4 | Governed execution core, event schema/upcaster registry, sensitive-data allowlists, and common result envelope | G2 | policy, approval, timeout, cancel, versioned event/input/output schema, upcaster, evidence contract tests | Stop on security-policy ambiguity or an unregistered event type/version |
| G5 | MCP 2026-07-28 adapter with bounded legacy negotiation | accepted ADR-0023, G4 | official-era request fixtures, deterministic list/cache/header tests | Stop if required consumed subset is unsupported |
| G6 | CLI, hooks, project-state, and SWARM adapters | G3, G4 | cross-adapter parity tests and scheduler barrier/cancel tests | Stop if an adapter bypasses the execution port |
| G7 | Capability schema v2 and exact materialization | G4 | selected set equals emitted set for every profile | Stop if mandatory baseline can be omitted |
| G8 | Plugin normalization | G1, G7 | active plugin behavior tests and generated-source checks | Scaffold cannot remain active |
| G9 | Compatibility retirement | G3, G5, G6, G7, G8 | migration fixtures, zero internal callers, deprecation telemetry | Human gate before deleting operational data/schema |
| G10 | Completion audit | all | full quality gates plus requirement-by-requirement evidence | Goal remains active on weak or missing evidence |

## Execution waves

### Wave 0 — Decisions and reversible cleanup

- G0, followed by G1.
- No schema, policy, security posture, or operational data change.

### Wave 1 — State foundation

- G2 then G3.
- Temporary databases only until migration is explicitly approved.

### Wave 2 — Uniform execution

- G4 then G5/G6.
- MCP is an adapter; HSEOS domain tasks remain internal domain objects.

### Wave 3 — Packaging and retirement

- G7 and G8, then G9.
- Compatibility readers survive one documented release window before removal.

### Wave 4 — Proof

- G10 independently attempts to refute every completion claim.

## Acceptance evidence

- `profile-exact-install`: minimal installs contain no unselected skills.
- `ledger-rebuild`: all state projections rebuild from the ledger.
- `projection-crash-recovery`: append succeeds, projection fails, reconcile catches up exactly once.
- `concurrent-ordering`: concurrent commands yield unique monotonic per-run sequences.
- `coverage-truth`: 2 projected runs out of 14 cannot be healthy.
- `execution-parity`: the same tool has identical validation, policy, evidence, and result semantics across adapters.
- `mcp-current`: contract fixtures cover the current protocol era and explicit legacy fallback.
- `plugin-truth`: every active plugin has executable behavior and behavior tests.
- `generated-only`: authoring into compiled adapter trees is rejected.
- `legacy-zero-use`: internal runtime has no callers of retired APIs before deletion.

## Rollback

Each node remains on an isolated `task/*` branch. Code nodes must include down-migration or compatibility reversal where applicable. No feature branch is merged and no task branch is removed without preserved validation evidence.
