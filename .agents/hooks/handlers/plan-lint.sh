#!/usr/bin/env bash
# HSEOS plan-lint handler — Wave 4 implementation slice
#
# Event:   PostToolUse (matcher: Write|Edit)
# Status:  active (replaces upstream ~/.claude/hooks/on-post-write-plan-lint.sh)
#
# Lints plan files (any path matching */plans/*.md or plans/*.md) for the canonical
# "## Execution Protocol" section when the plan implies parallel/coordinated
# execution. Per the meta-directive in HSEOS governance, every plan with
# wave/squad/parallel signals MUST formalize:
#   - Coordination model (Commander/Squad + tier matrix)
#   - Governance invariants (worktree, commit hygiene, gates)
#   - Versioning per wave
#   - Wave-to-squad mapping
#
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: running twice produces the same result
#   - Best-effort: never blocks the triggering action; exit 0 always
#   - Project-scoped: no ~/.claude or vault references
#   - Config-aware: matches generic */plans/*.md and plans/*.md patterns
#   - Fail-open: silent when invoked with no input or unrelated tool

set -euo pipefail

# The compiled hook entry passes the file path as $1.
FILE_PATH="${1:-}"

# No file path provided — silent no-op (e.g. wrong matcher)
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Apply only to plan files
case "$FILE_PATH" in
  */plans/*.md | plans/*.md) ;;
  *) exit 0 ;;
esac

# File must exist
[[ -f "$FILE_PATH" ]] || exit 0

# Detect parallel/multi-task signals in the plan content.
# grep -oE counts occurrences (not lines). Wrap in subshell with `|| true`
# so a no-match (grep exit 1) does not fail the pipeline under set -o pipefail.
SIGNALS=$( (grep -oiE '\b(wave|parallel|paralelo|squad|dev-squad|swarm|worktree|fan-out|map-reduce)\b' "$FILE_PATH" 2>/dev/null || true) | wc -l | tr -d ' ')
SIGNALS=${SIGNALS:-0}

# Threshold: 3+ signals → plan implies parallel/coordinated execution
if [[ "$SIGNALS" -lt 3 ]]; then
  exit 0
fi

# Check for the canonical Execution Protocol section
if grep -qiE '^##.*Execution Protocol' "$FILE_PATH" 2>/dev/null; then
  exit 0
fi

# Section missing — emit advisory reminder (does NOT block)
printf '[HSEOS][PLAN-LINT] Plan %s uses parallel/coordinated execution signals (%s occurrences) but does NOT declare a "## Execution Protocol" section.\n' "${FILE_PATH##*/}" "$SIGNALS"
printf '  HSEOS canonical directive: every plan with coordinated flow MUST formalize:\n'
printf '    - Coordination model (Commander/Squad + tier matrix)\n'
printf '    - Governance invariants (worktree, commit hygiene, gates)\n'
printf '    - Versioning per wave (git tag + canonical doc updates)\n'
printf '    - Wave-to-squad mapping\n'
printf '  Reference: .agents/skills/dev-squad/SKILL.md or .hseos/workflows/dev-squad/workflow.yaml\n'

exit 0
