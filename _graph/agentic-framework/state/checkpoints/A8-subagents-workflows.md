# A8 Checkpoint — Subagents and Durable Workflows

**Artifact type:** Governed goal checkpoint
**Scope:** A8 bounded parent/child execution and workflow orchestration
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0002; ADR-0003; ADR-0022; ADR-0024; Automated Validation Rules

## Accepted deliverables

- `@hseos/agent-orchestration` implements the versioned `SubagentProvider` and `WorkflowEngine` ports without model- or vendor-specific branches.
- Child forks atomically bind parent lineage, identical authority/policy, non-widening limits and the exact provider/turn/message intent before `AgentRuntime.send`.
- Join, cancellation and dispose validate provider identity and durable terminal outcomes. Cancellation traverses the complete descendant tree and refuses to return with an orphan.
- Workflows execute finite `parallel` and `pipeline` phases with explicit parallel, child, step, duration and join ceilings.
- `workflow.reserved` consumes the parent workflow budget before dispatch; `workflow.phase.checkpointed` records exact completed lineage; `workflow.released` records exact terminal status.
- Crash recovery requires the exact durable claim reference after its parent-bounded lease expires. Reclaim, spawn, checkpoint and release are fenced across SQLite connections by the captured claim.
- The legacy single-step `workflow.checkpointed` event remains readable while the new phase event carries definition, claim, step and child identity.

## Independent refutation and corrections

Independent review reproduced and drove corrections for forged join outcomes, pre-checkpoint input drift, terminal children retaining live parallel capacity, recursive descendants, workflow cap races, cross-engine/cross-store concurrency, crash-gap budget loss, same-definition double execution, release-status drift and live takeover across two file-backed SQLite connections.

The final file-backed repro used two connections, stores, providers and engines over one durable database. A live takeover was rejected with `WORKFLOW_CLAIM_LIVE`; the owner completed; no reclaim event was written; one `turn.started` existed; the child completed; and the durable release was `completed`. Final verdict: `READY`, with no residual blocker/high/medium finding.

## Verification

- `npm run test:agent-orchestration` — 13/13.
- Focused orchestration/contracts/session-store suites — 31/31.
- `npm run test:agent-runtime` — 12/12.
- `npm test` — passed.
- Clean temporary tarball install of contracts, session store and orchestration — passed.
- Independent adversarial review — `READY`.
- Strict worktree-manager gate — 0 failures, 1 unrelated pre-existing documentation warning (`epics-template`).
- Gate log — `.logs/validation/gate-20260822T151120.log`.
- Gate SHA-256 — `9f7976afb03b5a642c4d22b0f4dfeabfc2ea152bae195d454fec27e2fe909e93`.

## Boundary and rollback

No real credential, external provider, operational database, merge, push, PR, deployment or activation was touched. Before integration, rollback is the single A8 task commit. The local integration branch remains the A7 baseline `9fca10b` until separate human authorization.

## Next node

After explicit human authorization and local integration of A8, A9 may implement the `RuntimeProvider` seam and ACP bridge. This checkpoint does not authorize merge or A9 execution.
