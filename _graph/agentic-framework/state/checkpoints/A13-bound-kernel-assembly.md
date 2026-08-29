# A13 Checkpoint — Bound Agent Kernel Assembly

**Status:** temporary bound-kernel assembly completed; public execution and operational activation remain blocked
**Baseline:** `bf6f00c`
**Authority:** active model-agnostic framework goal and prior authorization to proceed; live sandbox, credentials and cutover remain separate gates
**Scope:** common kernel composition, immutable provider/session binding, governed tool loop, durable resume and cancel

## Outcome

The scripted reference profile and the OpenAI-compatible candidate now use the same `assembleTemporaryKernel` composition root. It wires the durable relational session store, model-provider registry snapshot, AgentRuntime, ToolRuntime and ADR-0022 governed execution boundary without branching the kernel on provider identity.

The candidate's bound runtime persists an exact, hashed provider binding and an exact `ai-jail`/`lockdown` execution attestation in a private temporary fixture. Session metadata binds both values and the complete manifest hash. Reopen rejects a modified binding, manifest, attestation, optimistic sequence or workspace before model or tool effects. Secret references are resolved only during model dispatch; secret values are absent from the manifest and execution ledger.

The runtime implements create/run, durable reopen/resume and cancel as a library boundary. It is deliberately not exposed by the public CLI yet: the current host cannot produce a live lockdown attestation, and accepting a caller assertion would weaken the sandbox gate. A supervisor that launches inside `ai-jail` and supplies verifiable evidence is the next integration step.

## Assembled evidence

- The real OpenAI-compatible SSE adapter receives a governed `temporary.set-state` tool call from a fake endpoint, executes it through ToolRuntime, persists external world state and completes the model continuation.
- The execution ledger contains the sandbox evidence reference and contains no provider secret.
- Two distinct immutable endpoint/model bindings produce the same normalized result through unchanged kernel source.
- A create-only session performs no secret read; a new assembly reopens the file-backed fixture, verifies the durable binding and completes it.
- Cancellation terminalizes a created session without provider dispatch or secret resolution.
- Missing or weakened attestations fail before fixture creation, secret resolution or network dispatch.
- Binding tampering, attestation drift, missing optimistic sequence and workspace symlink escape fail before effects.

## Verification

- `npm run test:bound-kernel-agent` — 6/6.
- `npm run test:agent-capability-cli` — 8/8.
- `npm run test:agent-provider-binding` — 8/8.
- ESLint — passed.
- Full strict worktree gate — 0 failures, 1 unrelated historical placeholder warning.
- Gate log — `.logs/validation/gate-20260824T000819.log`.
- Gate SHA-256 — `d38ff9ae3c75df61d8b8fda845df4174497be4a0c330eb2ab010d1028e996d43`.

## Boundary and next action

No real credential, endpoint, operational database, schema, protocol or service was used or changed. This checkpoint proves the provider-neutral assembly and durable execution semantics, not operational sandbox readiness. The next reversible step is a fail-closed `ai-jail` supervisor/CLI route that generates a trustworthy attestation, followed by an explicitly authorized provider-environment smoke. G9, final audit and human cutover remain mandatory.
