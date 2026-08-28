# A13 Exact Sandbox Profile Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Real `ai-jail` execution of the exact networked provider profile
**Status:** Fail-closed correction complete; networked candidate remains blocked
**Authority:** Explicit user instruction to proceed until goal completion; no weakening of the security posture or operational cutover inferred
**Baseline:** `73b5718`

## Outcome

A real loopback OpenAI-compatible bridge was prepared to delegate one request
to the locally authenticated model CLI. The public HSEOS candidate entered the
supervisor but did not read the declared provider token, contact the bridge or
invoke the model. `ai-jail 1.20.0` rejected the exact
`--allow-tcp-port 43179` lockdown profile because its backend cannot isolate
UDP and requires unrestricted `--network` instead.

The prior required-sandbox evidence proved only a clean, networkless lockdown
command. It did not prove that the exact profile used by a provider could
execute. The supervisor now runs the complete configured profile against
`/usr/bin/true` before reading any provider secret or launching a worker.
`--exec` is mandatory so a real sandbox does not add terminal/status output to
the worker's protocol stdout. A rejected sandbox process is classified as a
sandbox execution failure before JSON framing is considered.

The same checks protect both the bound OpenAI-compatible kernel and the
external ACP process composition. Deterministic forwarding fixtures remain green,
while the real host truthfully reports the networked profile unavailable.

## Evidence

- Bound-kernel supervisor: 6/6.
- Delegated ACP one-shot CLI: 6/6.
- Sandbox CLI: 7/7.
- Real exact-profile probe:
  `{"exact_lockdown_network_profile_ready":false}`.
- Provider token reads: zero.
- Provider/model calls from this probe: zero.
- Temporary loopback bridge, binding and sandbox configuration: removed.

## Boundary

Enabling unrestricted `--network` would weaken the approved egress boundary
and is not inferred from permission to continue implementation. A real
networked candidate requires either an accepted restricted-egress backend or
an explicit security decision accepting unrestricted sandbox network for this
profile. The already completed delegated Codex and Claude L0 smokes are not
relabelled as evidence for this stronger Agent Kernel profile.
