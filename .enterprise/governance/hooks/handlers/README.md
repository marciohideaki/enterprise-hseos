# Hook Handlers — `.agents/hooks/handlers/`

> **Status: scaffolded (Wave 4 foundation).** Per ADR-0006 P5 (zero global path), hook handler scripts must live inside the repository so that a clean clone can install hooks without depending on the host machine. The directory is reserved here; concrete handler scripts are migrated from `~/.claude/hooks/` and `scripts/governance/` in Wave 4 implementation follow-ups.

## Migration plan

The following eight handler scripts will land in this directory, one per follow-up commit:

| Handler | Source | Event | Purpose |
|---|---|---|---|
| `plan-lint.sh` | `~/.claude/hooks/on-post-write-plan-lint.sh` | PostToolUse (Write\|Edit) | Lint plan files for missing `## Execution Protocol` section in parallel-flow plans |
| `pre-compact.sh` | `~/.claude/hooks/on-pre-compact.sh` | PreCompact | Snapshot critical context (next steps, open questions) before compaction |
| `on-prompt-submit.sh` | `~/.claude/hooks/on-prompt-submit.sh` (refactored) | UserPromptSubmit | Project-only concerns; vault dependencies stripped |
| `session-end.sh` | `~/.claude/hooks/on-session-end.sh` | SessionEnd | Gated session-end log; vault sync only when `second_brain.enabled: true` |
| `suggest-skill.sh` | `~/.claude/hooks/suggest-skill-before-agent.sh` | PreToolUse (Agent) | Recommend skills before Agent spawn; reads SKILL.md frontmatter `triggers` |
| `code-index-guard.sh` | `~/.claude/hooks/axon-guard.sh` (generalized) | PreToolUse (Grep\|Glob) | Block raw search when code index is available; pluggable across index providers |
| `code-index-post-edit.sh` | `~/.claude/hooks/axon-post-edit.sh` (generalized) | PostToolUse (Write\|Edit) | Trigger index reindex after edits; pluggable across providers |
| `on-notification.sh` | `~/.claude/hooks/on-notification.sh` | Notification | System notification for long-running operations |

The existing `scripts/governance/state-emit-hook.sh`, `swarm-gate.sh`, and `quality-gates.sh` continue to live under `scripts/governance/` for backward compatibility; they will be relocated here in a follow-up wave when the compiler v2 (W2 implementation) lands and can rewrite registry paths atomically.

## Handler authoring rules

1. **Idempotent.** Running twice produces the same result.
2. **Best-effort.** Never block the triggering action; exit 0 even on failure (use `|| true`).
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

The compiler v2 (Wave 2 implementation) emits per-adapter hook configurations from `.agents/hooks/registry.yaml`. When an adapter does not support a hook event natively, the handler script remains discoverable here for manual invocation; the adapter spec's `fallbacks.unsupported_capability` documents the workaround.
