# A5 Checkpoint — Governed Tool Runtime

**Artifact type:** Governed goal checkpoint
**Scope:** A5 model-neutral tool discovery, execution, cancellation and disposal through the governed execution boundary
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0012; ADR-0022; ADR-0024; Tool Design Governance Standard; Automated Validation Rules

## Accepted deliverables

- `@hseos/agent-runtime-contracts` defines a strict versioned `ToolRuntime` port for `list`, `execute`, `cancel` and `dispose`, including correlated session/turn/tool-call identities and canonical terminal outcomes.
- `@hseos/tool-runtime` exposes only definitions backed by the exact sealed ADR-0022 execution-contract registry and routes every invocation through the injected governed scheduler.
- The runtime preserves the governed pre/guard/approval/dispatch/post/result sequence. Approval denial cannot dispatch, and no direct provider or internal runtime hook is exposed.
- Equivalent concurrent idempotent invocations coalesce onto one operation without duplicate dispatch; conflicting active reuse fails closed. Results preserve canonical operation identity, replay status, all evidence and warnings, and are deeply immutable.
- Cancellation is correlated to the owning invocation and session. Disposal is session-scoped, delegates cancellation without shutting down a shared scheduler and does not wait indefinitely on a non-cancellable effect.
- `@hseos/governed-execution` is now the published canonical execution package. Existing operational import paths are compatibility re-exports, so the Agent Kernel and current HSEOS entrypoints use one implementation rather than parallel runtimes.
- Runtime, port and scheduler authenticity is nominal rather than duck-typed: private registrations and bindings reject structural lookalikes, forged port prototypes, scheduler subclasses and critical-method overrides.

## Independent refutation and corrections

The first independent review identified five material defects: a structural scheduler could bypass governance; a large post-effect evidence set could be replaced by an uncertain result; cancellation lacked correlated session identities; status/error and evidence uniqueness invariants were too weak; and equivalent concurrent idempotent calls could diverge into one success and one uncertain outcome. A follow-up identified a sixth bypass using `Object.create(GovernedExecutionPort.prototype)`.

All six findings were corrected and encoded as deterministic regressions. A final independent test-only execution passed the complete ToolRuntime suite, 11/11. Two attempts to rerun the broader prose-based adversarial review were blocked by the verifier platform's safety filter; this is recorded as a tooling limitation, not represented as an independent `READY` verdict.

## Verification

- `npm run test:tool-runtime` — 11/11.
- Independent test-only execution of `npm run test:tool-runtime` — 11/11, 0 failures.
- `npm run test:agentic-contracts` — 9/9.
- Governed entrypoint and native wiring regressions — 15/15; broader governed runtime and entrypoint set — 47/47.
- `npm test` — passed through the strict validation gate.
- Strict code gate — 0 failures, 1 unrelated pre-existing documentation warning (`epics-template`).
- Pre-checkpoint gate log — `.logs/validation/gate-20260822T073905.log`.
- Pre-checkpoint gate SHA-256 — `1ef892555b7cf98d4f8568443262c123ef6a4c4517a081fbcfbb3031f94e556b`.

## Boundary and rollback

No real credential, provider call, operational database, merge, push, PR, deployment or activation was touched. Before activation, rollback is the single A5 task commit. Existing `tools/lib/governed-execution` consumers retain compatibility re-exports; the published package is the sole canonical implementation.

## Next node

After explicit human authorization and local integration of A5, A6 may implement the bounded Agent Loop over the model-neutral provider, durable context and governed ToolRuntime ports.
