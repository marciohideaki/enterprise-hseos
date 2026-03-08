#!/usr/bin/env bash
# =============================================================================
# HSEOS Quality Gates — Reusable Validation Script
# Authority: Enterprise Constitution > .enterprise/policies/automated-validation.md
# Usage: ./scripts/governance/quality-gates.sh [--phase <doc|code>] [--strict]
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PHASE="${PHASE:-auto}"
STRICT="${STRICT:-false}"
LOG_DIR="${REPO_ROOT}/.logs/validation"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
LOG_FILE="${LOG_DIR}/gate-${TIMESTAMP}.log"
VALIDATION_ENFORCED="${VALIDATION_ENFORCED:-true}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

pass()  { echo -e "${GREEN}[PASS]${NC} $*" | tee -a "$LOG_FILE"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*" | tee -a "$LOG_FILE"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" | tee -a "$LOG_FILE"; }
info()  { echo -e "${BLUE}[INFO]${NC} $*" | tee -a "$LOG_FILE"; }
fatal() { echo -e "${RED}[FATAL]${NC} $*" | tee -a "$LOG_FILE"; exit 1; }

FAILURES=0
WARNINGS=0

record_fail() { FAILURES=$((FAILURES + 1)); fail "$@"; }
record_warn() { WARNINGS=$((WARNINGS + 1)); warn "$@"; }

# =============================================================================
# Argument parsing
# =============================================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase) PHASE="$2"; shift 2 ;;
    --strict) STRICT="true"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$LOG_DIR"
echo "=== HSEOS Quality Gate Run: $TIMESTAMP ===" > "$LOG_FILE"
echo "PHASE=${PHASE} STRICT=${STRICT} VALIDATION_ENFORCED=${VALIDATION_ENFORCED}" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

info "HSEOS Quality Gates — Phase: ${PHASE}"
info "Repository: ${REPO_ROOT}"
info "Log: ${LOG_FILE}"
echo ""

# =============================================================================
# Gate 0: Enforcement flag check
# =============================================================================
gate_enforcement() {
  info "Gate 0: Enforcement Flags"
  if [[ "${VALIDATION_ENFORCED}" != "true" ]]; then
    record_warn "VALIDATION_ENFORCED is not 'true' — gates are advisory only"
  else
    pass "VALIDATION_ENFORCED=true"
  fi
}

# =============================================================================
# Gate 1: Governance structure integrity
# =============================================================================
gate_governance_structure() {
  info "Gate 1: Governance Structure"

  local required_files=(
    ".enterprise/.specs/constitution/Enterprise-Constitution.md"
    ".enterprise/policies/automated-validation.md"
    "CLAUDE.md"
    "AGENTS.md"
  )

  for f in "${required_files[@]}"; do
    if [[ -f "${REPO_ROOT}/${f}" ]]; then
      pass "Exists: ${f}"
    else
      record_fail "Missing governance file: ${f}"
    fi
  done

  local required_dirs=(
    ".enterprise/agents"
    ".enterprise/governance"
    ".enterprise/policies"
    ".logs/runs"
    ".logs/validation"
    ".logs/summaries"
  )

  for d in "${required_dirs[@]}"; do
    if [[ -d "${REPO_ROOT}/${d}" ]]; then
      pass "Dir exists: ${d}"
    else
      record_fail "Missing governance directory: ${d}"
    fi
  done
}

# =============================================================================
# Gate 2: Documentation phase validation
# =============================================================================
gate_documentation() {
  info "Gate 2: Documentation Quality"

  # Check for unresolved placeholders in markdown
  local placeholder_pattern='\{\{[A-Z_]+\}\}|\[TODO\]|\[PLACEHOLDER\]|<TODO>|<PLACEHOLDER>'
  local md_files
  md_files=$(find "${REPO_ROOT}" \
    -name "*.md" \
    -not -path "*/node_modules/*" \
    -not -path "*/.git/*" \
    -not -path "*/.logs/*" 2>/dev/null || true)

  local placeholder_count=0
  while IFS= read -r file; do
    if grep -qE "$placeholder_pattern" "$file" 2>/dev/null; then
      local count
      count=$(grep -cE "$placeholder_pattern" "$file" 2>/dev/null || echo 0)
      record_warn "Unresolved placeholders (${count}) in: ${file#${REPO_ROOT}/}"
      placeholder_count=$((placeholder_count + count))
    fi
  done <<< "$md_files"

  if [[ $placeholder_count -eq 0 ]]; then
    pass "No unresolved placeholders found"
  fi

  # Validate markdown syntax if markdownlint is available
  if command -v markdownlint &>/dev/null; then
    if markdownlint "${REPO_ROOT}/**/*.md" --ignore node_modules &>>"$LOG_FILE"; then
      pass "Markdown syntax valid"
    else
      record_warn "Markdown lint issues detected (see log)"
    fi
  else
    info "markdownlint not available — skipping markdown syntax check"
  fi
}

# =============================================================================
# Gate 3: Code phase validation
# =============================================================================
gate_code() {
  info "Gate 3: Code Quality"

  local gate_passed=true

  # Node.js / JavaScript
  if [[ -f "${REPO_ROOT}/package.json" ]]; then
    info "Detected Node.js project"

    # Lint
    if [[ -f "${REPO_ROOT}/package.json" ]] && \
       node -e "const p=require('${REPO_ROOT}/package.json'); process.exit(p.scripts?.lint ? 0 : 1)" 2>/dev/null; then
      if (cd "${REPO_ROOT}" && npm run lint --silent 2>>"$LOG_FILE"); then
        pass "Lint: passed"
      else
        record_fail "Lint: FAILED"
        gate_passed=false
      fi
    fi

    # Tests
    if node -e "const p=require('${REPO_ROOT}/package.json'); process.exit(p.scripts?.test ? 0 : 1)" 2>/dev/null; then
      if (cd "${REPO_ROOT}" && npm test --silent 2>>"$LOG_FILE"); then
        pass "Tests: passed"
      else
        record_fail "Tests: FAILED"
        gate_passed=false
      fi
    fi
  fi

  # Python
  if find "${REPO_ROOT}/src" -name "*.py" -maxdepth 3 &>/dev/null 2>&1 | grep -q .; then
    info "Detected Python source"
    if command -v python3 &>/dev/null; then
      if python3 -m compileall "${REPO_ROOT}/src" &>>"$LOG_FILE"; then
        pass "Python compile: passed"
      else
        record_fail "Python compile: FAILED"
        gate_passed=false
      fi
    fi
  fi

  # Schema validation (HSEOS-specific)
  if [[ -f "${REPO_ROOT}/tools/validate-agent-schema.js" ]]; then
    if (cd "${REPO_ROOT}" && node tools/validate-agent-schema.js &>>"$LOG_FILE"); then
      pass "Agent schema validation: passed"
    else
      record_fail "Agent schema validation: FAILED"
      gate_passed=false
    fi
  fi

  $gate_passed
}

# =============================================================================
# Gate 4: Security scan
# =============================================================================
gate_security() {
  info "Gate 4: Security Scan"

  # Check for common secret patterns
  local secret_patterns=(
    'password\s*=\s*["\x27][^"\x27]{4,}'
    'api[_-]?key\s*=\s*["\x27][^"\x27]{8,}'
    'secret\s*=\s*["\x27][^"\x27]{8,}'
    'private[_-]?key'
    'BEGIN RSA PRIVATE'
    'BEGIN EC PRIVATE'
    'AKIA[0-9A-Z]{16}'
  )

  local secret_found=false
  for pattern in "${secret_patterns[@]}"; do
    if grep -rE --include="*.{js,ts,py,sh,yml,yaml,json,env}" \
       --exclude-dir=node_modules --exclude-dir=.git \
       "$pattern" "${REPO_ROOT}" &>>"$LOG_FILE" 2>&1; then
      record_fail "Potential secret detected — pattern: ${pattern}"
      secret_found=true
    fi
  done

  if ! $secret_found; then
    pass "No secret patterns detected"
  fi

  # Check for .env files staged for commit
  if git -C "${REPO_ROOT}" diff --cached --name-only 2>/dev/null | grep -qE '\.env$|\.env\.'; then
    record_fail ".env file is staged — secrets must not be committed"
  fi
}

# =============================================================================
# Gate 5: Commit hygiene (pre-commit mode)
# =============================================================================
gate_commit_hygiene() {
  info "Gate 5: Commit Hygiene"

  local staged_files
  staged_files=$(git -C "${REPO_ROOT}" diff --cached --name-only 2>/dev/null || true)

  if [[ -z "$staged_files" ]]; then
    info "No staged files — skipping commit hygiene gate"
    return
  fi

  # Check for AI mentions in staged diff content
  local blocked_terms=("claude" "codex" "openai" "copilot" "llm" "chatgpt" "gpt-4" "co-authored-by: claude" "co-authored-by: codex")
  local staged_diff
  staged_diff=$(git -C "${REPO_ROOT}" diff --cached 2>/dev/null || true)

  for term in "${blocked_terms[@]}"; do
    if echo "$staged_diff" | grep -qi "^+.*${term}" 2>/dev/null; then
      record_warn "Potential AI reference in staged changes: '${term}'"
    fi
  done

  pass "Commit hygiene check complete"
}

# =============================================================================
# Main execution
# =============================================================================
main() {
  gate_enforcement

  case "$PHASE" in
    doc|documentation)
      gate_governance_structure
      gate_documentation
      ;;
    code)
      gate_governance_structure
      gate_code
      gate_security
      gate_commit_hygiene
      ;;
    auto|full|*)
      gate_governance_structure
      gate_documentation
      gate_code
      gate_security
      gate_commit_hygiene
      ;;
  esac

  echo ""
  echo "========================================="
  echo "  HSEOS Quality Gate Summary"
  echo "========================================="
  echo "  FAILURES : ${FAILURES}"
  echo "  WARNINGS : ${WARNINGS}"
  echo "  LOG      : ${LOG_FILE}"
  echo "========================================="

  if [[ $FAILURES -gt 0 ]]; then
    fatal "Quality gate FAILED with ${FAILURES} failure(s). Commit blocked."
  elif [[ $WARNINGS -gt 0 && "$STRICT" == "true" ]]; then
    fatal "Quality gate FAILED in strict mode — ${WARNINGS} warning(s). Commit blocked."
  else
    pass "All quality gates passed."
  fi
}

main
