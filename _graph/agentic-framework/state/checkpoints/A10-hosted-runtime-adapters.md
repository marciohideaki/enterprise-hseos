# A10 Checkpoint — Hosted Runtime Adapters

**Status:** completed in isolated task worktree; not integrated
**Baseline:** `dfc6116`
**Authority:** explicit human response, “Retome e prossiga”
**Scope:** Hosted coding-agent and external ACP adapters for the HSEOS `RuntimeProvider` port

## Outcome

HSEOS now exposes three honest, model-neutral hosted runtime adapters without importing a vendor SDK into the kernel or provider package:

- Codex is represented by an injected app-server driver and a `stdio`, L0 manifest.
- Claude Code is represented by an injected Agent SDK driver and a `process`, L0 manifest.
- The external process adapter specializes the stable ACP v1 bridge and does not vendor another runtime or MCP server.

All manifests are immutable, secretless and limited to `instructions`. No adapter claims governed tools, lifecycle conformance, replay, sandbox or telemetry. The host owns native process/SDK composition and credential resolution; this task accessed no credentials and performed no external provider execution.

The hosted driver boundary normalizes text deltas and terminal reasons while rejecting unknown fields, tool/effect attempts and capability weakening. Create, resume, cancellation, disposal and close are bounded and fenced. Remote identities are unique, collision owners are quarantined, and uncertain or raced teardown creates bounded tombstones. The 128-identity admission cap includes active sessions, pending creates and quarantine; late overflow degrades the provider fail-closed without growing memory.

## Independent refutation

The independent reliability reviewer initially returned `NOT READY` and reproduced owner-collision corruption, create-after-close adoption, malformed-event false success, resume races, dispose/create ABA and unbounded teardown uncertainty. Subsequent rounds found immediate and late create ABA, dispose release races and late tombstone overflow. Every material finding was corrected and encoded as a deterministic regression.

Final independent verdict: `READY`. No residual BLOCKER, HIGH or MEDIUM finding was reproducible. The reviewer changed no production or test file.

## Verification

- `npm run test:runtime-providers` — 44/44: 22 hosted/adversarial and 22 ACP regression tests.
- `npm run test:agentic-contracts` — 9/9.
- `npm run test:compatibility` — 7/7.
- `npm test` — passed on the stable final diff.
- Clean temporary tarball install of contracts and runtime providers — passed; all hosted and ACP exports loaded.
- Secret/vendor scan — no vendor, Cordis or MCP import; no credential material; manifests use `secret_refs: []`.
- Independent reliability review — `READY`.
- `npm run lint -- --quiet` and `git diff --check` — passed.
- Strict worktree-manager gate — 0 failures, 1 unrelated pre-existing documentation warning (`epics-template`).
- Gate log — `.logs/validation/gate-20260822T183358.log`.
- Gate SHA-256 — `53c6808e1b48fcb718e146beb0ff5922f6a36f370c235b6f82f87f2e3c0b3eb8`.

## Boundary and rollback

No real provider, credential, subprocess, network runtime, operational database, merge, push, PR, deployment or activation was touched. External app-server/Agent SDK smokes remain unverified because no configured credentialed environment was in scope. Rollback before integration is the single A10 task commit.

## Next node

Stop for explicit human authorization before merging A10 or opening A11. A11 may package the capability set, CLI and reference profile only after A10 is integrated. Operational activation remains gated by G9, A12, A13 and separate human authorization.
