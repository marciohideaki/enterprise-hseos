#!/usr/bin/env bash
# =============================================================================
# HSEOS Anchor Guard — impede um grafo de loop autônomo de tocar ÂNCORAS
# Authority: Enterprise Constitution §13 > audit 2026-07-22 (F-005, F-002)
# Autonomy Readiness Gate item 2 — enforcement LOOP-SIDE (não via branch protection).
#
# Chamado pelo loop-guard a cada iteração (e utilizável avulso). Se o conjunto de
# arquivos alterados toca um caminho ancorado, a mudança é BLOQUEADA a menos que
# um humano — FORA do loop — a autorize explicitamente com ANCHOR_OVERRIDE=1.
# Um loop autônomo nunca deve setar esse override; ele existe para o operador.
#
# Usage:
#   scripts/governance/anchor-guard.sh                         # diff origin/master...HEAD
#   BASE=origin/develop scripts/governance/anchor-guard.sh
#   ANCHOR_GUARD_FILES=$'a\nb' scripts/governance/anchor-guard.sh   # lista explícita
#   ANCHOR_OVERRIDE=1 ...                                      # autorização humana consciente
#
# Exit: 0 = ok (nenhuma âncora tocada, ou override humano); 1 = violação.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
BASE="${BASE:-origin/master}"

# Caminhos ancorados (regex relativa à raiz). Inclui os próprios guardrails:
# um loop não pode reescrever a regra que o contém.
ANCHORED_REGEX='^(\.enterprise/\.specs/(constitution|core|cross)/|\.enterprise/governance/policies/|\.agents/manifest\.yaml|\.agents/hooks/|\.github/|scripts/governance/(anchor-guard|loop-guard|verify-doc-facts)\.sh$)'

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass(){ echo -e "${GREEN}[anchor-guard PASS]${NC} $*"; }
fail(){ echo -e "${RED}[anchor-guard FAIL]${NC} $*"; }
info(){ echo -e "${YELLOW}[anchor-guard]${NC} $*"; }

cd "$REPO_ROOT"

if [[ -n "${ANCHOR_GUARD_FILES:-}" ]]; then
  changed="$ANCHOR_GUARD_FILES"
elif git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  changed="$(git diff --name-only "${BASE}...HEAD" 2>/dev/null || git diff --name-only "$BASE" HEAD)"
else
  changed="$(git diff --name-only HEAD 2>/dev/null || true)"
  info "base '$BASE' indisponível; usando diff do working tree"
fi

anchored_hits="$(printf '%s\n' "$changed" | grep -E "$ANCHORED_REGEX" || true)"

if [[ -z "$anchored_hits" ]]; then
  pass "nenhum caminho ancorado tocado"
  exit 0
fi

info "caminhos ancorados tocados:"
printf '%s\n' "$anchored_hits" | sed 's/^/    /'

if [[ "${ANCHOR_OVERRIDE:-0}" == "1" ]]; then
  pass "ANCHOR_OVERRIDE=1 — mudança de âncora autorizada por operador humano (fora do loop)"
  exit 0
fi

fail "mudança em caminho ancorado sem ANCHOR_OVERRIDE humano."
fail "Um grafo de loop autônomo NÃO pode tocar âncoras (constituição/specs/policies/guards)."
fail "Se isto veio de um loop, é violação de escopo — a iteração deve ser REPROVADA."
exit 1
