# Hook Handlers — `.agents/hooks/handlers/`

> **Status: implemented.** The canonical handler source is `.enterprise/governance/hooks/handlers/`. The agent-core compiler copies and hash-pins it into `.agents/hooks/handlers/`; clean clones do not depend on host-global paths (ADR-0006 P5). Files in the compiled mirror must not be edited directly.

## Implemented handler families

The canonical directory currently contains the following core handler families:

| Handler | Source | Event | Purpose |
|---|---|---|---|
| `plan-lint.sh` | PostToolUse (Write\|Edit) | Lint parallel-flow plans for a missing execution protocol |
| `pre-compact.sh` | PreCompact | Snapshot critical context before compaction |
| `on-prompt-submit.sh` | UserPromptSubmit | Capture project-scoped prompt context and advisories |
| `session-end.sh`, `session-track.sh` | Session lifecycle | Track sessions and optionally bridge second-brain state |
| `suggest-skill.sh` | PreToolUse (Agent) | Recommend governed skills before agent dispatch |
| `code-index-guard.sh`, `code-index-post-edit.sh` | Pre/Post tool use | Enforce and refresh the configured project-local code index |
| `swarm-gate.sh`, `claude-md-guard.sh`, ADO guards | PreToolUse | Enforce blocking governance decisions declared by the registry |
| `telemetry-export-*.sh` | PostToolUse/Stop | Export optional telemetry without becoming state authority |

`scripts/governance/state-emit-hook.sh` and `quality-gates.sh` remain explicit runtime/governance entrypoints. They are not pending handler migrations. Registry commands are authored in `.enterprise/governance/hooks/registry.yaml` and compiled atomically for each adapter.

## Handler authoring rules

1. **Idempotent.** Running twice produces the same result.
2. **Declared failure behavior.** Optional integrations are best-effort. A handler may block only when its registry entry declares `blocking: true` and an accepted policy requires fail-closed enforcement.
3. **Project-scoped.** Only modify files within the current worktree; never touch `~/.claude/`, `/opt/`, or `$HOME` outside the repo.
4. **Config-aware.** Read `hseos.config.yaml` for behaviour flags (`second_brain.enabled`, `mcp_bundles_active`, etc.) — never hard-code paths or secrets.
5. **Fail-open for optional integrations.** When a feature (vault, code index, etc.) is unavailable, the handler self-suppresses silently per ADR-0006 P6 (graceful degradation).

## Telemetry Export Bridge (OTLP / Loki)

Four additional handlers were introduced by the telemetry-swarm-coherence run (20260603):

| Handler | Event | Status | Purpose |
|---|---|---|---|
| `telemetry-export-tool.sh` | PostToolUse | active (env-gated) | Opt-in OTLP metrics TEE (`OTEL_EXPORTER_OTLP_ENDPOINT` or `HSEOS_OTEL_EXPORT=1`). Self-suppresses when unset. SQLite remains canonical. |
| `telemetry-export-session.sh` | Stop | active (env-gated) | Opt-in OTLP/Loki session-ended log export (`OTEL_EXPORTER_OTLP_ENDPOINT` or `HSEOS_LOKI_ENDPOINT`). Self-suppresses when unset. |
| `rtk-rewrite.sh` | PreToolUse/Bash | **inactive** | OPTIONAL token-saving rewrite via `rtk` binary. Activate by setting `status: active` in registry + recompile. No-ops silently when `rtk` absent. |
| `build-resource-guard.sh` | PreToolUse/Bash | **inactive** | OPT-IN build parallelism cap via `HSEOS_BUILD_MAX_JOBS`. Activate by setting the env var + `status: active` + recompile. No-op by default. |

The telemetry pair (`telemetry-export-tool.sh` and `telemetry-export-session.sh`) are `active` in the registry and compiled into `.claude/hooks.json`, but they are inert by default because they exit immediately when no OTLP or Loki endpoint is configured. The two adapters (`rtk-rewrite.sh` and `build-resource-guard.sh`) are `inactive` and are not compiled into `.claude/hooks.json` until explicitly activated.

## Capability mapping

Compiler v2 emits per-adapter hook configurations from the canonical `.enterprise/governance/hooks/registry.yaml` source into `.agents/hooks/registry.yaml` and vendor adapters. When an adapter does not support an event natively, its adapter contract must document the fallback explicitly.
