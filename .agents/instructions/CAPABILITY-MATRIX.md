# Capability Matrix — HSEOS Adapters

> **Source of truth for per-adapter capability reporting.** Generated as part of W4-T10 to materialize the matrix referenced from `docs/ADAPTER-GUIDE.md` and `tools/cli/installers/lib/core/agent-core-compiler/adapters/_base.js`.
>
> When the compiler v2 (Wave 2 implementation) lands, this file will be regenerated from the declarative specs at `.agents/adapters/<id>.yaml`. Until then, this document is the manual reference and is updated alongside any change to a spec.
>
> **Provenance (reconciled 2026-07-24):** every cell below was cross-checked against a measurement, not asserted from memory. Re-run these to re-verify:
> - Adapter specs that exist today: `ls .agents/adapters/*.yaml` → `claude-code.yaml`, `codex.yaml`, `goose.yaml` (3; `cursor`/`continue`/`aider`/`cline` have no spec file yet).
> - Per-adapter hook support: `grep -A2 'hooks:' .agents/adapters/<id>.yaml` — `claude-code.yaml` declares all 8 events; `codex.yaml` and `goose.yaml` both declare `events: []` (zero native hook events, audit-metadata only).
> - Hook registry size/shape: `grep -c '^  - id:' .agents/hooks/registry.yaml` (28 hooks) and `grep 'platform_support:' -A1 .agents/hooks/registry.yaml \| sort -u` (every single hook lists only `claude-code`; no hook entry declares `codex`, `goose`, or any other vendor in `platform_support`).
> - Handler scripts on disk: `ls .agents/hooks/handlers/*.sh \| grep -v '_ado-lib' \| wc -l` (21 — excludes the shared lib `_ado-lib.sh`; `README.md` doesn't match `*.sh` so it's already out).
> Previously this matrix hand-assigned native/partial/proxy ratings per adapter per event without checking them against the adapter spec files or the registry — that gap is what this reconciliation pass fixes.

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

Hook events declared in `.agents/hooks/registry.yaml`. Eight distinct event types are exercised by the handler suite (`grep event: .agents/hooks/registry.yaml | sort -u`).

Per-adapter columns below are read directly from each adapter's `capabilities.hooks` block in `.agents/adapters/<id>.yaml` — not hand-assigned. `claude-code.yaml` is the only spec that lists any hook events at all (all 8, matching `registry.yaml`, where every one of the 28 hooks' `platform_support` is `claude-code` only). `codex.yaml` and `goose.yaml` both declare `hooks.events: []` — i.e. zero native support for every row, by their own spec, not "partial" or "proxy". `cursor`, `continue`, `aider`, and `cline` have no adapter spec file at all yet (see the Adapters table above — "Spec slot reserved"), so rating them per event would be asserting behavior of code that doesn't exist.

| Event | claude-code | codex | cursor | continue | aider | cline | goose | Fallback when unsupported |
|---|---|---|---|---|---|---|---|---|
| `PreToolUse` | ✅ native | ❌ | 🚧 N/A | 🚧 N/A | 🚧 N/A | 🚧 N/A | ❌ | codex/goose: handler script stays manually invocable (e.g. `bash .agents/hooks/handlers/code-index-guard.sh`), intent recorded in the audit-metadata file below |
| `PostToolUse` | ✅ native | ❌ | 🚧 N/A | 🚧 N/A | 🚧 N/A | 🚧 N/A | ❌ | Re-run the handler manually after the edit (e.g. `plan-lint.sh <file>`); otherwise only PR review catches what the hook would have |
| `SessionStart` | ✅ native | ❌ | 🚧 N/A | 🚧 N/A | 🚧 N/A | 🚧 N/A | ❌ | Run the `preflight` skill manually at session start |
| `SessionEnd` | ✅ native | ❌ | 🚧 N/A | 🚧 N/A | 🚧 N/A | 🚧 N/A | ❌ | Call the `/end-session` skill explicitly — it invokes the same `session-end.sh` logic |
| `Stop` | ✅ native | ❌ | 🚧 N/A | 🚧 N/A | 🚧 N/A | 🚧 N/A | ❌ | No manual equivalent defined; best-effort only on claude-code |
| `UserPromptSubmit` | ✅ native | ❌ | 🚧 N/A | 🚧 N/A | 🚧 N/A | 🚧 N/A | ❌ | No manual equivalent; prompt logging under `.hseos/runs/sessions/<id>/prompts/` simply does not occur |
| `PreCompact` | ✅ native | ❌ | 🚧 N/A | 🚧 N/A | 🚧 N/A | 🚧 N/A | ❌ | Manually snapshot next-steps/open-questions before compacting; `pre-compact.sh` only fires on claude-code |
| `Notification` | ✅ native | ❌ | 🚧 N/A | 🚧 N/A | 🚧 N/A | 🚧 N/A | ❌ | Terminal-bell fallback lives inside `on-notification.sh`, which itself only fires on claude-code — no notification reaches other adapters |

`codex` and `goose` are not silently dropping hooks: both emit an audit-only metadata file recording every active hook's id/event/command for manual/human fallback — `codex` writes `.codex/hseos-hooks.json` (`buildCodexHooksMeta` in `tools/cli/installers/lib/core/agent-core-compiler/adapters/codex.js`), `goose` writes `.goose/hooks-metadata.json` (`_emitHooksMeta` in `.../adapters/goose.js`). Neither executes the hook; both are explicitly out of `capabilities` (goose's own capability list is `['slash_commands', 'mcp_stdio', 'skill_markdown']` — hooks are absent, not degraded).

Legend:
- ✅ **native** — adapter's spec declares the event under `capabilities.hooks.events`
- ❌ **unsupported** — adapter exists and has a spec, but that spec declares zero hook events (`events: []`); the row's "Fallback" column documents the alternative
- 🚧 **N/A** — no adapter spec/implementation exists for this vendor yet (not merged; see Adapters table above), so there is nothing to rate

## Per-handler portability snapshot (W4-impl)

Each handler in this snapshot was authored with the matrix in mind. The fallback for `Notification` (terminal bell), the silent no-op when no code-index provider is detected, the `HSEOS_BYPASS_INDEX=1` escape hatch, and the gating-by-config of vault writes are all expressions of P6 (graceful degradation) so the handlers run in every adapter — even those that lack the native event — without breaking. For Codex, the compiler emits `.codex/hseos-hooks.json` so hook intent remains auditable even though Codex CLI does not consume `.claude/hooks.json`.

**Not exhaustive:** `.agents/hooks/handlers/` holds 21 handler scripts today (`ls .agents/hooks/handlers/*.sh | grep -v '_ado-lib' | wc -l` — excludes the shared lib `_ado-lib.sh`; `README.md` doesn't match `*.sh` so it's already out); the 8 rows below are only the original W4-impl core set. Thirteen more were added by later waves and are not yet snapshotted here: `swarm-gate.sh`, `claude-md-guard.sh`, `ado-preflight-gate.sh`, `ado-branch-guard.sh`, `ado-on-plan-write.sh`, `ado-task-progress.sh`, `ado-pr-link.sh`, `ado-tag-close.sh`, `ado-inbox-check.sh`, `telemetry-export-tool.sh`, `telemetry-export-session.sh`, `rtk-rewrite.sh` (status: inactive), `build-resource-guard.sh` (status: inactive). `.agents/hooks/registry.yaml` is the current, exhaustive list — treat it as authoritative over this table for anything not listed below.

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

The **Hook event matrix** above is reconciled against measurement as of 2026-07-24 (see Provenance note at the top), but the reconciliation was manual — this file is still hand-maintained, not generated. The compiler v2 implementation slice (Wave 2) will eventually:

1. Read each adapter's `capabilities` block from its spec yaml
2. Cross-reference with the events declared in `.agents/hooks/registry.yaml`
3. Re-emit this file with no editorial input required

Until then, when adding or modifying a hook entry or adapter spec:

1. Update the relevant cells in the **Hook event matrix** by re-reading `capabilities.hooks.events` from the adapter's spec yaml — never hand-assign native/partial/proxy without checking the spec first
2. Confirm the **fallback prose** on each row still points at a real mechanism (a handler script, a skill, a file path) that exists in this repo
3. Bump the registry version in `.agents/hooks/registry.yaml` if a new event is introduced
4. If a new handler script is added to `.agents/hooks/handlers/`, update the "not exhaustive" list in the **Per-handler portability snapshot** section or move it into the table
