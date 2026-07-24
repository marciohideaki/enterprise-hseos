#!/usr/bin/env bash
# =============================================================================
# HSEOS Loop Guard — guardrails de execução para grafos de loop autônomos (N1)
# Authority: audit 2026-07-22 AUTONOMY-READINESS.md / AUTONOMY-N1-RUNBOOK.md
# Fecha os itens 3 (escopo+budget) e 5 (sensor+alerta) do Readiness Gate.
#
# Estado do loop vive em .hseos/loops/<run-id>/:
#   scope.txt      — allow-list (1 por linha: caminho exato, ou prefixo terminado em '/')
#   budget.txt     — inteiro: nº máximo de iterações
#   heartbeat.jsonl— append, 1 linha por iteração
#
# Subcomandos:
#   init   --run <id> --scope <file> --budget <n>
#   scope  --run <id> [--base <ref>]                    # diff ⊆ allow-list? (item 3)
#   iter   --run <id> --goal <s> --verdict <PASS|REPROVADO> [--evidence <s>] [--files <s>]
#                                                        # emite heartbeat + roda alertas (item 5)
#   status --run <id>
#
# Exit: 0 ok · 1 violação de escopo/budget · 3 ALERTA (parada recomendada)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
LOOPS_DIR="${REPO_ROOT}/.hseos/loops"
NO_PROGRESS_LIMIT="${NO_PROGRESS_LIMIT:-3}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok(){   echo -e "${GREEN}[loop-guard OK]${NC} $*"; }
bad(){  echo -e "${RED}[loop-guard FAIL]${NC} $*"; }
alert(){ echo -e "${RED}[loop-guard ALERT]${NC} $*"; }
info(){ echo -e "${BLUE}[loop-guard]${NC} $*"; }

die(){ bad "$*"; exit 1; }

cmd="${1:-}"; shift || true
RUN=""; SCOPE=""; BUDGET=""; BASE="origin/master"
GOAL=""; VERDICT=""; EVIDENCE=""; FILES=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN="$2"; shift 2;;
    --scope) SCOPE="$2"; shift 2;;
    --budget) BUDGET="$2"; shift 2;;
    --base) BASE="$2"; shift 2;;
    --goal) GOAL="$2"; shift 2;;
    --verdict) VERDICT="$2"; shift 2;;
    --evidence) EVIDENCE="$2"; shift 2;;
    --files) FILES="$2"; shift 2;;
    *) die "arg desconhecido: $1";;
  esac
done
[[ -n "$RUN" ]] || die "faltou --run <id>"
RUN_DIR="${LOOPS_DIR}/${RUN}"

case "$cmd" in
  init)
    [[ -n "$SCOPE" && -f "$SCOPE" ]] || die "init exige --scope <file existente>"
    [[ "$BUDGET" =~ ^[0-9]+$ ]] || die "init exige --budget <inteiro>"
    mkdir -p "$RUN_DIR"
    cp "$SCOPE" "$RUN_DIR/scope.txt"
    echo "$BUDGET" > "$RUN_DIR/budget.txt"
    : > "$RUN_DIR/heartbeat.jsonl"
    ok "loop '$RUN' inicializado: budget=$BUDGET, escopo=$(grep -cvE '^\s*(#|$)' "$RUN_DIR/scope.txt") regras"
    ;;

  scope)
    [[ -d "$RUN_DIR" ]] || die "loop '$RUN' não inicializado"
    cd "$REPO_ROOT"
    # O que a iteração tocou vs o último commit: modified + untracked.
    # Roda-se em worktree isolado (worktree-manager.sh), onde isto = só as
    # edições do loop. BASE=<ref> força comparação por range de commits.
    if [[ -n "${BASE_OVERRIDE:-}" ]] && git rev-parse --verify "$BASE" >/dev/null 2>&1; then
      changed="$(git diff --name-only "${BASE}...HEAD" 2>/dev/null || git diff --name-only "$BASE" HEAD)"
    else
      changed="$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u | grep -v '^[[:space:]]*$' | grep -vE '^\.hseos/loops/' || true)"
    fi
    mapfile -t rules < <(grep -vE '^\s*(#|$)' "$RUN_DIR/scope.txt" || true)
    violations=0
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      allowed=0
      for r in "${rules[@]}"; do
        if [[ "$r" == */ ]]; then
          [[ "$f" == "$r"* ]] && { allowed=1; break; }
        else
          [[ "$f" == "$r" ]] && { allowed=1; break; }
        fi
      done
      if [[ "$allowed" -eq 0 ]]; then bad "fora do escopo: $f"; violations=$((violations+1)); fi
    done < <(printf '%s\n' "$changed")
    if [[ "$violations" -gt 0 ]]; then
      bad "$violations arquivo(s) fora do escopo do loop '$RUN' — iteração REPROVADA por escopo"
      exit 1
    fi
    # Segunda barreira (item 2, loop-side): âncora nunca passa, mesmo se a
    # allow-list de algum loop for ampla. Substitui a branch protection.
    if ! ANCHOR_GUARD_FILES="$changed" bash "$SCRIPT_DIR/anchor-guard.sh"; then
      bad "âncora tocada — iteração REPROVADA (o loop não pode alterar constituição/specs/policies/guards)"
      exit 1
    fi
    ok "diff dentro do escopo do loop '$RUN' e sem tocar âncoras"
    ;;

  iter)
    [[ -d "$RUN_DIR" ]] || die "loop '$RUN' não inicializado"
    [[ -n "$GOAL" && -n "$VERDICT" ]] || die "iter exige --goal e --verdict"
    hb="$RUN_DIR/heartbeat.jsonl"
    n=$(( $(wc -l < "$hb") + 1 ))
    budget="$(cat "$RUN_DIR/budget.txt")"
    # emite a linha de heartbeat (jq se disponível, senão fallback manual)
    line=$(EVIDENCE="$EVIDENCE" FILES="$FILES" GOAL="$GOAL" VERDICT="$VERDICT" N="$n" \
      jq -cn '{iter:(env.N|tonumber),goal:env.GOAL,verdict:env.VERDICT,evidence:env.EVIDENCE,files:env.FILES}' 2>/dev/null) || \
      line="{\"iter\":$n,\"goal\":\"$GOAL\",\"verdict\":\"$VERDICT\",\"evidence\":\"$EVIDENCE\",\"files\":\"$FILES\"}"
    echo "$line" >> "$hb"
    info "iter $n/$budget registrada: verdict=$VERDICT"

    # ALERTA 1 — gate-sem-evidência: PASS sem evidência objetiva
    if [[ "$VERDICT" == "PASS" && ( -z "$EVIDENCE" || "$EVIDENCE" == "none" ) ]]; then
      alert "gate-sem-evidência: iteração marcada PASS sem evidência objetiva (F-006). PARE e escale."
      exit 3
    fi
    # BUDGET — estouro
    if [[ "$n" -gt "$budget" ]]; then
      alert "budget estourado ($n > $budget). Stop condition: budget atingido. PARE e escale."
      exit 3
    fi
    # ALERTA 2 — sem-progresso: N iterações consecutivas sem correção verificada (REPROVADO ou sem files)
    tail_n="$(tail -n "$NO_PROGRESS_LIMIT" "$hb")"
    if [[ "$(printf '%s\n' "$tail_n" | wc -l)" -ge "$NO_PROGRESS_LIMIT" ]]; then
      stuck=1
      while IFS= read -r l; do
        v="$(printf '%s' "$l" | grep -oE '"verdict":"[^"]*"' | head -1 | cut -d'"' -f4)"
        fl="$(printf '%s' "$l" | grep -oE '"files":"[^"]*"' | head -1 | cut -d'"' -f4)"
        if [[ "$v" == "PASS" && -n "$fl" && "$fl" != "none" ]]; then stuck=0; break; fi
      done < <(printf '%s\n' "$tail_n")
      if [[ "$stuck" -eq 1 ]]; then
        alert "sem-progresso: $NO_PROGRESS_LIMIT iterações sem correção verificada aceita (padrão F-017). PARE e escale."
        exit 3
      fi
    fi
    ok "iter $n aceita; loop pode avançar"
    ;;

  status)
    [[ -d "$RUN_DIR" ]] || die "loop '$RUN' não inicializado"
    hb="$RUN_DIR/heartbeat.jsonl"
    echo "loop: $RUN | budget: $(cat "$RUN_DIR/budget.txt") | iterações: $(wc -l < "$hb")"
    echo "escopo:"; grep -vE '^\s*(#|$)' "$RUN_DIR/scope.txt" | sed 's/^/  /'
    echo "últimas iterações:"; tail -n 5 "$hb" | sed 's/^/  /'
    ;;

  *)
    die "subcomando inválido: '$cmd' (use init|scope|iter|status)"
    ;;
esac
