# Capability Matrix — HSEOS Adapters

> **Source of truth for per-adapter capability reporting.** Generated as part of W4-T10 to materialize the matrix referenced from `docs/ADAPTER-GUIDE.md` and `tools/cli/installers/lib/core/agent-core-compiler/adapters/_base.js`.
>
> When the compiler v2 (Wave 2 implementation) lands, this file will be regenerated from the declarative specs at `.agents/adapters/<id>.yaml`. Until then, this document is the manual reference and is updated alongside any change to a spec.

This matrix tells:

- **Authors** of skills, hooks, and plugins which adapters can express the capability natively
- **The compiler** which adapters require fallback prose when emitting an asset that uses an unsupported capability
- **End users** what behaviour to expect when they install HSEOS on a particular vendor

For machine-readable inspection, run:

```bash
hseos install-plan --adapters --json
```

## Adapters declared today

The six initial adapters from ADR-0007 plus the BYOA reference:

| Adapter id | Spec file | Status |
|---|---|---|
| `claude-code` | `.agents/adapters/claude-code.yaml` | Implemented (existing compiler) |
| `codex` | `.agents/adapters/codex.yaml` | Implemented (existing compiler) |
| `cursor` | (pending W2-impl) | Spec slot reserved in manifest schema |
| `continue` | (pending W2-impl) | Spec slot reserved |
| `aider` | (pending W2-impl) | Spec slot reserved |
| `cline` | (pending W2-impl) | Spec slot reserved |
| `goose` | `.agents/adapters/goose.yaml` | BYOA reference (W7-impl) |

## Hook event matrix

Hook events declared in `.agents/hooks/registry.yaml`. Eight events are exercised by the W4-impl handler suite:

| Event | claude-code | codex | cursor | continue | aider | cline | goose | Fallback when unsupported |
|---|---|---|---|---|---|---|---|---|
| `PreToolUse` | ✅ native | ⚠ proxy | ✅ native (1.7+) | ⚠ partial | ❌ | ✅ native | ✅ native | Validate inside CLI command wrapper |
| `PostToolUse` | ✅ native | ⚠ proxy | ⚠ partial | ⚠ partial | ❌ | ✅ native | ✅ native | Run via worktree-manager post-commit hook |
| `SessionStart` | ✅ native | ⚠ proxy | ⚠ proxy | ❌ | ❌ | ⚠ proxy | ✅ native | Manual invocation from preflight skill |
| `SessionEnd` | ✅ native | ⚠ proxy | ❌ | ❌ | ❌ | ❌ | ✅ native | Run via end-session skill explicitly |
| `Stop` | ✅ native | ⚠ proxy | ❌ | ❌ | ❌ | ❌ | ❌ | Best-effort cleanup in skill exit path |
| `UserPromptSubmit` | ✅ native | ⚠ proxy | ⚠ partial | ❌ | ❌ | ⚠ proxy | ✅ native | Logged in `.hseos/runs/sessions/<id>/prompts/` only when session id env var is set |
| `PreCompact` | ✅ native | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Manual snapshot via pre-compact handler invoked by user |
| `Notification` | ✅ native | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠ partial | Terminal bell fallback inside on-notification handler |

Legend:
- ✅ **native** — adapter supports the event with first-class semantics
- ⚠ **partial** — adapter supports a similar but not identical event; emit needs a small bridge
- ⚠ **proxy** — adapter exposes the trigger only indirectly (e.g. wrapping a command); emit uses the proxy with documented limitations
- ❌ **unsupported** — capability cannot be expressed; the row's "Fallback" column documents the alternative

## Per-handler portability snapshot (W4-impl)

Each handler in `.agents/hooks/handlers/` was authored with the matrix in mind. The fallback for `Notification` (terminal bell), the silent no-op when no code-index provider is detected, the `HSEOS_BYPASS_INDEX=1` escape hatch, and the gating-by-config of vault writes are all expressions of P6 (graceful degradation) so the handlers run in every adapter — even those that lack the native event — without breaking. For Codex, the compiler emits `.codex/hseos-hooks.json` so hook intent remains auditable even though Codex CLI does not consume `.claude/hooks.json`.

| Handler | Event(s) it serves | Behaviour on unsupported adapter |
|---|---|---|
| `plan-lint.sh` | PostToolUse Write\|Edit | Skipped (no event firing); the lint can be re-invoked manually via `bash .agents/hooks/handlers/plan-lint.sh <plan-file>` |
| `pre-compact.sh` | PreCompact | Skipped; users on adapters without PreCompact run it manually before `/compact`, or rely on session-end markers |
| `on-prompt-submit.sh` | UserPromptSubmit | Skipped; prompt logging happens only when the event fires |
| `session-end.sh` | SessionEnd | Skipped on no-event adapters; the `/end-session` skill calls the same logic explicitly |
| `suggest-skill.sh` | PreToolUse Agent | Skipped; main thread can still consult `.agents/skills/*/SKILL.md` triggers manually |
| `code-index-guard.sh` | PreToolUse Grep\|Glob (blocking) | Skipped; without the guard, raw search is allowed, just less efficient |
| `code-index-post-edit.sh` | PostToolUse Write\|Edit | Skipped; the index falls behind, but the on-prompt-submit advisory once per day signals staleness |
| `on-notification.sh` | Notification | Skipped on adapters without the event; the notification chain (notify-send/osascript/powershell/bell) is also invocable manually for any vendor that lacks the trigger |

## Updating the matrix

This matrix is editorial today. The compiler v2 implementation slice (Wave 2) will:

1. Read each adapter's `capabilities` block from its spec yaml
2. Cross-reference with the events declared in `.agents/hooks/registry.yaml`
3. Re-emit this file with no editorial input required

Until then, when adding or modifying a hook entry or adapter spec:

1. Update the relevant cells in the **Hook event matrix**
2. Confirm the **fallback prose** on each row remains accurate
3. Bump the registry version in `.agents/hooks/registry.yaml` if a new event is introduced
