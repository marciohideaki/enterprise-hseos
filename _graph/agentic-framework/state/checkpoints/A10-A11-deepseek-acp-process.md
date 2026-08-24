# A10/A11 DeepSeek ACP Process Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Direct external ACP process transport and reference-capability refutation
**Status:** Partial — transport complete; public DeepSeek lifecycle profile correctly withheld
**Authority:** Explicit user instruction to proceed; no provider activation inferred

## Outcome

HSEOS now owns a bounded, dependency-free JSON-RPC/stdio peer for external ACP
v1 processes. `ProcessAcpPeer` uses a canonical absolute executable and cwd,
never invokes a shell, replaces the child environment with selected entries,
bounds lines to 1 MiB and concurrent requests to 64, correlates response ids,
answers server-to-client requests and fails closed on malformed or unknown
frames. `DeepSeekHarnessRuntimeProvider` consumes it through the existing
model-neutral `RuntimeProvider` port.

The DeepSeek Harness reference at commit
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` was revalidated locally. Its ACP
surface explicitly supports fresh sessions only; load, list, resume, delete and
fork are unsupported, and session lifetime belongs to the connection. Its SDK
JSON-RPC surface offers only `initialize`, `session/prompt` and `shutdown`; it
has no prompt cancel or session close, while the server creates unknown session
ids through the fresh-agent path. Neither surface proves HSEOS cross-process
reattachment.

The stock ACP initialization also does not acknowledge HSEOS's
`instructions_only` effect boundary. Since a DeepSeek composition may contain
its own tools, accepting it as L0 would permit effects outside governed
`ToolRuntime`. HSEOS therefore rejects this case with `policy_denied`. A
compatible tool-free fixture proves the process seam; a stock-like unattested
fixture and a fresh provider without `loadSession` prove both refusal paths.

## Evidence

- `packages/runtime-providers/process-acp-peer.js`
- `test/test-process-acp-peer.js`
- `test/fixtures/fake-acp-process.js`
- `npm run test:runtime-providers` — 54/54
- `npm run lint -- --no-warn-ignored` — passed
- Full strict gate — 0 failures, 1 unrelated historical warning
- `.logs/validation/gate-20260824T020520.log`
- SHA-256 `5f9d329e093de0da68d5d8bb24fe4dfa47d10a399f82f83417725bed91854928`
- DeepSeek reference `packages/acp/acp/README.md` — fresh sessions only
- DeepSeek reference `packages/sdk/protocol/README.md` — no cancel/session-close
- DeepSeek reference `packages/sdk/protocol/src/types.ts` — three request methods only

No credential was read, no model request was made and no external runtime was
activated.

## Remaining gate

A public `agent-deepseek-delegated-candidate` profile is not yet truthful. It
requires an exact tool-free DeepSeek composition, immutable executable/config
digests, a real OS-sandbox attestation, and a lifecycle contract that either
proves cross-process reattachment/cancellation or declares a separately
versioned one-shot execution mode. Until then, unsupported operations remain
explicit and the generic ACP port does not overclaim DeepSeek conformance.
