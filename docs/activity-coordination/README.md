# Activity coordination adapters

Adapters for the cross-tool activity coordination track (`.specs/features/harness-w5/coordination.md`). The core (`hseos activity ...`) lives in W5-CO1; this folder documents how each tool plugs into it.

Nothing here has effect until a project adds `.hseos/config/activity-coordination.yaml` with `enabled: true`. Without it every handler exits 0.

## Claude Code

Registered in `.enterprise/governance/hooks/registry.yaml` and compiled into `.claude/hooks.json` (`SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`). The handler `activity-coordination.sh` registers, heartbeats, ends the activity and injects overlaps, inbox notices and overdue claims as `additionalContext`. That text comes from other sessions, so it is sanitized (control and line-break characters removed, fields and total length capped) and presented as quoted data, never as instructions. `session-track.sh` now takes the tool from `HSEOS_AGENT_TOOL` (default `claude-code`).

## Codex

Install is an operational step and is not done by the repository. Evidence: `docs/evolution/w5/evidence/w5-co0/spike.md` (codex-cli 0.162.1, `codex exec`).

1. Copy `codex-hooks.template.json`, replace `{{HSEOS_REPO}}` with the absolute path of the HSEOS checkout.
2. Merge the `hooks` object into `~/.codex/hooks.json` (keep existing entries).
3. Trust the hooks. Only writing `hooks.json` is not enough: an untrusted hook, or one whose hash changed after an edit, does not run. Either (a) obtain each hook's hash from `hooks/list` of `codex app-server` and record `[hooks.state."<hooks.json>:<event>:<group>:<idx>"] trusted_hash = "sha256:..."` in `config.toml`, or (b) trust the hooks in the TUI. The hash changes on every edit of a hook, so repeat after changing the template. The repository does not automate this; it needs the owner's decision.
4. For projects that do not vendor `tools/cli`, export `HSEOS_CLI_PATH` (absolute path of the `hseos` CLI, owned by you and not group/world writable).
5. `codex exec` blocks waiting for input unless stdin is redirected (for example `</dev/null`).

Verified: `SessionStart`, `UserPromptSubmit`, `Stop` and `SessionEnd` fire; the payload carries `session_id`, `cwd`, `hook_event_name`, `transcript_path`, `model`, `permission_mode`; `hookSpecificOutput.additionalContext` from `SessionStart` and `UserPromptSubmit` enters the model context.

NOT VERIFIED: `SubagentStart`, `SubagentStop`, `PreCompact`, `Interrupt`, the interactive session, and why `permission_mode` showed `bypassPermissions` under `exec -s read-only`.

## Trust and timing

- The handler never executes a CLI found in the repository of the session. It uses the CLI of the installation that holds the handler, `HSEOS_CLI_PATH` or the global `hseos`, and only when the file belongs to the user (or root) and is not writable by others (group-writable only when the group is the user's own).
- Each CLI call is capped at 2 s. `SessionEnd` makes one call and no network request, because hosts may cap that hook at about 3 s (Codex does); the template and the registry use 3 s for it.
- NOT VERIFIED: the command form `HSEOS_AGENT_TOOL=codex bash <handler>` has not been exercised in the real Codex (the spike used a direct script as the command).

## Other tools

Tools without hooks follow the `AGENTS.md` section "Activity coordination": `hseos activity check` at the start, `declare` before touching hot files, `reserve` before fixing a version or name.

## Publish guard

Library entry: `runGuardPublish(spec, options)` in `tools/cli/lib/activity-adapters/guard-publish-command.js`. The command `hseos activity guard-publish <pkg>@<version> [--session <id>] [--json]` is available after the CO1 integration (the `activity` command of the core dispatches to it); until then only the library entry exists.

- Package names are lowercase (npm rule); a name with uppercase is an invalid spec (exit 2), never an allow. The version must be valid semver; build metadata is ignored, so `1.0.0+b` equals `1.0.0`.
- With `enforce.publish_guard: true` it exits 1 when the version is reserved by another session or already published; with `false` it only warns (exit 0).
- With enforcement on, a failure reading the store is fail-closed (exit 1, reason `store_unavailable`). A registry (network) failure only warns.
- A contract that cannot be read or validated falls back to the last valid configuration (`.hseos/state/activity-coordination.last-valid.json`); with none, the guard is inactive and says so.

## Optional axon mirror

`tools/cli/lib/activity-adapters/axon-adapter.js` mirrors `activity_declared` and `reservation_conflict` as axon handoffs when the axon binary is present. It is never the source of truth and never throws.
