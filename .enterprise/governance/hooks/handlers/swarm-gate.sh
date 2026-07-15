#!/usr/bin/env bash
# ==============================================================================
# HSEOS swarm-gate handler — PreToolUse blocking gate for the Agent tool
# ==============================================================================
# Event:   PreToolUse (matcher: Agent)
# Status:  active — canonical home for the swarm/dev-squad gate logic that used
#          to live at ~/.claude/hooks/suggest-skill-before-agent.sh
#
# Responsibilities:
#   1. Model routing guard — execution subagents must declare model="sonnet";
#      Opus is reserved for Commander/planning unless strategic opt-in.
#   2. Skill-check advisory — when a subagent prompt matches a canonical skill
#      regex, surface a suggestion to invoke the skill directly.
#   3. SWARM gate (blocking) — when the dev-squad pattern is detected and a
#      dev-squad run is NOT already active, force human confirmation.
#
# dev-squad active-run bypass (three OR'd signals):
#   - .hseos/runs/dev-squad/<id>/INTAKE.md modified in the last 6h
#   - prompt contains a SWARM marker ([dev-squad-active], SWARM-RUN:, TASK-PROMPT:, etc.)
#   - DEV_SQUAD_ACTIVE_FLAG=1 in the hook env
#
# Hook event contract (stdin JSON):
#   { tool_name, tool_input: { prompt, description, subagent_type, ... }, ... }
#
# Hook output (stdout JSON):
#   { hookSpecificOutput: { hookEventName, permissionDecision: allow|ask,
#                           additionalContext: "<suggestion-or-guard>" } }
# ==============================================================================

set -euo pipefail

INPUT="$(cat)"
PROMPT="$(echo "$INPUT" | jq -r '.tool_input.prompt // ""')"
SUBAGENT="$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""')"
DESC="$(echo "$INPUT" | jq -r '.tool_input.description // ""')"
MODEL="$(echo "$INPUT" | jq -r '.tool_input.model // ""')"

HAY="$(printf '%s\n%s\n%s\n%s\n' "$DESC" "$PROMPT" "$SUBAGENT" "$MODEL" | tr '[:upper:]' '[:lower:]')"

# ------------------------------------------------------------------------------
# Model routing guard.
# Execution subagents must not inherit an Opus main-thread model by accident.
# Opus is reserved for Commander/planning/strategic review. Sonnet is the default
# executor for squad/dev-squad tasks unless the prompt explicitly marks a
# strategic Opus opt-in.
# ------------------------------------------------------------------------------
MODEL_LC="$(printf '%s' "$MODEL" | tr '[:upper:]' '[:lower:]')"
EXECUTION_SIGNALS='implement|execute|fix|refactor|test|docs|write|edit|update|create|corrigir|implementar|executar|refatorar|testar|documentar|editar|atualizar|criar|worker|executor|squad|worktree|wave|onda'
PLANNING_SIGNALS='plan|planning|commander|architect|architecture|strategic|strategy|planej|arquitet|estratég|estrateg|design doc|rfc|adr'
STRATEGIC_OPT_IN='strategic.*opus|opus.*strategic|opus opt-in|opt-in.*opus|piv[oô].*arquitet|adr|architecture decision|decis[aã]o arquitet'

if echo "$HAY" | grep -Eq "$EXECUTION_SIGNALS" && ! echo "$HAY" | grep -Eq "$STRATEGIC_OPT_IN"; then
  if [[ -z "$MODEL_LC" ]]; then
    MSG=$(cat <<'EOF'
[MODEL ROUTING] Agent de execução sem modelo explícito.

Regra HSEOS/Claude: Opus 4.7 planeja; Sonnet executa. Subagents de execução não podem herdar Opus por acidente.

Defina model="sonnet" neste Agent call, ou marque explicitamente como strategic Opus opt-in se for planejamento/arquitetura.
EOF
)
    jq -nc --arg msg "$MSG" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "execution-agent-missing-sonnet-model",
        additionalContext: $msg
      }
    }'
    exit 0
  fi

  if echo "$MODEL_LC" | grep -Eq 'opus'; then
    MSG=$(cat <<'EOF'
[MODEL ROUTING] Agent de execução usando Opus.

Regra HSEOS/Claude: Opus 4.7 fica restrito a planejamento Commander, decomposição estratégica e decisões arquiteturais. Execução small/medium/large deve usar Sonnet.

Troque este Agent call para model="sonnet", ou registre no plano que esta tarefa é strategic Opus opt-in.
EOF
)
    jq -nc --arg msg "$MSG" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "execution-agent-opus-not-allowed-without-opt-in",
        additionalContext: $msg
      }
    }'
    exit 0
  fi
fi

if echo "$HAY" | grep -Eq "$PLANNING_SIGNALS" && [[ -z "$MODEL_LC" ]]; then
  MSG=$(cat <<'EOF'
[MODEL ROUTING] Agent de planejamento sem modelo explícito.

Para planejamento Commander/dev-squad, use model="opus" ou "claude-opus-4-7". Para execução, use model="sonnet".
EOF
)
  jq -nc --arg msg "$MSG" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "planning-agent-model-reminder",
      additionalContext: $msg
    }
  }'
  exit 0
fi

# ------------------------------------------------------------------------------
# Skill trigger dictionary.
#   Format:   SKILLS[slug]="regex_pt_en"
#   Matched case-insensitively against description + prompt + subagent_type.
# Keep patterns literal and specific; avoid generic words that false-positive.
# ------------------------------------------------------------------------------
declare -A SKILLS

# dev-squad: 3+ parallel heterogeneous tasks, Opus plans + Sonnets execute
SKILLS[dev-squad]='paralelo|parallel agents?|multiple.*workers?|in paralelo|em paralelo|worktree|múltiplos.*repos?|multiple.*repos?|batch commit|3\+.*tasks?|3 tasks?|5 agentes?|several agents?|ondas? paralelas?|parallel waves?'

# context-compression: token window near limit
SKILLS[context-compression]='compact(ar)?( )?(context|conversation)?|comprimir contexto|compress(ing)? (the )?context|long session|session longa|token limit|window.*limit|janela.*contexto|recomeçar.*sessão|handoff.*context'

# context-engineering: new session, switching tasks, context loading, degrading quality
SKILLS[context-engineering]='new session|nova sessão|switch(ing)? tasks?|trocar tasks?|load context|carregar contexto|5 levels?|5 níveis|níveis de contexto|quality.*degrad|qualidade.*degrad|output.*degrad|agente degradando'

# session-handoff: end of session, resume later
SKILLS[session-handoff]='session handoff|handoff (artifact|structured|entre sessões)|próxima sessão|resume (the|this|same) (task|work|session)|retomar sessão|future (agent|session).*resume|ending.*work session'

# review: review a PR / diff before merge
SKILLS[review]='code[- ]review|review.*(pr|diff|pull request|changes)|revisar (o )?(diff|pr|código|changes)|peer review'

# security-review: security audit of pending changes
SKILLS[security-review]='security[- ]review|security audit|vulnerab|cve scan|sast|dependency check|análise de segurança|auditoria de segurança|owasp'

# simplify: review changed code for reuse/quality/efficiency
SKILLS[simplify]='simplify|refactor.*(reuse|quality|efficiency|duplicat)|clean[- ]?up|dedup(licate|ing)?|reutiliza(r|ção) (de )?código'

# rfc: technical decision record / design doc
SKILLS[rfc]='rfc|adr|architectural decision|design doc|technical decision|decisão técnica|trade[- ]?offs?|options.*comparison'

# loop: run something on a recurring interval
SKILLS[loop]='recurring|recorrente|every (\d+|few).*(minutes|hours)|cada \d+ min|intervalo regular|poll(ing)? every|babysit'

# schedule: cron-based scheduled remote agent
SKILLS[schedule]='schedule|cron|agendar (tarefa|agente)|scheduled (agent|trigger)|crontab'

# init: bootstrap CLAUDE.md for a codebase
SKILLS[init]='generate claude\.md|bootstrap claude\.md|initialize.*project.*docs|codebase overview doc|document(ar)? o (repo|codebase)'

# end-session: close & consolidate in second brain
SKILLS[end-session]='end (the )?session|encerrar sessão|fechar sessão|consolidate.*second.?brain|segundo cérebro.*fech'

# claude-api: build/debug Claude API apps (SDK)
SKILLS[claude-api]='anthropic sdk|@anthropic-ai/sdk|claude api|prompt cach(e|ing)|cache hit rate'

# gitops-deploy: update image tag on running service
SKILLS[gitops-deploy]='gitops.*deploy|update (the )?image tag|bump.*image|kustomize.*overlay|promote.*image'

# gitops-add-service: add a new k8s service
SKILLS[gitops-add-service]='new service.*(deployment|manifest|kustomize)|adicionar (serviço|service).*k8s|novo deployment'

# gitops-new-project: scaffold a new gitops project
SKILLS[gitops-new-project]='new (gitops )?project|scaffolding.*(argocd|namespace|overlay)|criar novo projeto.*k8s'

# update-config: edit settings.json / hooks / permissions
SKILLS[update-config]='settings\.json|claude code harness|edit hooks|add permission|automated behavior|pre[- ]?tool[- ]?use|post[- ]?tool[- ]?use'

# fewer-permission-prompts: scan transcript and add allowlist
SKILLS[fewer-permission-prompts]='permission prompts|allowlist bash|fewer prompts|audit transcript.*bash'

# keybindings-help: customize ~/.claude/keybindings.json
SKILLS[keybindings-help]='keybindings|keyboard shortcut|rebind.*key|chord binding'

# statusline-setup: configure status line
SKILLS[statusline-setup]='status ?line|statusline'

SUGGESTIONS=()
for SLUG in "${!SKILLS[@]}"; do
  PATTERN="${SKILLS[$SLUG]}"
  if echo "$HAY" | grep -Eq "$PATTERN"; then
    SUGGESTIONS+=("$SLUG")
  fi
done

# Filter out skills that are already explicitly invoked in the prompt or via Skill tool
FILTERED=()
for SLUG in "${SUGGESTIONS[@]}"; do
  # Match /slug in text OR skill="slug" (Skill tool invocation)
  if ! echo "$HAY" | grep -Eq "(/$SLUG|skill=[\"']?$SLUG[\"']?)"; then
    FILTERED+=("$SLUG")
  fi
done

if [[ ${#FILTERED[@]} -eq 0 ]]; then
  # No match — allow silently
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
  exit 0
fi

# dev-squad trigger: requires explicit confirmation (blocking gate)
# Other skills: advisory only (allow + additionalContext)
DEV_SQUAD_TRIGGERED=false
for SLUG in "${FILTERED[@]}"; do
  [[ "$SLUG" == "dev-squad" ]] && DEV_SQUAD_TRIGGERED=true
done

LIST=""
for SLUG in "${FILTERED[@]}"; do
  LIST+=$'\n  - /'"$SLUG"
done

FIRST="${FILTERED[0]}"

# ------------------------------------------------------------------------------
# dev-squad active-run detection.
# If a dev-squad / SWARM run is already in flight, the gate must NOT re-ask for
# every Agent dispatch made by the canonical skill itself. Three independent
# signals (OR'd) mark the run as active:
#   1. Filesystem marker — recent INTAKE.md under .hseos/runs/dev-squad/
#   2. Prompt marker     — handoff/task-prompt strings the skill emits
#   3. Env var           — DEV_SQUAD_ACTIVE=1 explicit opt-out
# Manual ad-hoc parallel delegation has none of these → gate still fires.
# ------------------------------------------------------------------------------
DEV_SQUAD_ACTIVE=false
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

if [[ -d "$PROJECT_DIR/.hseos/runs/dev-squad" ]] && \
   find "$PROJECT_DIR/.hseos/runs/dev-squad" -maxdepth 2 -name 'INTAKE.md' -mmin -360 2>/dev/null | grep -q .; then
  DEV_SQUAD_ACTIVE=true
fi

if echo "$HAY" | grep -Eq '\[dev-squad-active\]|swarm-run:|task-prompt:|wave-report:|handoff\.md|\.hseos/runs/dev-squad'; then
  DEV_SQUAD_ACTIVE=true
fi

[[ "${DEV_SQUAD_ACTIVE_ENV:-${DEV_SQUAD_ACTIVE_FLAG:-0}}" == "1" ]] && DEV_SQUAD_ACTIVE=true

if [[ "$DEV_SQUAD_TRIGGERED" == "true" && "$DEV_SQUAD_ACTIVE" == "true" ]]; then
  MSG="dev-squad run already active — skill-gate bypassed for this Agent dispatch."
  jq -nc --arg msg "$MSG" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "dev-squad-run-active",
      additionalContext: $msg
    }
  }'
  exit 0
fi

if [[ "$DEV_SQUAD_TRIGGERED" == "true" ]]; then
  # Blocking gate: permissionDecision "ask" forces human confirmation before Agent fires
  MSG=$(cat <<EOF
[SWARM GATE] Padrão dev-squad detectado nesta delegação Agent.

Skills obrigatórias não invocadas:$LIST

A skill /dev-squad (SWARM) está mapeada para este tipo de trabalho:
  - Commander (Opus) planeja + extrai handoffs
  - Squad (Sonnet/Haiku) executa em worktrees isolados
  - Tier matrix aplicada (haiku/sonnet por default, opus opt-in)
  - 1 task = 1 commit; 1 wave = 1 PR

Para prosseguir sem a skill: confirme explicitamente que este Agent call NÃO se qualifica para dev-squad (tarefa única, sequencial estrita, exploratório sem escopo, ou pivô arquitetural).
EOF
)
  jq -nc --arg msg "$MSG" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "swarm-gate-dev-squad-not-invoked",
      additionalContext: $msg
    }
  }'
else
  # Advisory for other skills
  MSG=$(cat <<EOF
skill-check: antes de delegar via Agent, considere invocar skill(s) que batem com o prompt:$LIST

Se alguma das skills cobre o que você ia pedir ao subagente, invoque-a explicitamente (ex.: chame Skill com skill="$FIRST") em vez da delegação manual. Se nenhuma delas realmente se aplica, ignore esta mensagem e prossiga.
EOF
)
  jq -nc --arg msg "$MSG" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "skills-suggestion",
      additionalContext: $msg
    }
  }'
fi

exit 0
