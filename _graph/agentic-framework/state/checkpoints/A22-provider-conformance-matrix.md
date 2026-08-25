# A22 — Canonical Agent-Provider Conformance Matrix

**Artifact type:** Governed verification checkpoint
**Scope:** Exact provider ownership, manifests, binding templates and executable suite evidence
**Authority:** Existing user-authorized agentic-framework implementation goal; no provider activation or operational cutover authority
**Operational effect:** None; no credential was read, provider was activated, live database was changed or runtime cutover was performed

## Result

- Hosted Codex, Claude and DeepSeek profiles no longer claim the phantom `model:delegated-runtime`; the hosted runtime owns inference and each profile selects exactly one real runtime provider.
- Kernel profiles must select `runtime:hseos-kernel` and one real model provider. Hosted profiles must not select a model provider.
- `hseos agent-provider-conformance --verify --require-ready --json` inventories the exact five agent profiles and six selected providers.
- Every provider is bound to its actual manifest factory, declared conformance level, canonical binding template when applicable, and an explicit suite set.
- Binding YAML is strict, identity-bound, hash-recorded and secret-reference-only. The report always leaves `operational_activation` and `activation_authorized` false.
- Certification accepts only `root` and `verify`; injected runner, provider specs or catalog loader fail closed.
- Suite bytes are opened once with no-follow and single-link checks, passed to the child as descriptor 3, compiled under the original filename for module resolution, and revalidated by inode metadata plus SHA-256 after execution. No suite or bootstrap pathname is reopened for execution.

## Adversarial corrections

The independent review initially found profile/provider set substitution, mutable suite evidence and omitted binding templates. A second pass found injectable certification inputs and pathname execution after descriptor validation. A third pass found Node 20/22 incompatibility and a bootstrap-path TOCTOU. Each finding became a regression or structural constraint:

- exact profile-to-provider contracts, final canonical reinventory and real binding evidence;
- immutable suite identity and before/after descriptor hashing;
- non-injectable certifying build;
- descriptor-byte execution through an in-memory `node -e` bootstrap, with no Node-24-only flag and no temporary executable pathname.

## Deterministic evidence

- Provider conformance: `8/8`.
- Capability catalog: `115/115`.
- Delegated Codex, Claude and DeepSeek clients: `20/20`.
- Runtime providers and hosted drivers: `63/63`.
- Lint and `git diff --check`: passed.
- Full worktree quality gate: `0` failures and `1` unrelated historical placeholder warning.
- Final gate log: `.logs/validation/gate-20260825T015238.log`; SHA-256 `e145c3eb22d6ca568d130d9e86c7e3d48e8769522be05b33a71680e23de5a994`.
- Independent final verdict: `READY`, with no residual blocker/high/medium finding after Node-version and TOCTOU revalidation.

The local dependency tree contains a `better-sqlite3` binary built for Node 24, so complete Node 20/22 execution in this checkout is not claimed. The descriptor runner's pass/fail and replacement/mutation paths were exercised under Node 20/22; clean-install CI remains the authoritative native-addon compatibility check.

## Remaining gates

A22 adds verification evidence only. A13 still requires the complete G9 zero-use window, final stable-snapshot audit and explicit human cutover authorization.
