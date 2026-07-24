#!/usr/bin/env bash
# =============================================================================
# HSEOS Doc-Facts Verifier — medição objetiva para o loop-piloto N1 (doc-only)
# Authority: audit 2026-07-22 (F-033) / AUTONOMY-N1-RUNBOOK.md §4
# É o "verify" adversarial do piloto: computa a VERDADE do repo e confere se o
# README a declara corretamente em TODAS as ocorrências (não só a primeira —
# checar só a primeira daria green-while-degrading). Reproduzível.
#
# Usage: scripts/governance/verify-doc-facts.sh [--only skills|agents|changelog]
# Exit: 0 = todas as afirmações batem (loop-piloto DONE) · 1 = discrepância
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
cd "$REPO_ROOT"

ONLY="all"
[[ "${1:-}" == "--only" && -n "${2:-}" ]] && ONLY="$2"

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
pass(){ echo -e "${GREEN}[verify PASS]${NC} $*"; }
fail(){ echo -e "${RED}[verify FAIL]${NC} $*"; }

README="README.md"
fails=0

real_skills=$(ls -1d .agents/skills/*/ 2>/dev/null | wc -l | tr -d ' ')
real_agents=$(ls -1 .hseos/agents/*.agent.yaml 2>/dev/null | wc -l | tr -d ' ')
echo "verdade canônica: skills=$real_skills agents=$real_agents"

# Verifica TODAS as ocorrências de "<N> <label-regex>" no README == truth.
check_all() { # <regex> <truth> <nome>
  local pattern="$1" truth="$2" name="$3" bad=0 seen=0
  while IFS= read -r ln; do
    local num; num=$(printf '%s' "$ln" | sed 's/^[0-9]*://' | grep -oiE "$pattern" | grep -oE '[0-9]+' | head -1)
    [[ -z "$num" ]] && continue
    seen=$((seen+1))
    if [[ "$num" != "$truth" ]]; then
      fail "$name: L$(printf '%s' "$ln" | cut -d: -f1) diz $num != real $truth"
      bad=$((bad+1))
    fi
  done < <(grep -niE "$pattern" "$README" || true)
  if [[ "$seen" -eq 0 ]]; then
    fail "$name: nenhuma menção encontrada (esperado $truth)"; fails=$((fails+1)); return
  fi
  if [[ "$bad" -eq 0 ]]; then pass "$name: todas as $seen menções == $truth"; else fails=$((fails+bad)); fi
}

if [[ "$ONLY" == "all" || "$ONLY" == "skills" ]]; then
  check_all '[0-9]+[[:space:]]+(tiered[[:space:]]+)?(executable[[:space:]]+)?skills' "$real_skills" "skills-count"
fi
if [[ "$ONLY" == "all" || "$ONLY" == "agents" ]]; then
  check_all '[0-9]+[[:space:]]+agent[[:space:]]+(yaml|definition)' "$real_agents" "agents-count"
fi
if [[ "$ONLY" == "all" || "$ONLY" == "changelog" ]]; then
  if [[ -f CHANGELOG.md ]]; then pass "CHANGELOG.md existe"; else fail "CHANGELOG.md ausente (F-031)"; fails=$((fails+1)); fi
fi

if [[ "$fails" -eq 0 ]]; then
  pass "afirmações factuais conferem${ONLY:+ ($ONLY)} — pode declarar DONE"
  exit 0
fi
fail "$fails discrepância(s) — há trabalho para o loop-piloto"
exit 1
