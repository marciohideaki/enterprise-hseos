#!/usr/bin/env bash
# =============================================================================
# HSEOS Doc-Facts Verifier — medição objetiva para o loop-piloto N1 (doc-only)
# Authority: audit 2026-07-22 (F-033) / AUTONOMY-N1-RUNBOOK.md §4
# É o "verify" adversarial do piloto: computa a VERDADE do repo e confere se o
# README a declara corretamente. Reproduzível, sem confiar no relato do executor.
#
# Usage: scripts/governance/verify-doc-facts.sh
# Exit: 0 = todas as afirmações batem (loop-piloto DONE) · 1 = discrepância
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
cd "$REPO_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
pass(){ echo -e "${GREEN}[verify PASS]${NC} $*"; }
fail(){ echo -e "${RED}[verify FAIL]${NC} $*"; }

README="README.md"
fails=0

# --- Verdade canônica computada agora ---
real_skills=$(ls -1d .agents/skills/*/ 2>/dev/null | wc -l | tr -d ' ')
real_agents=$(ls -1 .hseos/agents/*.agent.yaml 2>/dev/null | wc -l | tr -d ' ')
echo "verdade: skills=$real_skills agents=$real_agents"

check_claim() { # <regex-antes-do-numero> <valor-real> <rótulo>
  local pattern="$1" truth="$2" label="$3"
  # extrai o número que o README associa ao rótulo (primeira ocorrência)
  local claimed
  claimed=$(grep -oiE "${pattern}" "$README" 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
  if [[ -z "$claimed" ]]; then
    fail "$label: nenhuma afirmação numérica encontrada no README (esperado $truth)"; fails=$((fails+1)); return
  fi
  if [[ "$claimed" == "$truth" ]]; then
    pass "$label: README diz $claimed == real $truth"
  else
    fail "$label: README diz $claimed != real $truth"; fails=$((fails+1))
  fi
}

check_claim '[0-9]+[[:space:]]+(tiered[[:space:]]+)?(executable[[:space:]]+)?skills' "$real_skills" "skills-count"
check_claim '[0-9]+[[:space:]]+agent[[:space:]]+YAML' "$real_agents" "agents-count"

# CHANGELOG deve existir (F-031)
if [[ -f CHANGELOG.md ]]; then pass "CHANGELOG.md existe"; else fail "CHANGELOG.md ausente (F-031)"; fails=$((fails+1)); fi

if [[ "$fails" -eq 0 ]]; then
  pass "todas as afirmações factuais conferem — loop-piloto pode declarar DONE"
  exit 0
fi
fail "$fails discrepância(s) — há trabalho para o loop-piloto"
exit 1
