# A14 Restricted Egress Broker Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Sandbox-supervised raw-provider egress and durable cross-process state
**Status:** Implementation and real local-provider probe passed; operational activation remains gated
**Authority:** Explicit human authorization on 2026-08-24 to implement the proposed Unix-socket broker and begin G9 observation; no schema/protocol cutover inferred
**Baseline:** `41539f9`

## Outcome

The OpenAI-compatible Agent Kernel candidate no longer grants a TCP port or
passes the provider secret into the lockdown worker. The HSEOS supervisor owns
a private Unix-domain-socket broker that pins the immutable binding endpoint,
adds the credential on the host and exposes one bounded
`chat/completions` route. The worker retains `ai-jail --lockdown` and a separate
network namespace with no direct network route.

The real sandbox exposed two conditions hidden by the forwarding fixture and
both are now covered:

1. the host Node executable is under a private home and is not visible inside
   lockdown, so the supervisor stages a transient read-only runtime under
   `/opt/hideakisolutions/.hseos-runtime`;
2. the jail has a private `/tmp`, so its ledger cannot be treated as durable.
   The worker now returns only an allowlisted, gzip-bounded, SHA-256 verified
   state snapshot. The supervisor validates the execution ledger and bound
   manifest before atomically promoting it to the host fixture path.

## Real execution evidence

- Runtime: `ai-jail 1.20.0` over Ubuntu `bubblewrap 0.9.0`.
- Sandbox network: disabled; no `--network` and no `--allow-tcp-port`.
- Provider route: local OpenAI-compatible SSE fixture through the real Unix
  broker; two upstream calls (tool request and continuation).
- Result marker: `REAL_AI_JAIL_UNIX_BROKER_OK`.
- Tool effect: `temporary.set-state` persisted `{schema_version: 1,
  value: "unix-broker"}` outside the jail.
- Lifecycle: a real `create-only` process was resumed in a second real sandbox
  process with the same session ID, expected sequence and state path.
- Credential boundary: upstream authentication was injected by the broker;
  worker environment, output, manifest and state carried no resolved secret.
- Cleanup: live bridge/binding, provider ledgers and transient runtime/socket
  directories removed after validation.

## Deterministic coverage

- Fixed endpoint and route; credential and endpoint override rejection.
- Request/response byte caps, deadline, single broker connection and sanitized
  upstream failures.
- Exact lockdown probe before secret resolution or worker launch.
- Snapshot file allowlist, compression/output caps, digest tamper rejection,
  ledger validation and pre-promotion manifest/session/binding validation.
- Existing run/resume/cancel, sandbox drift, unavailable backend and secret
  reflection regressions remain green.

## Boundary

This closes the restricted-egress and sandbox-supervised candidate gaps for the
raw OpenAI-compatible path. It does not activate the candidate, weaken G9 or
claim that an SDK-owned external transport uses the broker. Remaining hard
gates are the 30 complete G9 zero-use days, the final stable audit and explicit
human schema/protocol/runtime cutover authorization.
