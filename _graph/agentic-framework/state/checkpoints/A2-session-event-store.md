# A2 Checkpoint — Relational Agent Session Event Store

**Artifact type:** Governed goal checkpoint  
**Scope:** A2 append ordering, replay, fork, request reconstruction and crash recovery  
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0002; ADR-0003; ADR-0022; ADR-0024; Automated Validation Rules

## Accepted deliverables

- `@hseos/agent-session-store` with strict compare-and-append, immutable replay, canonical request reconstruction and recovery plans.
- Agent-session aggregates share the ADR-0022 relational ledger and global positions without copying approval, dispatch or operation outcomes.
- Atomic multi-stream append makes parent attachment and child creation one transaction.
- Fork lineage inherits authority/policy, cannot widen budgets and enforces `max_children` under concurrent version checks.
- `session.forked` is a versioned contract event; model streams and terminal lifecycle are reconstructed fail closed.
- Pending fixture schema accepts nullable operation references only outside execution aggregates; operational schema remains v4.

## Adversarial corrections

Independent refutation found and caused correction of pagination-before-filter, secret-envelope bypass, SQL-null operation bypass, non-atomic/unbounded forks, incomplete model completion, direct child-cap bypass and read-side secret leakage. Final probes included real concurrent workers, injected second-stream failure, forged envelopes and installed tarballs.

## Verification

- `npm run test:agentic-session-store` — 7/7.
- `npm run test:agentic-contracts` — 9/9.
- `node --test test/test-execution-event-ledger.js` — 12/12.
- `npm run test:agentic-foundation` — 6/6.
- Strict code gate — 0 failures, 0 warnings.
- Gate log — `.logs/validation/gate-20260822T011516.log`.
- Gate SHA-256 — `baa66ef077cdb566b31354c48a4d517965b7c4a841e60fa4f8d170e4247ca557`.
- Independent verifier — `READY`; no residual BLOCKER/HIGH/MEDIUM.
- Both packages pack, install together and load from a clean temporary prefix.

## Boundary and rollback

Only in-memory or manager-created temporary SQLite fixtures were migrated. No operational database, credential, push, PR, deployment or activation was touched. Before activation, rollback is the single A2 task commit and disposable fixtures; after activation, canonical events must never be deleted.

## Next node

A3 may implement the provider registry, deterministic scripted model provider and OpenAI-compatible streaming adapter against a fake HTTP endpoint. A3 must not add provider-specific branches to Agent Kernel source or require real credentials.
