# A3 Checkpoint — Model Provider Registry and Normalized Streaming

**Artifact type:** Governed goal checkpoint
**Scope:** A3 provider discovery, immutable routing, scripted inference and OpenAI-compatible SSE normalization
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0024; Automated Validation Rules

## Accepted deliverables

- `@hseos/model-providers` implements the A1 `ModelProvider` port without importing a vendor SDK into core packages.
- Immutable registry snapshots bind each run to one verified provider manifest and reject duplicate or mismatched registrations.
- The scripted provider supplies deterministic text, reasoning, tool-call, usage, terminal and cancellation routes.
- The OpenAI-compatible adapter incrementally parses bounded SSE frames and emits only normalized, correlated stream events.
- Retry is bounded and occurs only before observable output; cancel/dispose release reservations, settle started streams and prevent ABA lifecycle races.
- Declared capabilities, parallelism, context/output limits, single-choice semantics and strict wire shapes fail closed.
- Credentials are resolved only from manifest references at dispatch time; durable errors use allowlisted codes/messages/booleans and response identifiers are hashed.

## Adversarial corrections

Independent refutation caused correction of unstarted reservation leaks, cancellation during blocked resolution, ABA cleanup, secret-bearing error propagation, malformed wire false-success, retryable type confusion, capability/limit bypasses and multi-choice ambiguity. The quality scanner was also narrowed so a sensitive-field denylist name is not mistaken for a credential while actual assigned private-key values remain detectable.

## Verification

- `npm run test:model-providers` — 14/14.
- `npm run test:agentic-contracts` — 9/9.
- `npm run test:agentic-session-store` — 7/7.
- `npm run test:governance` — passed.
- Strict code gate — 0 failures, 0 warnings.
- Gate log — `.logs/validation/gate-20260822T015953.log`.
- Gate SHA-256 — `ca36fea56f964d0de3f96cd2c5ffe209ba1c73339d28a3a271461c09121781e2`.
- Independent verifier — `READY`; no residual BLOCKER/HIGH/MEDIUM.
- Contracts and providers pack, install together and load from a clean temporary prefix.

## Boundary and rollback

All HTTP verification used a loopback fake endpoint. No real credential, external provider, operational database, push, PR, deployment or activation was touched. Before activation, rollback is the single A3 task commit. After activation, disable the provider profile and retain canonical session/execution facts.

## Next node

A4 may implement deterministic context precedence, skills/references/tool schemas, token budget and overflow handling. Every model-visible input must be reconstructable through the A2 event store.
