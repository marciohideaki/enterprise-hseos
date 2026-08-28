# A10/A11 Checkpoint — Direct Claude Agent SDK Driver and Delegated CLI

**Status:** In progress

**Recorded:** 2026-08-24

**Authority:** User instruction to continue the accepted ADR-0024 goal; no operational activation inferred.

## Delivered

- Added a direct `@anthropic-ai/claude-agent-sdk` driver around `query()`, `getSessionInfo()`, explicit `sessionId`, `resume`, and `AbortController` cancellation.
- Added the exact `agent-claude-delegated-candidate` capability profile and public `hseos agent run/resume/cancel` path backed by the durable delegated-runtime ledger.
- Bound the canonical Agent SDK module and Claude Code executable by independent SHA-256 digests. Resume rejects either artifact drifting from its immutable session manifest.
- Kept the adapter honestly at L0. It passes `tools: []`, `allowedTools: []`, `settingSources: []`, `permissionMode: plan`, `maxTurns: 1`, and a replacement environment containing only selected names. Tool use, permission denials, capability drift, and unknown future content blocks fail closed.
- Assigned the external UUID before the first query. A new process uses `getSessionInfo()` to distinguish a not-yet-materialized explicit session from an existing transcript, then selects `sessionId` or `resume` without changing identity.

## Protocol basis

- Official Claude Agent SDK TypeScript reference: <https://platform.claude.com/docs/en/agent-sdk/typescript>
- Official Anthropic session cookbook: <https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser>
- Published package inspected: `@anthropic-ai/claude-agent-sdk@0.3.241`; no dependency was added or package content committed.

## Deterministic evidence

- `npm run test:claude-agent-sdk-driver`: 7/7
- `npm run test:delegated-claude-cli`: 6/6
- `npm run test:capabilities`: 107/107
- Published `@anthropic-ai/claude-agent-sdk@0.3.241` module load against installed Claude Code `2.1.241`: compatible; no query dispatched
- Full enforced gate: `.logs/validation/gate-20260824T014616.log`
- Gate SHA-256: `dbae0e98f526939eafc2caabf99922b5ac1d79773c609ea20567301d213e0edf`
- Gate result: 0 failures; 1 unrelated historical placeholder warning

## Boundaries and remaining work

- All composition tests use a deterministic local ESM fixture. The installed Claude Code executable was inspected read-only but never invoked for a model request.
- No credential, provider network, operational database, deployment, sandbox claim, or runtime cutover was accessed.
- Codex and Claude now have equivalent public L0 profiles. External ACP process binding, required OS-sandbox attestation, separately authorized real-provider smokes, G9 evidence, final stable audit, and explicit cutover remain open.
