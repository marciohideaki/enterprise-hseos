#!/bin/bash
# ==============================================================================
# swarm-gate.sh — PreToolUse:Agent hook (HSEOS-aware SWARM enforcement)
# ==============================================================================
# Complementa o gate global (~/.claude/hooks/suggest-skill-before-agent.sh).
# Enquanto o global detecta padrões de texto e pede confirmação, este gate
# verifica o estado concreto do HSEOS:
#   1. Detecta padrão SWARM no prompt do Agent
#   2. Verifica se há run ativo em .hseos/runs/dev-squad/ com PLAN.md aprovado
#   3. Verifica se worktree-manager.sh está sendo referenciado (invariante)
#
# Resultado:
#   - Padrão SWARM + sem run ativo → permissionDecision: "ask" (bloqueante)
#   - Padrão SWARM + run ativo (PLAN.md presente) → allow + context
#   - Sem padrão SWARM → allow silencioso
# ==============================================================================

set -euo pipefail

INPUT="$(cat)"
PROMPT="$(echo "$INPUT" | jq -r '.tool_input.prompt // ""')"
DESC="$(echo "$INPUT"   | jq -r '.tool_input.description // ""')"
SUBAGENT="$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""')"

HAY="$(printf '%s\n%s\n%s\n' "$DESC" "$PROMPT" "$SUBAGENT" | tr '[:upper:]' '[:lower:]')"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
RUNS_DIR="${REPO_ROOT}/.hseos/runs/dev-squad"

# ------------------------------------------------------------------------------
# 1. Detectar padrão SWARM
# ------------------------------------------------------------------------------
SWARM_PATTERN='paralelo|parallel agents?|multiple.*workers?|em paralelo|in parallel|worktree|múltiplos.*repos?|batch commit|3\+.*tasks?|várias tasks?|several (tasks?|agents?)|ondas? paralelas?|parallel waves?|dev[-_]squad|swarm'

if ! echo "$HAY" | grep -Eiq "$SWARM_PATTERN"; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
  exit 0
fi

# Ignorar se já está dentro de um run SWARM (skill ou DS já foi invocado)
if echo "$HAY" | grep -Eiq "(skill=[\"']?dev[-_]squad[\"']?|/dev-squad|ds\b.*wave|commander.*wave|wave.*commander)"; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
  exit 0
fi

# ------------------------------------------------------------------------------
# 2. Verificar se há run ativo com G2 aprovado
# ------------------------------------------------------------------------------
ACTIVE_RUN=""
ACTIVE_PLAN=""

if [[ -d "$RUNS_DIR" ]]; then
  # Run ativo = diretório com STATUS.md cujo conteúdo não é COMPLETE/CANCELLED
  while IFS= read -r -d '' run_dir; do
    status_file="${run_dir}/STATUS.md"
    plan_file="${run_dir}/PLAN.md"
    if [[ -f "$status_file" ]]; then
      status="$(grep -m1 '^status:' "$status_file" 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo '')"
      if ! echo "$status" | grep -qE '(complete|cancel|done|blocked)'; then
        ACTIVE_RUN="$(basename "$run_dir")"
        [[ -f "$plan_file" ]] && ACTIVE_PLAN="$plan_file"
        break
      fi
    fi
  done < <(find "$RUNS_DIR" -maxdepth 1 -mindepth 1 -type d -print0 2>/dev/null | sort -rz)
fi

# ------------------------------------------------------------------------------
# 3. Verificar invariante worktree-manager
# ------------------------------------------------------------------------------
WTM_MISSING=false
if ! echo "$HAY" | grep -iq "worktree.manager"; then
  WTM_MISSING=true
fi

# ------------------------------------------------------------------------------
# 4. Decisão
# ------------------------------------------------------------------------------

if [[ -n "$ACTIVE_RUN" && -n "$ACTIVE_PLAN" ]]; then
  # Run ativo com G2 aprovado — deixa passar, mas lembra os invariantes
  WARNINGS=""
  [[ "$WTM_MISSING" == "true" ]] && WARNINGS="\n⚠️  worktree-manager.sh não mencionado no prompt — invariante obrigatório (create→validate→commit→merge→remove)."

  MSG="[SWARM] Run ativo detectado: ${ACTIVE_RUN} (G2 aprovado ✓)${WARNINGS}"

  jq -nc --arg msg "$MSG" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: $msg
    }
  }'
  exit 0
fi

# Sem run ativo — bloqueia e exige inicialização via DS ou /dev-squad
WARNINGS=""
[[ "$WTM_MISSING" == "true" ]] && WARNINGS="\n⚠️  worktree-manager.sh não está no prompt (obrigatório quando SWARM executa)."

MSG=$(cat <<EOF
[HSEOS SWARM GATE] Padrão de execução paralela detectado sem run SWARM ativo.

Não foi encontrado nenhum run em progresso em:
  ${RUNS_DIR}/

Para iniciar corretamente:
  • Via menu HSEOS → opção DS (Dev Squad)
  • Ou: invoque Skill com skill="dev-squad"

O protocolo exige:
  1. Commander (Opus) planeja e gera PLAN.md → Gate G2 (aprovação humana)
  2. Squad (Sonnet/Haiku) executa em worktrees isolados via worktree-manager.sh
  3. Tier matrix aplicada (haiku/sonnet default, opus opt-in explícito)
  4. 1 task = 1 commit; 1 wave = 1 PR
${WARNINGS}
Para prosseguir sem SWARM: confirme que esta delegação NÃO é um batch heterogêneo (tarefa única, sequencial estrita, exploratório sem escopo, ou pivô arquitetural exigindo CIPHER).
EOF
)

jq -nc --arg msg "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: "hseos-swarm-gate-no-active-run",
    additionalContext: $msg
  }
}'

exit 0
