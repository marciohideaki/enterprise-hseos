# A9 Checkpoint — RuntimeProvider and ACP v1 Bridge

**Artifact type:** Governed goal checkpoint
**Scope:** A9 model-neutral runtime delegation seam and fail-closed ACP v1 bridge
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0012; ADR-0022; ADR-0024; Automated Validation Rules

## Accepted deliverables

- `@hseos/runtime-providers` implements the existing `RuntimeProvider` port over an injected, process-neutral ACP peer. Process spawning, networking and credential resolution remain adapter responsibilities.
- The reference provider targets stable ACP v1 only. ACP v2 remains explicitly outside this node because it is still a draft.
- The manifest reports exactly L0 (`instructions`) and fails L1–L4 negotiation. ACP transport, session methods or permission prompts do not imply governed tool execution.
- Initialization advertises no filesystem, terminal or MCP client capability and requires the peer to attest the HSEOS `instructions_only` effect boundary through ACP `_meta`.
- `create`, `resume`, `send`, event streaming, cancellation, disposal and close have correlated identities, bounded I/O, exclusive lifecycle transitions and compensating cleanup for late or malformed remote creation.
- ACP text chunks and terminal reasons map to strict normalized runtime events. Limit stops, refusals, cancellations, malformed payloads and unsupported updates cannot become false success.
- Any live permission request or tool-call update at L0 cancels the remote turn and terminalizes the HSEOS session with a policy failure; no normalized tool call is emitted below L1.
- Session count, input bytes, event count, stream bytes, prompt duration and peer notification/teardown settlement are bounded.

## Independent refutation and corrections

Independent reliability review reproduced and drove corrections for cancellation races, invalid stop reasons, synchronous dispatch failure, malformed correlatable envelopes, remote identity collision, orphan cleanup, optional ACP field coercion, input/output limits, ContentChunk schema drift, hanging notifications, timer overflow, resume/send overlap and unbounded initialize/new/load/close I/O.

The final review reran ten focused reliability scenarios plus the package and contract suites. Verdict: `READY`, with no residual blocker, high or medium finding.

## Verification

- `npm run test:runtime-providers` — 22/22.
- Focused runtime/contracts/session-store/tool/runtime/orchestration suites — 76/76.
- `npm run test:agentic-contracts` — 9/9.
- `npm run test:compatibility` — 7/7.
- `npm test` — passed.
- Clean temporary tarball install of contracts and runtime providers — passed.
- Independent reliability review — `READY`; focused repros 10/10; secret scan clean.
- `npm run lint -- --quiet` and `git diff --check` — passed.
- Strict worktree-manager gate — 0 failures, 1 unrelated pre-existing documentation warning (`epics-template`).
- Gate log — `.logs/validation/gate-20260822T170859.log`.
- Gate SHA-256 — `2e7dd34f7be2c8ac4e909d2fb325a90883be20d23d7676c610dcedb125f071e8`.

## Boundary and rollback

No real provider, credential, subprocess, network runtime, operational database, merge, push, PR, deployment or activation was touched. The bridge requires an injected peer and has only fixture evidence. Before integration, rollback is the single A9 task commit.

## Next node

After explicit human authorization and local integration of A9, A10 may implement hosted coding-agent and external ACP adapters against this seam. No adapter may claim L1+ without proving that every classified effect crosses the governed `ToolRuntime`.
