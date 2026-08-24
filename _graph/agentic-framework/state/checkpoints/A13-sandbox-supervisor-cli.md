# A13 Checkpoint — Sandbox Supervisor and Candidate CLI

**Status:** public candidate route completed; live sandbox/provider activation remains blocked
**Baseline:** `e22bfd8`
**Authority:** active framework goal and prior authorization to proceed; no credential access, external provider call or cutover was authorized or performed
**Scope:** `ai-jail` supervisor, internal worker protocol, candidate-profile CLI routing and credential-reflection defense

## Outcome

`hseos agent run|resume|cancel --profile agent-openai-compatible-candidate` now routes only through a dedicated supervisor. The supervisor forces required sandbox readiness, selects the `lockdown` profile, rejects unknown or missing flags, requires all credential-file masks, rejects host maps, and permits exactly the TCP port selected by the immutable provider binding.

The supervisor resolves the canonical executable, hashes its bytes together with the effective profile, and derives a stable sandbox evidence reference. The first run binds that reference to the manifest and durable session metadata; resume in a separate worker succeeds only under byte-equivalent sandbox configuration and binary. A changed binary or profile fails before model or tool effects.

The worker receives its request on bounded stdin and returns one bounded JSON envelope. It inherits only `PATH`, the update-check disable marker and, when dispatch is possible, the single declared `env://` API-key reference. Arbitrary host environment values do not cross the boundary. stderr is never reflected, output is bounded, deadlines terminate the worker, and malformed/non-JSON responses fail closed.

The OpenAI-compatible adapter now rejects an SSE frame containing the resolved credential before yielding a normalized event. This prevents a malicious provider from reflecting the bearer value into the session ledger, model output or governed tool input.

## Evidence

- A fake external `ai-jail` executable launches the real internal worker as a separate process and completes the OpenAI-compatible SSE → governed tool → continuation journey.
- Create, reopen/resume and cancel use independent sandboxed worker processes and preserve the same session.
- The child environment contains exactly three keys during provider dispatch and excludes an unrelated secret.
- Required readiness failure performs zero secret reads and zero worker launches.
- Sandbox binary drift changes the evidence digest and resume rejects it before world-state mutation.
- The public CLI invokes the real doctor path and fails closed on this unavailable host without exposing the configured secret.
- A provider frame containing the bearer value yields only a sanitized `protocol_error` event.

## Verification

- `npm run test:bound-kernel-supervisor` — 5/5.
- `npm run test:model-providers` — 16/16.
- `npm run test:bound-kernel-agent` — 6/6.
- `npm run test:agent-capability-cli` — 8/8.
- Capability packaging — 97/97.
- Full strict worktree gate — 0 failures, 1 unrelated historical placeholder warning.
- Gate log — `.logs/validation/gate-20260824T002532.log`.
- Gate SHA-256 — `e56d57b7f29d0d019997006656223229370624afbc1b5e059a45e5434e3d6fcf`.

## Boundary and rollback

No real credential was resolved, no real endpoint was called, and no operational store, schema, protocol or service changed. Tests use a temporary executable that only forwards the fixed command; they prove HSEOS supervisor semantics, not the external sandbox implementation. Rollback is the isolated task commit plus removal of the two supervisor/worker files and candidate CLI routing. Required external runtime readiness, real provider validation, G9, final audit and explicit cutover remain open.
