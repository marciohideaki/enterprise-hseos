# A10–A11 Live Codex and Claude Provider Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Real delegated-provider execution through the public HSEOS CLI
**Status:** Codex and Claude live one-turn smokes completed; operational activation remains gated
**Authority:** Explicit user instruction to validate both providers using the locally authenticated CLIs
**Baseline:** `ec7b817`

## Outcome

The public `hseos agent run` surface completed real, authenticated model
requests through both delegated L0 profiles. Each run used an empty temporary
working directory, an instructions-only prompt, zero tools and the host's
existing authentication. No credential value, account identity or provider
response metadata was printed or persisted.

The real runs exposed three compatibility defects that deterministic fixtures
had not represented:

- Codex app-server v2 requires `read-only` for `thread/start`, while the driver
  sent the turn-policy spelling `readOnly`.
- A newly created Codex thread has no recoverable rollout before its first
  turn. The CLI closed the creating provider and tried to reattach immediately,
  so real `run` failed although the fixture passed.
- Claude Agent SDK 0.3.241 emits a structurally valid `rate_limit_event` before
  the assistant message; the strict driver rejected this non-effect event.

The Codex protocol spelling is now correct. A normal `run` keeps creation and
the first turn on the same provider instance for both adapters. Deterministic
fixtures continue to cover durable reattachment in separate CLI invocations;
that cross-process lifecycle is not promoted to live evidence here. The Claude
driver accepts only a structurally valid rate-limit event and continues to fail
closed on unknown assistant content or any effect-bearing block.

## Live evidence

- Codex CLI: `0.149.0`; authenticated status passed.
- Claude Code: `2.1.241`; authenticated status passed.
- Claude Agent SDK: published `0.3.241`, installed only in a disposable
  validation directory.
- Codex result: `completed`, exact output `HSEOS_CODEX_PROVIDER_OK`, 13 durable
  ledger facts, no failed or effect event.
- Claude result: `completed`, exact output `HSEOS_CLAUDE_PROVIDER_OK`, 7 durable
  ledger facts, no failed or effect event.
- Both bindings selected only `HOME` and `PATH`; durable manifests retained
  environment names and opaque `secret://` references, never resolved values.
- Codex used app-server `approvalPolicy: never` and a read-only sandbox policy.
- Claude used `permissionMode: plan`, `allowedTools: []`, `tools: []`, one turn
  and no settings sources.
- The installed npm-distributed Codex CLI cannot start the managed app-server
  daemon because that command requires the separate standalone installation;
  no daemon or service was started.

## Deterministic evidence

- `test:codex-app-server-driver` — 7/7.
- `test:delegated-codex-cli` — 7/7, including attached first-turn regression.
- `test:claude-agent-sdk-driver` — 7/7.
- `test:delegated-claude-cli` — 7/7, including attached first-query regression.
- Full governed quality gate — 0 failures, 1 unrelated historical
  documentation warning.
- Gate log — `.logs/validation/gate-20260824T033726.log`.
- Gate SHA-256 —
  `108f70b1871fb5899436a1b7d8c8b6ccea3b4126f91ffe97f035687e81ae39b7`.

## Boundary and remaining gates

This checkpoint closes the missing live-smoke evidence for the delegated Codex
and Claude L0 adapters. It does not claim governed-tool capability, external
`ai-jail` supervision for these delegated profiles, operational activation or
cutover. It also does not replace A13's sandbox-supervised probe for the
OpenAI-compatible candidate profile. G9's 30-complete-day window, the final
stable-snapshot audit and explicit human cutover authorization remain open.

The raw Codex app-server does not persist an empty thread before its first turn.
The public direct profile has therefore been downgraded to the lifecycle proven
here: one-turn `run`. `create-only`, cross-process `resume` and post-process
`cancel` now reject as unavailable before binding or state access. The lower
provider-neutral host contracts remain reusable by a future managed
daemon/proxy profile, but deterministic fixture behavior no longer inflates the
capability advertised for the installed raw server.

This is the final disposition of the Codex lifecycle gap for the direct
profile. It requires no standalone installation and does not weaken the global
Agent Kernel contract: the reference, bound kernel and Claude profiles retain
their independently verified durable lifecycle support.

The temporary provider bindings, SDK installation and session ledgers are
disposable validation artifacts outside the repository. Rollback of the code
corrections is the single isolated task commit.
