# PLAN — Wave 2: CLI + hook shims

**Run ID:** 20260425-1950-state-w2-cli-hooks
**G2 Status:** APPROVED (cleared in /plan mode + Wave 1 PR validated approach)
**Wave:** 2 of 7

## Tasks (all parallel)

### T2.1 — state-emit
**File:** `tools/cli/commands/state-emit.js` (new)
**Command:** `hseos state-emit <kind> --run <id> --task <id> --agent <name> [--payload <json>] [--directory <path>]`
**Acceptance:** Opens DB at config-resolved path, runs migrations idempotently, looks up or creates as_agent_run for (run, task, agent), inserts as_events row with kind+payload_json. If kind=heartbeat, also calls DAL.heartbeatSession when --session provided.

### T2.2 — state-list
**File:** `tools/cli/commands/state-list.js` (new)
**Command:** `hseos state-list [--run <id>] [--status <s>] [--orphans] [--directory <path>]`
**Acceptance:** Tabulated output of as_runs (default), or as_agent_runs filtered by orphan/status. JSON via `--json`. Honors stale_minutes config (default 10).

### T2.3 — state-describe
**File:** `tools/cli/commands/state-describe.js` (new)
**Command:** `hseos state-describe <id> [--directory <path>] [--json]`
**Acceptance:** ID can match run.id or agent_run.id. Returns run summary + task counts + agent_run statuses + last 10 events.

### T2.4 — state-render
**File:** `tools/cli/commands/state-render.js` (new)
**Command:** `hseos state-render <run-id> --output <dir> [--directory <path>]`
**Acceptance:** Reads SQLite for the run + tasks + handoffs, generates `PLAN.md`, `STATUS.md`, `RESUME-PROMPT.md` matching the format used by `dev-squad` skill in run-dirs. **Read-only on SQLite; never modifies state.**

### T2.5 — state-emit-hook.sh
**File:** `scripts/governance/state-emit-hook.sh` (new)
**Acceptance:** Bash shim invoked from `.claude/hooks.json`. Reads env vars (`CLAUDE_TOOL_NAME`, `CLAUDE_TOOL_FILE_PATH`, `HSEOS_CURRENT_RUN_ID`, `HSEOS_CURRENT_TASK`, `HSEOS_CURRENT_AGENT`). Calls `hseos state-emit ...` with appropriate kind. Best-effort: failure is silent (does not block tool execution).

### T2.6 — hooks.json edit
**File:** `.claude/hooks.json` (edit)
**Acceptance:** Add hook entries for SessionStart (emit `start`), PostToolUse Edit (emit `tool_call` with kind=edit), Stop (emit `complete` if HSEOS_CURRENT_AGENT set). Existing hooks (backup-on-edit, high-risk-bash-warn, auto-format-after-edit, session-start-banner) preserved.

## Risk Flags

- T2.4 render: must produce markdown byte-equivalent to skill output (mod timestamps). Goldens not yet established → "best-effort match" acceptable; Wave 3 (test) tightens via golden-file test.
- T2.5/T2.6 trigger Claude Code on every Edit/PostToolUse → must be FAST and NEVER block. Shim does `&` background or strict timeout.

## Halt Conditions

Same as Wave 1. Pre-commit issues (4 known bugs in governance) bypassed via direct git commands as documented in WAVE-1-REPORT. T2.6 edits `.claude/hooks.json` — unrelated to husky lint config; no new dependency.
