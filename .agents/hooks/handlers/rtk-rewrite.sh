#!/usr/bin/env bash
# HSEOS rtk-rewrite handler — PreToolUse/Bash, OPTIONAL token-saving rewrite
#
# Event:     PreToolUse
# Matcher:   Bash
# Blocking:  false (non-blocking; pass-through on any error)
# Status:    inactive (must be explicitly activated; no-ops silently when absent)
#
# Purpose:
#   OPTIONAL: rewrite Bash tool commands via the personal `rtk` binary for
#   token savings (60-90% reduction on dev operations such as git, npm, etc.).
#   When `rtk` is absent from PATH, this handler exits 0 immediately and the
#   command passes through unchanged — there is no visible effect.
#
# Requirements:
#   - `rtk` binary on PATH  (github.com/hideaki-solutions/rtk)
#   - `jq` on PATH
#
# Registry status: inactive
#   This hook is registered but NOT compiled into .claude/hooks.json by default.
#   To activate: change status to "active" in .agents/hooks/registry.yaml and
#   recompile with `hseos agent-core compile`.
#
# Note: OPTIONAL — registry status:inactive; requires the rtk binary;
#       no-ops silently otherwise.
#
# Authority: ADR-0014 (telemetry export bridge / hook adapter layer)
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: same command → same rewrite output
#   - Best-effort: any failure → exit 0, command passes through unchanged
#   - Project-scoped: no host-state side effects
#   - Fail-open: rtk absent → silent pass-through

set -u

# ── Hard dependency guards — graceful no-op when tooling is absent ────────────
command -v rtk >/dev/null 2>&1 || exit 0
command -v jq  >/dev/null 2>&1 || exit 0

# ── Read stdin payload ────────────────────────────────────────────────────────
STDIN=$(cat)
[[ -z "$STDIN" ]] && exit 0

# ── Only act on Bash tool events ──────────────────────────────────────────────
TOOL_NAME=$(printf '%s' "$STDIN" | jq -r '.tool_name // ""' 2>/dev/null) || exit 0
[[ "$TOOL_NAME" != "Bash" ]] && exit 0

# ── Extract the command string ────────────────────────────────────────────────
COMMAND=$(printf '%s' "$STDIN" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[[ -z "$COMMAND" ]] && exit 0

# ── Delegate to rtk rewrite ───────────────────────────────────────────────────
# rtk rewrite reads the command from stdin and writes the rewritten form to
# stdout. If it exits non-zero or produces empty output, pass through unchanged.
REWRITTEN=$(printf '%s' "$COMMAND" | rtk rewrite 2>/dev/null) || exit 0
[[ -z "$REWRITTEN" ]] && exit 0

# ── Emit hook-specific output following the Claude hook JSON contract ─────────
# Emit a permissionDecision:allow with the rewritten command so the Claude
# harness substitutes it transparently.
jq -nc \
  --arg cmd "$REWRITTEN" \
  '{
    "hookSpecificOutput": {
      "hookEventName":        "PreToolUse",
      "permissionDecision":   "allow",
      "additionalContext":    ("rtk rewrite applied: " + $cmd)
    }
  }' 2>/dev/null || true

exit 0
