# A10 Extension Checkpoint — Durable Delegated Runtime Host

**Artifact type:** Code checkpoint and verification evidence
**Status:** accepted mini-goal; external driver bindings and operational activation remain open
**Baseline:** `fbf7800`
**Scope:** cross-process RuntimeProvider reattachment, provider-neutral durable host, delegated-runtime event catalog and fixture-only migration rehearsal
**Governing documents:** Enterprise Constitution; ADR-0022; ADR-0023; ADR-0024; Automated Validation Rules
**Authority:** explicit owner authorization on 2026-08-24 for the pending schema migration and continued implementation

## Outcome

The `RuntimeProvider.resume` contract can now carry the immutable delegated `AgentSessionSpec`. Hosted and ACP adapters reconstruct their bounded local state in a fresh provider instance, reattach the exact remote identity, preserve the expected normalized-event sequence and never call their create/new-session path during resume.

`DelegatedRuntimeHost` persists provider-neutral lifecycle facts in the shared relational ledger under the separate `delegated_runtime` aggregate. Durable create and turn intent precede provider effects. A dispatch crash gap is never replayed automatically and becomes an explicit uncertain outcome. Cancellation intent is retryable, manifest drift fails before remote reattachment, provider events remain untrusted schema input, and secret-bearing specs fail at the ledger boundary.

Pending migration 008 registers and reseals the eight delegated-runtime fact types. It was applied only to marked temporary fixtures. The migration/rollback rehearsal proves v4 → v8 → discarded candidate while leaving the source operational database byte-identical at v4.

## Evidence classification

- **Observed:** Codex and Claude Code each create through one host instance, close/reopen the fixture database, reattach through a new provider/host instance and settle with the same normalized lifecycle.
- **Observed:** the external ACP adapter follows the identical host path through `session/load`; no `session/new` occurs on reattachment.
- **Observed:** cancellation after reopen settles durably; matching cancellation-intent retry is idempotent; manifest drift, secret fields, uncertain create/dispatch gaps and catalog mutation fail closed.
- **Observed:** the host core imports only agent runtime contracts and contains no vendor adapter branch.
- **Observed:** operational entrypoints remain schema v4; temporary candidate migration reaches v8 and rollback/source-integrity checks pass.
- **Unverified:** real hosted-agent and external ACP process bindings. Tests use injected deterministic drivers/peers and make no external provider call.

## Verification

- `npm run test:delegated-runtime-host` — 9/9.
- `npm run test:runtime-providers` — 49/49.
- `npm run test:agentic-contracts` — 10/10.
- `npm run test:agentic-activation` — 4/4.
- `npm run test:compatibility` — 12/12.
- Native entrypoint wiring — 12/12.
- Full strict worktree gate — 0 failures, 1 unrelated historical placeholder warning.
- Gate log — `.logs/validation/gate-20260824T005400.log`.
- Gate SHA-256 — `d8b741c9b9c03402a848535b98e35bab7819f6f22e1be6254c88779f0308c01a`.

## Boundary and rollback

No operational schema, provider, service, credential or network endpoint was accessed. Migration 008 remains under `migrations-pending-activation`; production continues to reject pending schema state. Rollback is the isolated task commit, including removal of migration 008 and the delegated host package. The next framework gap is a strict external driver-binding layer and public delegated-runtime profiles/CLI without weakening the L0 declarations.
