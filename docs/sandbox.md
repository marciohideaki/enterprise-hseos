# Optional Agent OS Sandboxing

HSEOS worktree isolation governs Git state: each task gets its own branch and filesystem checkout. It does not, by itself, restrict the host OS resources visible to an agent process.

Optional sandbox isolation governs host exposure. HSEOS integrates with `ai-jail` as an external provider so projects can run agents with a private home, masked secret files, and disabled Docker/display/GPU passthrough without bundling GPL-licensed sandbox code into the MIT HSEOS core.

## Commands

```bash
hseos sandbox doctor
hseos sandbox doctor --json
hseos sandbox run --dry-run -- codex
hseos sandbox run --profile standard -- codex
hseos sandbox run --profile lockdown -- bash
```

`--dry-run` is handled by HSEOS and prints the `ai-jail` command without executing `ai-jail` or the target command.

## Profiles

Profiles live in `.hseos/config/hseos.config.yaml` under `sandbox`.

`standard` is for normal development:

- private home
- project writable
- Docker, display, and GPU disabled
- common secret files masked

`lockdown` is for hostile or untrusted workloads:

- ai-jail lockdown mode
- no saved ai-jail project config
- common secret files masked
- TCP access only through explicit allowlist entries

## Policy

- Keep `sandbox.required: false` unless the project has a clear security requirement and compatible Linux host configuration.
- Do not add broad `Bash(ai-jail:*)` permissions. Sandbox execution should go through `hseos sandbox`.
- Do not rely on ai-jail defaults without the HSEOS profile. Docker socket, display passthrough, GPU access, and inherited environment variables can widen host exposure.
- Do not vendor ai-jail source or binaries into HSEOS. Install it separately through the user's package manager.

## Preflight

`hseos agent-core doctor` includes sandbox readiness. Missing `ai-jail` or `bwrap` is a warning while sandboxing is optional, and a failure only when `sandbox.required=true`.

## Disposable engineering prerequisites (candidate)

`hseos sandbox engineering-check --json` runs fixed Node and Python canaries in
private disposable directories using the adopted `ai-jail` backend with `lockdown`,
network disabled, a private home and a cleared environment. It ignores project
sandbox configuration and rejects command/profile overrides. It does not run task
code or contact a model provider.

The supervisor verifies the actual write and the integrity of a protected marker;
exit zero or a claimed write is insufficient. Missing runtimes/backends, malformed
reports, timeouts, links and missing effects fail closed with exit 2. Exit 0 means
only these prerequisites passed. `ready` and `operational_authorized` remain false:
network/IPC isolation, cancellation of descendants, resource limits, the protected
verifier, task snapshots and real-provider validation remain separate gates.

A backend that makes the workspace read-only even with the explicit temporary
`--rw-map` is blocked. Do not disable lockdown to make this diagnostic pass. The
approved [ADR-0040](../.enterprise/.specs/decisions/ADR-0040-disposable-engineering-execution.md)
requires an explicit boundary decision if the adopted backend cannot satisfy the
engineering contract. No active execution policy is changed by this command.
