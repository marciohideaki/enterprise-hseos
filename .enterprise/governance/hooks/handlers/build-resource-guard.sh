#!/usr/bin/env bash
# HSEOS build-resource-guard handler — PreToolUse/Bash, OPT-IN parallelism cap
#
# Event:     PreToolUse
# Matcher:   Bash
# Blocking:  true (can emit permissionDecision:deny to cap excessive parallelism)
# Status:    inactive (must be explicitly activated via HSEOS_BUILD_MAX_JOBS)
#
# Purpose:
#   OPT-IN build resource guard: caps make/cmake/ninja parallelism at
#   HSEOS_BUILD_MAX_JOBS on resource-constrained hosts.
#
#   When HSEOS_BUILD_MAX_JOBS is unset or 0 (default), this handler exits 0
#   immediately — it is a complete no-op with no effect on build commands.
#
# Opt-in:
#   HSEOS_BUILD_MAX_JOBS=<N>       Set to the max allowed -j/--jobs value (>0)
#   HSEOS_BUILD_GUARD_DISABLE=1    Emergency escape hatch to disable per-session
#
# Detected build tools:
#   make, cmake, ninja (with -j<N> or --jobs <N> / --jobs=<N> flag)
#
# Registry status: inactive
#   This hook is registered but NOT compiled into .claude/hooks.json by default.
#   To activate: set HSEOS_BUILD_MAX_JOBS and change status to "active" in
#   .agents/hooks/registry.yaml, then recompile.
#
# Authority: ADR-0014 (telemetry export bridge / hook adapter layer)
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: same command → same allow/deny decision
#   - Best-effort: any parsing failure → allow (exit 0)
#   - Project-scoped: no host-state side effects
#   - Fail-open: guard disabled or unset → silent allow

set -u

# ── Default no-op: exit unless explicitly opted in ────────────────────────────
MAX_JOBS="${HSEOS_BUILD_MAX_JOBS:-0}"
[[ "$MAX_JOBS" -le 0 ]] && exit 0

# ── Emergency escape hatch ────────────────────────────────────────────────────
[[ "${HSEOS_BUILD_GUARD_DISABLE:-0}" == "1" ]] && exit 0

# ── Tool guard ────────────────────────────────────────────────────────────────
command -v jq >/dev/null 2>&1 || exit 0

# ── Read stdin payload ────────────────────────────────────────────────────────
STDIN=$(cat)
[[ -z "$STDIN" ]] && exit 0

# ── Only act on Bash tool events ──────────────────────────────────────────────
TOOL_NAME=$(printf '%s' "$STDIN" | jq -r '.tool_name // ""' 2>/dev/null) || exit 0
[[ "$TOOL_NAME" != "Bash" ]] && exit 0

# ── Extract command string ────────────────────────────────────────────────────
COMMAND=$(printf '%s' "$STDIN" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[[ -z "$COMMAND" ]] && exit 0

# ── Check for build tools invocation ─────────────────────────────────────────
# Match: make, cmake --build, ninja when called at the start of the command
# or as the first token of any pipeline stage (simple heuristic).
if ! printf '%s' "$COMMAND" | grep -qE '(^|\|[[:space:]]|&&[[:space:]]|;[[:space:]])(make|cmake|ninja)[[:space:]]'; then
  exit 0
fi

# ── Extract parallelism value from -j<N>, -j <N>, --jobs <N>, --jobs=<N> ─────
# Capture the first occurrence of a jobs flag.
JOBS_VAL=""

# -j<N> (no space, e.g. -j8 or -j16)
if printf '%s' "$COMMAND" | grep -qE -- '-j([0-9]+)'; then
  JOBS_VAL=$(printf '%s' "$COMMAND" | grep -oE -- '-j([0-9]+)' | head -1 | grep -oE '[0-9]+')
fi

# -j <N> or --jobs <N> or --jobs=<N>
if [[ -z "$JOBS_VAL" ]]; then
  if printf '%s' "$COMMAND" | grep -qE -- '(-j[[:space:]]+[0-9]+|--jobs[[:space:]]+[0-9]+|--jobs=[0-9]+)'; then
    JOBS_VAL=$(printf '%s' "$COMMAND" | grep -oE '(-j[[:space:]]+[0-9]+|--jobs[[:space:]]+[0-9]+|--jobs=[0-9]+)' | head -1 | grep -oE '[0-9]+')
  fi
fi

# No explicit jobs flag found → allow (the build tool will use its own default)
[[ -z "$JOBS_VAL" ]] && exit 0

# ── Compare against cap ───────────────────────────────────────────────────────
if [[ "$JOBS_VAL" -gt "$MAX_JOBS" ]]; then
  jq -nc \
    --arg reason "Build parallelism -j${JOBS_VAL} exceeds HSEOS_BUILD_MAX_JOBS=${MAX_JOBS}. Reduce with -j${MAX_JOBS} or unset HSEOS_BUILD_MAX_JOBS to disable this guard." \
    '{
      "hookSpecificOutput": {
        "hookEventName":              "PreToolUse",
        "permissionDecision":         "deny",
        "permissionDecisionReason":   $reason,
        "additionalContext":          "Set HSEOS_BUILD_MAX_JOBS=0 or HSEOS_BUILD_GUARD_DISABLE=1 to bypass."
      }
    }' 2>/dev/null || true
fi

exit 0
