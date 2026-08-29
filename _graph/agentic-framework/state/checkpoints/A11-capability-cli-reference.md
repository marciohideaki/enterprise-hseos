# A11 Checkpoint — Capability Packaging, CLI and Reference Profile

**Status:** completed in isolated task worktree; not integrated
**Baseline:** `56cf90b`
**Authority:** explicit human response, “Prossiga”
**Scope:** exact capability selection, `hseos agent run/resume/cancel`, and a keyless non-operational reference assembly

## Outcome

HSEOS now packages the model-agnostic Agent Kernel as explicit capability components and exposes an opt-in `agent-reference` profile. The profile selects exactly `model:scripted-reference` and `runtime:hseos-kernel`, carries no secret references, and does not select the hosted runtime-provider package.

The CLI executes the real `AgentRuntime`, durable relational session store, model registry, context assembly, governed tool scheduler and execution ledger. `run` completes a multi-step tool loop; `resume` crosses a process boundary with an explicit optimistic sequence; `cancel` durably terminalizes an inactive session. The externally observable reference state is written only by the governed tool provider.

The accepted execution schema remains inactive operationally. Reference sessions use marked SQLite fixtures created directly below the operating-system temporary directory. Reopen rejects non-temporary paths, aliases, links, malformed markers and incomplete schemas. The private workspace is checked by type, canonical parent, permissions and filesystem identity before the effect. Reference provider configuration is SHA-256-bound to immutable session creation metadata and verified on every reopen.

## Independent refutation

The independent reliability review initially returned `NOT READY` with two reproducible findings: a replaced workspace symlink could redirect the reference write, and the cross-process manifest was mutable without a durable binding. Both were corrected and encoded as regressions. Final review reran the focused suite read-only and returned `READY` with no residual material finding.

## Verification

- `npm run test:agent-capability-cli` — 8/8, including exact provider selection, run, cross-process resume, cancel, temporary-store aliases, optimistic sequence, workspace replacement and manifest mutation.
- `npm run test:capabilities` — 92/92.
- `npm run test:agent-runtime` — 12/12.
- Execution ledger and projection focused suites — 26/26.
- `npm test` — passed on the final stable diff through the worktree-manager gate.
- Clean `hseos-2.0.0.tgz` install in an empty temporary directory — passed with a minimal environment; the assembled loop wrote the expected external value and persisted 17 canonical ledger events.
- Independent reliability review — `READY` after both material repros became fail-closed regressions.
- Strict worktree-manager gate — 0 failures, 1 unrelated pre-existing documentation warning (`epics-template`).
- Gate log — `.logs/validation/gate-20260822T222732.log`.
- Gate SHA-256 — `7aa375e717e85c2a1e4a8c169b4efc6205ec3fc7a5b249d7473b89ead455b049`.

## Boundary and rollback

No hosted provider, credential, network model, operational database, merge, push, PR, deployment or activation was used. Temporary clean-install and reference-session fixtures were removed after verification. Rollback before integration is the single A11 task commit.

## Next node

Stop for explicit human authorization before merging A11 or opening A12. Operational activation remains gated by G9, A12, A13 and separate human authorization.
