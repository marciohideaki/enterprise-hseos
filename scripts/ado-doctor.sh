#!/usr/bin/env bash
# ADO-Ops Doctor — diagnostic check for ADO integration health
# Usage: bash scripts/ado-doctor.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
HSEOS_CONFIG="${PROJECT_ROOT}/.hseos/config/hseos.config.yaml"
HOOKS_JSON="${PROJECT_ROOT}/.claude/hooks.json"
MANIFEST="${PROJECT_ROOT}/.agents/manifest.yaml"

PASS=0
FAIL=0
WARN=0

ok()   { echo "  ✓ $*"; ((PASS++)) || true; }
fail() { echo "  ✗ $*" >&2; ((FAIL++)) || true; }
warn() { echo "  ⚠ $*"; ((WARN++)) || true; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ADO Doctor — $(basename "$PROJECT_ROOT")  "
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── Check 1: ado.enabled ─────────────────────────────────────
echo "▶ Feature Flag"
if [[ -f "$HSEOS_CONFIG" ]]; then
  if command -v yq &>/dev/null; then
    ENABLED=$(yq '.ado.enabled // false' "$HSEOS_CONFIG" 2>/dev/null)
  else
    ENABLED=$(awk '/^ado:/{f=1} f && /enabled:/{print; exit}' "$HSEOS_CONFIG" | grep -o 'true\|false' || echo 'false')
  fi
  if [[ "$ENABLED" == "true" ]]; then
    ok "ado.enabled: true"
  else
    warn "ado.enabled: false — execute 'bash scripts/ado-install.sh' para habilitar"
  fi
else
  fail "hseos.config.yaml não encontrado"
fi

# ─── Check 2: ADO_PAT ─────────────────────────────────────────
echo ""
echo "▶ Autenticação"
if [[ -n "${ADO_PAT:-}" ]]; then
  ok "ADO_PAT: presente (${#ADO_PAT} chars)"
else
  warn "ADO_PAT: não definido — export ADO_PAT=<token>"
fi

# ─── Check 3: MCP server ──────────────────────────────────────
echo ""
echo "▶ MCP Server"
CLAUDE_MCP="${HOME}/.claude/mcp.json"
if [[ -f "$CLAUDE_MCP" ]] && command -v jq &>/dev/null; then
  if jq -e '.mcpServers["azure-devops"]' "$CLAUDE_MCP" &>/dev/null; then
    ok "azure-devops: registrado em ~/.claude/mcp.json"
  else
    warn "azure-devops: não encontrado em ~/.claude/mcp.json — execute ado-install.sh"
  fi
else
  warn "~/.claude/mcp.json não verificável (jq ou arquivo ausente)"
fi

if command -v npx &>/dev/null; then
  if npx --no-install @azure-devops/mcp-server --version &>/dev/null 2>&1; then
    ok "@azure-devops/mcp-server: instalado"
  else
    warn "@azure-devops/mcp-server: não instalado — npm install -g @azure-devops/mcp-server"
  fi
else
  warn "npx: não disponível"
fi

# ─── Check 4: Hooks ───────────────────────────────────────────
echo ""
echo "▶ Hooks ADO"
if [[ -f "$HOOKS_JSON" ]]; then
  ADO_HOOK_COUNT=$(python3 -c "
import json, sys
d = json.load(open('$HOOKS_JSON'))
hooks = d.get('hooks', d)
count = 0
for event_hooks in hooks.values() if isinstance(hooks, dict) else []:
  for h in (event_hooks if isinstance(event_hooks, list) else []):
    if 'ado-' in str(h.get('hooks', [{}])[0].get('command','') if isinstance(h,dict) else h):
      count += 1
print(count)
" 2>/dev/null || echo "0")
  if [[ "$ADO_HOOK_COUNT" -ge 6 ]]; then
    ok "Hooks ADO: $ADO_HOOK_COUNT entries em .claude/hooks.json"
  else
    warn "Hooks ADO: apenas $ADO_HOOK_COUNT entries (esperado ≥6)"
  fi
else
  fail ".claude/hooks.json não encontrado"
fi

# ─── Check 5: ATLAS agent ─────────────────────────────────────
echo ""
echo "▶ Agent ATLAS"
ATLAS_YAML="${PROJECT_ROOT}/.hseos/agents/atlas.agent.yaml"
if [[ -f "$ATLAS_YAML" ]]; then
  ok "atlas.agent.yaml: presente"
else
  fail "atlas.agent.yaml: não encontrado"
fi

# ─── Check 6: Skills compiled ─────────────────────────────────
echo ""
echo "▶ Skills (compiled)"
for skill in ado-ops ado-plan ado-sync ado-close-wave ado-new-project; do
  SKILL_OUT="${PROJECT_ROOT}/.agents/skills/${skill}/SKILL.md"
  if [[ -f "$SKILL_OUT" ]]; then
    ok "${skill}: .agents/skills/${skill}/SKILL.md"
  else
    fail "${skill}: não compilado em .agents/skills/"
  fi
done

# ─── Check 7: Workflow ────────────────────────────────────────
echo ""
echo "▶ Workflow"
WORKFLOW="${PROJECT_ROOT}/.hseos/workflows/ado-ops/workflow.md"
if [[ -f "$WORKFLOW" ]]; then
  ok "ado-ops workflow: presente"
else
  fail "ado-ops workflow: não encontrado"
fi

# ─── Check 8: Hook handlers ──────────────────────────────────
echo ""
echo "▶ Hook Handlers"
for hook in ado-preflight-gate ado-branch-guard ado-on-plan-write ado-task-progress ado-pr-link ado-tag-close ado-inbox-check _ado-lib; do
  HANDLER="${PROJECT_ROOT}/.agents/hooks/handlers/${hook}.sh"
  if [[ -f "$HANDLER" ]]; then
    bash -n "$HANDLER" 2>/dev/null && ok "${hook}.sh: present, syntax ok" || fail "${hook}.sh: syntax error"
  else
    fail "${hook}.sh: não encontrado"
  fi
done

# ─── Check 9: _ado-lib.sh sourceability ──────────────────────
echo ""
echo "▶ Helper Library"
LIB="${PROJECT_ROOT}/.agents/hooks/handlers/_ado-lib.sh"
if bash -c "source '$LIB' && type is_ado_enabled &>/dev/null" 2>/dev/null; then
  ok "_ado-lib.sh: sourceable, is_ado_enabled() defined"
else
  fail "_ado-lib.sh: source failed or is_ado_enabled() missing"
fi

# ─── Check 10: Pending inbox events ──────────────────────────
echo ""
echo "▶ ADO Inbox"
INBOX="${PROJECT_ROOT}/.hseos/runs/ado-ops/inbox"
if [[ -d "$INBOX" ]]; then
  PENDING_COUNT=$(find "$INBOX" -name "tag-*.json" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$PENDING_COUNT" -gt 0 ]]; then
    warn "Inbox: ${PENDING_COUNT} evento(s) pendente(s) — execute '/atlas close'"
  else
    ok "Inbox: sem eventos pendentes"
  fi
else
  ok "Inbox: diretório não existe (nenhuma tag processada ainda)"
fi

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL + WARN))
echo "  Resultado: $PASS/$TOTAL checks ok | $WARN avisos | $FAIL falhas"
if [[ $FAIL -gt 0 ]]; then
  echo "  Status: ❌ DEGRADADO"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo "  Status: ⚠️  PARCIAL (funciona com limitações)"
else
  echo "  Status: ✅ SAUDÁVEL"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
