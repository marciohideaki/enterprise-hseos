# A1 Agent Runtime Contracts Checkpoint

**Artifact type:** Governed completion checkpoint
**Scope:** Model-agnostic HSEOS Agent Framework, node A1
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0022; ADR-0024; Automated Validation Rules

## Outcome

A1 is complete. `@hseos/agent-runtime-contracts` establishes the strict, versioned inward boundary for `AgentRuntime`, `ModelProvider`, `RuntimeProvider`, model/runtime streams and durable `SessionEvent` facts without importing any vendor SDK.

## Delivered contracts

- Mutually exclusive HSEOS-owned kernel and delegated-runtime session specifications.
- Executable input, result, stream-item and error contracts for every canonical port method.
- Correlation of provider, request, HSEOS session, runtime session, turn and stream sequence identities.
- Exact cumulative L0–L4 capability level derivation and negotiation without overclaim or underclaim.
- Strict schema-version and unknown-field rejection, immutable parsed values and fail-closed cyclic-input handling.
- Normalized vendor-neutral error taxonomy, 256 KiB delta cap and 1 MiB delegated tool-input cap.
- `operation_id` reference semantics that do not duplicate ADR-0022 approval or authority facts.
- Package-level README and publishable dry-run proving the contract boundary is independently consumable.

## Adversarial corrections

Independent review initially found nominal-only ports, cross-session event ambiguity, non-exclusive effective levels, ambiguous tool messages and self-parent sessions. A second pass found uncorrelated calls/streams, missing event-size bounds and vendor-specific errors. All vectors now fail closed, including divergent identities, sequence gaps/duplicates, regressive timestamps, oversized events and raw provider error codes.

## Verification

- `npm run test:agentic-contracts`: 9 passed, 0 failed.
- `npm run test:agentic-foundation`: 6 passed, 0 failed.
- Strict code gate: 0 failures, 0 warnings.
- Gate log: `.logs/validation/gate-20260822T004555.log`.
- Gate log SHA-256: `afc61c37c53ae9a3bdf9f920305e044a47a8955ca6aba77d6054d8233818b669`.
- Package dry-run: eight runtime package files, no generated tarball retained.
- Independent verifier: `READY`, with no blocker, high or medium findings.

## Boundary and rollback

This node defines contracts only. It performs no network calls, operational state writes, provider activation or schema migration. Before activation, rollback is the single A1 task commit plus generated package surfaces; A0 and the existing governed execution runtime remain intact.

## Next reversible action

Implement A2 against temporary databases: append-only relational session events, ordering, replay, fork, exact model-request reconstruction and crash recovery, referencing ADR-0022 operations by ID.
