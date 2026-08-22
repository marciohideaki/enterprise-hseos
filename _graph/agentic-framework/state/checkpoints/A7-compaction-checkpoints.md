# A7 Checkpoint — Compaction and Checkpoint Providers

**Artifact type:** Governed goal checkpoint
**Scope:** A7 lineage-preserving compaction and immutable checkpoint providers
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0002; ADR-0003; ADR-0024; Automated Validation Rules

## Accepted deliverables

- `@hseos/agent-compaction` supplies versioned `CompactionProvider` and `CheckpointProvider` ports, a sealed registry snapshot, a deterministic conformance provider and immutable checkpoint storage.
- Context pressure compacts only an oldest contiguous durable-history prefix. Tool-result pressure preserves one ordered tool message per exact call identity while pruning result bodies.
- Every `compaction.completed` fact carries exact source lineage, source digest, replacement messages, accounting, selected provider manifest, checkpoint-provider identity and immutable checkpoint reference.
- Runtime and replay independently recompute counts and canonical UTF-8 byte units, enforce provider manifest caps and reject identity, accounting, lineage or provenance drift.
- A checkpoint is read before provider dispatch. A crash after checkpoint persistence but before relational append therefore resumes byte-equivalently without reinvoking a potentially nondeterministic provider.
- Checkpoint payloads are core-built validated compaction results; recursively credential-bearing fields are rejected. Original session and governed-operation events remain immutable.

## Independent refutation and corrections

The first independent review found six material classes: a crash gap after checkpoint persistence, live provider methods behind snapshots, unverifiable accounting/provenance, plaintext credential fields in checkpoint payloads, unenforced manifest caps and ambiguous token semantics.

The implementation now resumes from an exact validated checkpoint, binds provider methods at registration, persists and replays provider/checkpoint provenance, recomputes all accounting, rejects sensitive payload keys recursively, enforces input/output caps and explicitly defines the A7 conservative counter as canonical UTF-8 bytes. Independent repros verified provider invocation count `1` across crash retry, immutable snapshots, typed rejection of forged accounting/provenance, secret rejection and pre/post-dispatch cap enforcement. Final verdict: `READY`, no residual material finding.

## Verification

- `npm run test:agent-compaction` — 10/10.
- Agentic focused suites — 50/50 in independent review.
- `npm run test:agent-context` — 10/10.
- `npm run test:agent-runtime` — 12/12.
- `npm run test:agentic-session-store` — 9/9.
- `npm run test:agentic-contracts` — 9/9.
- Clean temporary tarball install of contracts plus compaction package — passed.
- Independent adversarial review — `READY`; no residual material finding.
- `npm test` through the canonical worktree manager — passed.
- Strict code gate — 0 failures, 1 unrelated pre-existing documentation warning (`epics-template`).
- Gate log — `.logs/validation/gate-20260822T132459.log`.
- Gate SHA-256 — `853c9c5915636a60fb030d695488f2462acb09e82199214efce1d826c2a0af8b`.

## Boundary and rollback

No real credential, external provider, operational database, merge, push, PR, deployment or activation was touched. Before integration, rollback is the single A7 task commit. Checkpoints are durable evidence copies; relational events remain canonical and sufficient to reconstruct model-visible requests.

## Next node

After explicit human authorization and local integration of A7, A8 may implement context caching with tenant and policy isolation. This checkpoint does not authorize merge or A8 execution.
