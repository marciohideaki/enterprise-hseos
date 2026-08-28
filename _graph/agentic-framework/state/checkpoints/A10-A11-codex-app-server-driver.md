# A10/A11 Checkpoint — Direct Codex App Server Driver and Delegated CLI

**Status:** In progress  
**Recorded:** 2026-08-24  
**Authority:** User instruction to continue the accepted ADR-0024 goal; no operational activation inferred.

## Delivered

- Added a direct `codex app-server` driver over bounded JSONL/stdio. It performs the mandatory `initialize`/`initialized` handshake and maps `thread/start`, `thread/resume`, `turn/start`, `turn/completed`, and `turn/interrupt` into the existing hosted `RuntimeProvider` adapter.
- Added the exact `agent-codex-delegated-candidate` capability profile and public `hseos agent run/resume/cancel` path backed by the durable delegated-runtime ledger.
- Bound the executable by canonical path and SHA-256, the complete argument/environment-name manifest by durable digest, and resume by caller-supplied optimistic sequence.
- Kept the adapter honestly at L0. The child starts with Codex `readOnly` sandbox and `never` approval policy; every non-message/reasoning/plan/user item, including unknown future types, is treated as a forbidden effect and fails closed.
- Environment values are selected only at child dispatch. The durable manifest, ledger, CLI output, and tests contain names/references only.

## Protocol basis

- Official OpenAI Codex App Server documentation: <https://developers.openai.com/codex/app-server/>
- The installed `codex-cli 0.149.0` generated protocol schema was inspected transiently to confirm the current item discriminators; no generated schema was committed.

## Evidence

- `npm run test:codex-app-server-driver`: 7/7
- `npm run test:delegated-codex-cli`: 6/6
- `npm run test:runtime-providers`: 49/49
- `npm run test:delegated-runtime-host`: 9/9
- `npm run test:agent-capability-cli`: 8/8
- `npm run test:capabilities`: 102/102
- `npm run test:compatibility`: 12/12
- `npm run test:entrypoints`: 18/18
- `npm run test:agentic-activation`: 4/4
- Full enforced gate: `.logs/validation/gate-20260824T012725.log`
- Gate SHA-256: `b4e9d73ee200bea594a56c5a30c5d54e8849dddd3664097baf99e556d43dffef`

## Boundaries and remaining work

- All external composition tests used a deterministic local app-server fixture. No real credential, model request, provider network endpoint, operational database, deployment, or runtime cutover was accessed.
- This closes the direct external binding and public delegated CLI for Codex only. Claude Agent SDK and an external ACP process binding still need equivalent public profiles and process-level conformance.
- Required OS-sandbox attestation, a separately authorized real-provider environment smoke, G9 zero-legacy evidence, final stable audit, and explicit operational cutover remain open.
