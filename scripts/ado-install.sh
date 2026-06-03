#!/usr/bin/env bash
# ADO-Ops Global Installer
# Enables ADO integration for the current HSEOS project and installs
# hooks globally in ~/.claude/mcp.json and ~/.claude/settings.json
#
# Usage:
#   bash scripts/ado-install.sh          # interactive install
#   bash scripts/ado-install.sh --dry-run # preview changes without applying
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
HSEOS_CONFIG="${PROJECT_ROOT}/.hseos/config/hseos.config.yaml"
CLAUDE_MCP="${HOME}/.claude/mcp.json"
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
DRY_RUN=false

# ─── Parse args ───────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      echo "Usage: $0 [--dry-run]"
      echo "  --dry-run  Preview changes without applying"
      exit 0
      ;;
  esac
done

log() { echo "[ado-install] $*"; }
warn() { echo "[ado-install] ⚠️  $*" >&2; }
dry() { [[ "$DRY_RUN" == "true" ]] && echo "[DRY-RUN] $*" && return 0 || return 1; }

# ─── Step 1: Verify HSEOS project ─────────────────────────────
log "Verificando projeto HSEOS..."
[[ -f "$HSEOS_CONFIG" ]] || { warn "hseos.config.yaml não encontrado em $HSEOS_CONFIG"; exit 1; }
log "✓ Projeto HSEOS detectado: $(basename "$PROJECT_ROOT")"

# ─── Step 2: Check ADO_PAT ────────────────────────────────────
log "Verificando ADO_PAT..."
if [[ -z "${ADO_PAT:-}" ]]; then
  warn "ADO_PAT não definido no env."
  echo ""
  echo "Para obter um PAT:"
  echo "  1. Acesse https://dev.azure.com/{sua-org}/_usersSettings/tokens"
  echo "  2. Crie token com escopo: Work Items (Read & Write), Code (Read)"
  echo "  3. Execute: export ADO_PAT=<token>"
  echo "  4. Recomendado: pass insert azure/ado-pat <<< \"\$ADO_PAT\""
  echo ""
  if [[ "$DRY_RUN" == "true" ]]; then
    warn "DRY-RUN: continuando sem ADO_PAT para preview"
  else
    exit 1
  fi
else
  log "✓ ADO_PAT presente"
fi

# ─── Step 3: Check MCP server availability ────────────────────
log "Verificando MCP server azure-devops..."
if command -v npx &>/dev/null; then
  if npx --no-install @azure-devops/mcp-server --version &>/dev/null 2>&1; then
    log "✓ MCP server @azure-devops/mcp-server disponível"
  else
    warn "MCP server não instalado. Instale com: npm install -g @azure-devops/mcp-server"
    warn "Continuando — servidor pode ser instalado depois."
  fi
else
  warn "npx não disponível. Instale Node.js para usar o MCP server."
fi

# ─── Step 4: Enable ado in hseos.config.yaml ──────────────────
log "Habilitando ado.enabled em hseos.config.yaml..."
_ado_set_enabled() {
  if command -v yq &>/dev/null; then
    yq -i '.ado.enabled = true' "$HSEOS_CONFIG"
  else
    # sed fallback: replace 'enabled: false' only inside the ado: block
    # matches first occurrence after 'ado:' header
    awk '/^ado:/{in_ado=1} in_ado && /enabled: false/{sub(/enabled: false/, "enabled: true"); in_ado=0} {print}' \
      "$HSEOS_CONFIG" > "${HSEOS_CONFIG}.tmp" && mv "${HSEOS_CONFIG}.tmp" "$HSEOS_CONFIG"
  fi
}

# Read current value (yq or awk fallback)
if command -v yq &>/dev/null; then
  CURRENT=$(yq '.ado.enabled // false' "$HSEOS_CONFIG" 2>/dev/null)
else
  CURRENT=$(awk '/^ado:/{f=1} f && /enabled:/{print; exit}' "$HSEOS_CONFIG" | grep -o 'true\|false' || echo 'false')
fi

if [[ "$CURRENT" == "true" ]]; then
  log "✓ ado.enabled já é true — skip"
else
  if dry "Setaria ado.enabled=true em $HSEOS_CONFIG"; then
    :
  else
    _ado_set_enabled
    log "✓ ado.enabled=true aplicado"
  fi
fi

# ─── Step 5: Add azure-devops to ~/.claude/mcp.json ──────────
log "Adicionando azure-devops ao ~/.claude/mcp.json..."
if [[ ! -f "$CLAUDE_MCP" ]]; then
  warn "$CLAUDE_MCP não encontrado — será criado"
  if dry "Criaria $CLAUDE_MCP com entrada azure-devops"; then
    :
  else
    echo '{"mcpServers":{}}' > "$CLAUDE_MCP"
  fi
fi

if command -v jq &>/dev/null && [[ -f "$CLAUDE_MCP" ]]; then
  if jq -e '.mcpServers["azure-devops"]' "$CLAUDE_MCP" &>/dev/null; then
    log "✓ azure-devops já presente em mcp.json — skip"
  else
    ADO_MCP_ENTRY='{
  "command": "npx",
  "args": ["@azure-devops/mcp-server"],
  "env": {
    "ADO_PAT": "${ADO_PAT}",
    "ADO_ORG": "${ADO_ORG}"
  }
}'
    if dry "Adicionaria azure-devops a $CLAUDE_MCP"; then
      :
    else
      TMP=$(mktemp)
      jq --argjson entry "$ADO_MCP_ENTRY" '.mcpServers["azure-devops"] = $entry' "$CLAUDE_MCP" > "$TMP" && mv "$TMP" "$CLAUDE_MCP"
      log "✓ azure-devops adicionado a ~/.claude/mcp.json"
    fi
  fi
else
  warn "jq não disponível. Adicione azure-devops manualmente a $CLAUDE_MCP"
fi

# ─── Step 6: Register ADO hooks in ~/.claude/settings.json ────
log "Registrando hooks ADO em ~/.claude/settings.json..."
HANDLERS_PATH="${PROJECT_ROOT}/.agents/hooks/handlers"

if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
  warn "$CLAUDE_SETTINGS não encontrado — hooks não serão instalados globalmente"
  warn "Adicione manualmente as entradas de hook ou use settings.local.json"
else
  log "✓ settings.json encontrado — hooks instalados via .claude/hooks.json do projeto"
  log "  Os hooks ADO já estão em .claude/hooks.json (local ao projeto)"
fi

# ─── Summary ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Nenhuma alteração foi aplicada."
  echo "Execute sem --dry-run para aplicar."
else
  echo "[ado-install] ✅ Instalação concluída."
  echo ""
  echo "Próximos passos:"
  echo "  1. Configure a organização ADO: execute /atlas setup"
  echo "  2. Verifique a instalação: bash scripts/ado-doctor.sh"
  echo "  3. Reinicie Claude Code para carregar o MCP server"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
