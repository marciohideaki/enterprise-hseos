#!/usr/bin/env bash
# HSEOS on-prompt-submit handler — Wave 4 implementation slice (W4-T3)
#
# Event:   UserPromptSubmit
# Status:  active (replaces upstream ~/.claude/hooks/on-prompt-submit.sh)
#
# Project-scoped prompt logger and dev-squad advisory. Reads the prompt
# JSON payload from stdin (per the Claude Code hook signature) and:
#   1. Logs the prompt to .hseos/runs/sessions/<session-id>/prompts/
#   2. Detects /plan + heterogeneous task signals and emits a SWARM
#      advisory pointing to the .agents/skills/dev-squad/ canonical
#      location (no host-state references)
#
# Vault writes (activity log, prompt log to vault) are deliberately
# omitted; that is the responsibility of the optional session-end
# handler when second_brain.enabled is true.
#
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: re-logging the same prompt is fine (timestamp-keyed)
#   - Best-effort: never blocks the triggering action; exit 0 always
#   - Project-scoped: writes only inside .hseos/runs/sessions/
#   - Config-aware: skips silently when not in an HSEOS-installed project
#   - Fail-open: silent no-op when stdin parsing fails or jq is absent
#
# Environment:
#   HSEOS_SESSION_ID      — opaque session id (default: pid + day)

set -euo pipefail

# stdin can only be read once — capture it before any other operation
INPUT=""
if [[ ! -t 0 ]]; then
  INPUT=$(cat 2>/dev/null || true)
fi

PROJECT_ROOT="$(pwd)"

# Skip silently when not running in an HSEOS-installed project
if [[ ! -d "$PROJECT_ROOT/.hseos" ]]; then
  exit 0
fi

# Extract prompt + cwd. Best-effort jq extraction; if jq absent or input
# is not JSON, the variables remain empty and the handler exits silently.
PROMPT=""
CWD="$PROJECT_ROOT"
if [[ -n "$INPUT" ]] && command -v jq >/dev/null 2>&1; then
  PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || echo "")
  CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "$PROJECT_ROOT")
fi

# No prompt extracted — silent no-op
if [[ -z "$PROMPT" ]]; then
  exit 0
fi

SESSION_ID="${HSEOS_SESSION_ID:-pid-$$-$(date +%Y%m%d)}"
PROMPTS_DIR="$PROJECT_ROOT/.hseos/runs/sessions/$SESSION_ID/prompts"
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
PROMPT_FILE="$PROMPTS_DIR/${TIMESTAMP}-${$}.md"

mkdir -p "$PROMPTS_DIR" 2>/dev/null || exit 0

# Log the prompt — single source of truth, project-scoped
{
  printf '# Prompt — %s\n\n' "$TIMESTAMP"
  printf '**cwd:** `%s`\n\n' "${CWD##*/}"
  printf '**session:** `%s`\n\n' "$SESSION_ID"
  printf -- '---\n\n'
  printf '%s\n' "$PROMPT"
} > "$PROMPT_FILE" 2>/dev/null || true

# Detect /dev-squad trigger — emit advisory once per session per project
# Trigger: /plan + 4+ heterogeneous task indicators
SWARM_ADVISED_FLAG="$PROJECT_ROOT/.hseos/runs/sessions/$SESSION_ID/.swarm-advised"
if [[ ! -f "$SWARM_ADVISED_FLAG" ]] && echo "$PROMPT" | grep -qE '(^|[[:space:]])/plan(\s|$)'; then
  TASK_INDICATORS=$( (echo "$PROMPT" | grep -oiE '\b(feature|fix|refactor|docs?|test|deploy|implementar|criar|corrigir|adicionar|atualizar|reorganizar|consolidar|propor|verificar|analisar|migrar|integrar|expor|reescrever|renomear)\b' || true) | wc -l | tr -d ' ')
  TASK_INDICATORS=${TASK_INDICATORS:-0}
  if [[ "$TASK_INDICATORS" -ge 4 ]]; then
    touch "$SWARM_ADVISED_FLAG" 2>/dev/null || true
    printf '[HSEOS][SWARM] /plan with %s heterogeneous task signals detected.\n' "$TASK_INDICATORS"
    printf '  Consider activating /dev-squad BEFORE Phase 1 of the plan:\n'
    printf '    - Skill:     .agents/skills/dev-squad/SKILL.md\n'
    printf '    - Agent:     SWARM (.hseos/agents/swarm.agent.yaml)\n'
    printf '    - Workflow:  .hseos/workflows/dev-squad/workflow.yaml\n'
    printf '  Protocol: Commander (Opus) plans + extracts handoffs; Squad\n'
    printf '  (Sonnet/Haiku) executes worktree-isolated. 1 task = 1 commit;\n'
    printf '  1 wave = 1 PR.\n'
    printf '  SKIP if: single task, strict-sequential, exploratory, or\n'
    printf '  architectural pivot.\n'
  fi
fi

exit 0
