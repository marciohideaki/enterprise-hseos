#!/usr/bin/env bash
# =============================================================================
# HSEOS Quality Gates — Reusable Validation Script
# Authority: Enterprise Constitution > .enterprise/policies/automated-validation.md
# Usage: ./scripts/governance/quality-gates.sh [--phase <doc|code|ci>] [--strict]
#
# Phase `code` (the pre-commit hook) runs a LIGHT Gate 3 by default: lint and format of the staged files, the tests
# of the staged test files plus the tests that reference a staged source file, and the package-surface gate (G3).
# The full suite runs in CI (.github/workflows/ci.yaml, sharded) on every push to task/** and feature/**.
# HSEOS_HOOK_MODE=full (or --full) restores the complete local Gate 3. Other phases always run the full Gate 3.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
PHASE="${PHASE:-auto}"
STRICT="${STRICT:-false}"
LOG_DIR="${REPO_ROOT}/.logs/validation"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
LOG_FILE="${LOG_DIR}/gate-${TIMESTAMP}.log"
VALIDATION_ENFORCED="${VALIDATION_ENFORCED:-true}"
HSEOS_HOOK_MODE="${HSEOS_HOOK_MODE:-light}"
HSEOS_HOOK_MAX_TESTS="${HSEOS_HOOK_MAX_TESTS:-40}"

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
    --full) HSEOS_HOOK_MODE="full"; shift ;;
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
# Gate 1.1: Protected governance anchors and capability graph
# =============================================================================
gate_governance_anchors() {
  info "Gate 1.1: Governance Anchors and Capability Graph"

  if node "${REPO_ROOT}/scripts/governance/validate-constitutional-change.js" --root "${REPO_ROOT}" &>>"$LOG_FILE"; then
    pass "Constitutional change control: passed"
  else
    record_fail "Constitutional change control: FAILED"
  fi

  if node "${REPO_ROOT}/scripts/governance/validate-capability-graph.js" --root "${REPO_ROOT}" &>>"$LOG_FILE"; then
    pass "Federated capability graph: passed"
  else
    record_fail "Federated capability graph: FAILED"
  fi

  if node "${REPO_ROOT}/scripts/governance/validate-capability-reference-corpus.js" --root "${REPO_ROOT}" &>>"$LOG_FILE"; then
    pass "Capability reference corpus: passed"
  else
    record_fail "Capability reference corpus: FAILED"
  fi
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
run_node_check() (
  cd "${REPO_ROOT}"
  while IFS= read -r variable; do
    [[ -n "${variable}" ]] && unset "${variable}"
  done < <(git rev-parse --local-env-vars)
  "$@"
)

# Light Gate 3 (pre-commit): everything here is cheap and deterministic; whatever it leaves out is in the CI suite.
#  - lint + prettier: staged files only (the whole tree when eslint/package config is staged);
#  - tests: staged test files run as they are; for a staged source file, every test file under test/ that mentions
#    its repo-relative path (extension dropped) runs, after the staged ones. A direct textual match, not a dependency
#    graph: indirect importers are covered by CI, not here. Past HSEOS_HOOK_MAX_TESTS the gate fails (use --full);
#  - G3: test/test-package-surface.js always runs (the 393/137 file budgets must never reach CI red).
# Tests that need the shared Postgres (test/managed-governance/postgres.integration.test.js) skip without
# HSEOS_GOVERNANCE_TEST_DATABASE_URL; the hook neither opens a tunnel nor counts that skip as a pass: CI runs it
# against a Postgres service on every shard set.
gate_code_light() {
  local -a staged=() sources=() tests=() lintable=() formattable=()
  local file
  while IFS= read -r file; do [[ -n "${file}" ]] && staged+=("${file}"); done < <(
    git -C "${REPO_ROOT}" diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true
  )

  local full_lint=false
  for file in "${staged[@]}"; do
    [[ -f "${REPO_ROOT}/${file}" ]] || continue
    case "${file}" in
      eslint.config.*|package.json|package-lock.json) full_lint=true ;;
    esac
    case "${file}" in
      *.js|*.cjs|*.mjs|*.yaml) lintable+=("${file}") ;;
    esac
    case "${file}" in
      *.js|*.cjs|*.mjs|*.json|*.yaml) formattable+=("${file}") ;;
    esac
    case "${file}" in
      test/*.test.sh|test/*/*.test.sh) tests+=("${file}") ;;
      test/*test-*.js|test/*/*test-*.js|test/*.test.js|test/*/*.test.js) tests+=("${file}") ;;
      src/*.js|src/*.cjs|src/*.mjs|tools/*.js|tools/*.cjs|tools/*.mjs|packages/*.js|packages/*.cjs|packages/*.mjs) sources+=("${file}") ;;
      scripts/*.js|scripts/*.cjs|scripts/*.mjs) sources+=("${file}") ;;
    esac
  done

  # Lint
  if [[ "${full_lint}" == "true" ]]; then
    if run_node_check npm run lint --silent 2>>"$LOG_FILE"; then
      pass "Lint (whole tree, config changed): passed"
    else
      record_fail "Lint (whole tree, config changed): FAILED"; gate_passed=false
    fi
  elif [[ ${#lintable[@]} -gt 0 ]]; then
    if run_node_check node_modules/.bin/eslint --max-warnings=0 --no-warn-ignored "${lintable[@]}" 2>>"$LOG_FILE"; then
      pass "Lint (${#lintable[@]} staged file(s)): passed"
    else
      record_fail "Lint (staged files): FAILED"; gate_passed=false
    fi
  fi

  # Format
  if [[ ${#formattable[@]} -gt 0 ]]; then
    if run_node_check node_modules/.bin/prettier --check --ignore-unknown "${formattable[@]}" 2>>"$LOG_FILE"; then
      pass "Prettier (${#formattable[@]} staged file(s)): passed"
    else
      record_fail "Prettier (staged files): FAILED — run: npx prettier --write <file>"; gate_passed=false
    fi
  fi

  # Tests that reference a staged source file
  local source stem importer
  for source in "${sources[@]}"; do
    stem="${source%.*}"
    while IFS= read -r importer; do
      [[ -n "${importer}" ]] && tests+=("${importer}")
    done < <(git -C "${REPO_ROOT}" grep -lF -e "${stem}" -- 'test/*.js' 'test/*.cjs' 'test/*.mjs' 'test/*.sh' 2>/dev/null || true)
  done

  local -a unique_tests=()
  if [[ ${#tests[@]} -gt 0 ]]; then
    while IFS= read -r file; do [[ -n "${file}" ]] && unique_tests+=("${file}"); done < <(printf '%s\n' "${tests[@]}" | awk '!seen[$0]++')
  fi
  # Order is staged test files first, then the tests that cite a staged source file. Never a silent subset: past the
  # ceiling the gate fails and asks for the complete local gate (or CI).
  if [[ ${#unique_tests[@]} -gt ${HSEOS_HOOK_MAX_TESTS} ]]; then
    record_fail "Light hook: ${#unique_tests[@]} test files are touched or cite a staged file (ceiling ${HSEOS_HOOK_MAX_TESTS}); run the complete gate with HSEOS_HOOK_MODE=full (or --full), or raise HSEOS_HOOK_MAX_TESTS"
    gate_passed=false
    return 0
  fi
  # G3 always, once.
  local g3="test/test-package-surface.js"
  local -a node_tests=() shell_tests=()
  for file in "${unique_tests[@]}"; do
    [[ "${file}" == "${g3}" ]] && continue
    [[ -f "${REPO_ROOT}/${file}" ]] || continue
    # A shell test ships its own runner; a test/*.js that is not a test file (helper/fixture) is not run directly.
    case "${file}" in
      *.sh) shell_tests+=("${file}") ;;
      *) node_tests+=("${file}") ;;
    esac
  done
  node_tests+=("${g3}")

  info "Light hook: ${#node_tests[@]} node test file(s), ${#shell_tests[@]} shell test file(s)"
  if run_node_check node --test --test-concurrency=1 "${node_tests[@]}" 2>>"$LOG_FILE"; then
    pass "Tests (touched + referencing, G3 package surface): passed"
  else
    record_fail "Tests (touched + referencing, G3 package surface): FAILED"; gate_passed=false
  fi
  for file in "${shell_tests[@]}"; do
    if run_node_check bash "${file}" 2>>"$LOG_FILE"; then
      pass "Shell test ${file}: passed"
    else
      record_fail "Shell test ${file}: FAILED"; gate_passed=false
    fi
  done
  info "Light hook: the full suite (all shards, kernel coverage, Postgres integration) runs in CI on push"
}

gate_code() {
  info "Gate 3: Code Quality"

  local gate_passed=true
  local staged_files
  staged_files=$(git -C "${REPO_ROOT}" diff --cached --name-only 2>/dev/null || true)

  # Node.js / JavaScript
  if [[ -f "${REPO_ROOT}/package.json" && "${GATE_CODE_MODE:-full}" == "light" && -n "${staged_files}" ]]; then
    gate_code_light
  elif [[ -f "${REPO_ROOT}/package.json" ]]; then
    local run_node_checks=false
    if [[ -z "${staged_files}" ]]; then
      run_node_checks=true
    elif grep -qE '^(src/|tools/|packages/|test/|package\.json|package-lock\.json|eslint\.config\..*|tsconfig.*|scripts/.*\.(js|ts|mjs|cjs)$)' <<< "${staged_files}"; then
      run_node_checks=true
    fi

    if [[ "${run_node_checks}" == "true" ]]; then
      info "Detected Node.js project changes in scope"

      # Lint
      if [[ -f "${REPO_ROOT}/package.json" ]] && \
         node -e "const p=require('${REPO_ROOT}/package.json'); process.exit(p.scripts?.lint ? 0 : 1)" 2>/dev/null; then
        if run_node_check npm run lint --silent 2>>"$LOG_FILE"; then
          pass "Lint: passed"
        else
          record_fail "Lint: FAILED"
          gate_passed=false
        fi
      fi

      # Tests
      if node -e "const p=require('${REPO_ROOT}/package.json'); process.exit(p.scripts?.test ? 0 : 1)" 2>/dev/null; then
        if run_node_check npm test --silent 2>>"$LOG_FILE"; then
          pass "Tests: passed"
        else
          record_fail "Tests: FAILED"
          gate_passed=false
        fi
      fi
    else
      info "No staged Node.js runtime changes — skipping lint/tests"
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
  if [[ -f "${REPO_ROOT}/tools/validate-agent-schema.js" ]] && \
     ([[ -z "${staged_files}" ]] || grep -qE '^(src/hsm/agents/|tools/schema/|tools/validate-agent-schema\.js|src/utility/agent-components/)' <<< "${staged_files}"); then
    if (cd "${REPO_ROOT}" && node tools/validate-agent-schema.js &>>"$LOG_FILE"); then
      pass "Agent schema validation: passed"
    else
      record_fail "Agent schema validation: FAILED"
      gate_passed=false
    fi
  else
    info "No staged agent-schema-sensitive changes — skipping schema validation"
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
    "password\\s*=\\s*[\"'][^\"']{4,}"
    "api[_-]?key\\s*=\\s*[\"'][^\"']{8,}"
    "secret\\s*=\\s*[\"'][^\"']{8,}"
    "private[_-]?key[\"']?\s*[:=]\s*[\"'][^\"']{8,}"
    'BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE'
    'AKIA[0-9A-Z]{16}'
  )

  # Scan TRACKED files only via `git grep`: gitignored trees (node_modules,
  # .logs, .worktrees, .axon) can never gate a commit, and CI scans exactly
  # what ships. The previous `grep --include="*.{js,...}"` form used a brace
  # glob that grep does not expand, so it silently matched no files at all.
  local scan_pathspecs=(
    '*.js' '*.mjs' '*.cjs' '*.ts' '*.py' '*.sh' '*.yml' '*.yaml' '*.json' '*.env'
    ':!scripts/governance/quality-gates.sh'
    ':!test/fixtures'
  )

  local secret_found=false
  local hits
  for pattern in "${secret_patterns[@]}"; do
    hits="$(git -C "${REPO_ROOT}" grep -IlE "$pattern" -- "${scan_pathspecs[@]}" 2>/dev/null || true)"
    if [[ -n "$hits" ]]; then
      echo "$hits" >>"$LOG_FILE"
      record_fail "Potential secret detected — pattern: ${pattern} (see ${LOG_FILE})"
      secret_found=true
    fi
  done

  if ! $secret_found; then
    pass "No secret patterns detected in tracked files"
  fi

  # .env files must never be staged (local) nor tracked (local + CI)
  if git -C "${REPO_ROOT}" diff --cached --name-only 2>/dev/null | grep -E '(^|/)\.env$|(^|/)\.env\.' >/dev/null; then
    record_fail ".env file is staged — secrets must not be committed"
  fi
  if git -C "${REPO_ROOT}" ls-files 2>/dev/null | grep -E '(^|/)\.env$|(^|/)\.env\.' >/dev/null; then
    record_fail ".env file is tracked in git — secrets must not be committed"
  fi
}

# =============================================================================
# Gate 5: Commit hygiene (pre-commit mode)
# =============================================================================
gate_commit_hygiene() {
  info "Gate 5: Commit Hygiene"

  # Messages are checked by scripts/governance/validate-commit-msg.sh itself
  # (--ai-terms-only), so the vocabulary and word boundaries stay in one place (AR-52).
  local msg_validator="${REPO_ROOT}/scripts/governance/validate-commit-msg.sh"

  local staged_files
  staged_files=$(git -C "${REPO_ROOT}" diff --cached --name-only 2>/dev/null || true)

  if [[ -n "$staged_files" ]]; then
    # Local pre-commit mode: advisory scan of staged diff content
    local blocked_terms=("claude" "codex" "openai" "copilot" "llm" "chatgpt" "gpt-4" "co-authored-by: claude" "co-authored-by: codex")
    local staged_diff
    staged_diff=$(git -C "${REPO_ROOT}" diff --cached 2>/dev/null || true)

    for term in "${blocked_terms[@]}"; do
      if echo "$staged_diff" | grep -qi "^+.*${term}" 2>/dev/null; then
        record_warn "Potential AI reference in staged changes: '${term}'"
      fi
    done

    pass "Commit hygiene check complete"
    return
  fi

  # CI / message mode: no staged files. Working-tree CONTENT legitimately names
  # vendors (adapters, hooks), so only commit MESSAGES are gated here. The HEAD
  # commit is blocking (new work); the PR range is advisory because pre-existing
  # history is rewritten by squash-merge at PR closeout.
  if [[ -n "${GITHUB_ACTIONS:-}" || "$PHASE" == "ci" ]]; then
    local head_msg
    head_msg=$(git -C "${REPO_ROOT}" log -1 --format='%B' 2>/dev/null || true)
    if [[ -n "$head_msg" ]] && ! bash "$msg_validator" --ai-terms-only "$head_msg" >/dev/null 2>&1; then
      record_fail "AI mention in HEAD commit message (AR-52 / validate-commit-msg vocabulary)"
    fi

    local base_ref="${GITHUB_BASE_REF:-master}"
    if git -C "${REPO_ROOT}" rev-parse --verify --quiet "origin/${base_ref}" >/dev/null 2>&1; then
      local range_sha range_msg
      while IFS= read -r range_sha; do
        [[ -n "$range_sha" ]] || continue
        range_msg=$(git -C "${REPO_ROOT}" log -1 --format='%B' "$range_sha" 2>/dev/null || true)
        if [[ -n "$range_msg" ]] && ! bash "$msg_validator" --ai-terms-only "$range_msg" >/dev/null 2>&1; then
          record_warn "AI mention in commit ${range_sha:0:8} of origin/${base_ref}..HEAD (advisory — squash-merge cleans history at closeout)"
        fi
      done < <(git -C "${REPO_ROOT}" log --format='%H' "origin/${base_ref}..HEAD" 2>/dev/null || true)
    else
      info "Base ref origin/${base_ref} unavailable (shallow clone?) — range hygiene skipped"
    fi

    pass "Commit hygiene (message mode) complete"
    return
  fi

  info "No staged files — skipping commit hygiene gate"
}

# =============================================================================
# Gate 6: Workflow publication trigger policy
# =============================================================================
gate_workflow_publication() {
  info "Gate 6: Workflow Publication Triggers"

  local workflow_file="${REPO_ROOT}/.github/workflows/docs-image.yml"
  if [[ ! -f "${workflow_file}" ]]; then
    info "No docs-image workflow found — skipping publication trigger gate"
    return
  fi

  local required_patterns=(
    "push:"
    "workflow_dispatch:"
    "- main"
    "- develop"
    "- 'feature/**'"
    "- 'hotfix/**'"
    "- 'release/**'"
  )

  local missing=0
  for pattern in "${required_patterns[@]}"; do
    if grep -Fq -- "${pattern}" "${workflow_file}"; then
      pass "docs-image policy contains: ${pattern}"
    else
      record_fail "docs-image policy missing: ${pattern}"
      missing=$((missing + 1))
    fi
  done

  if [[ "${missing}" -eq 0 ]]; then
    pass "Workflow publication trigger policy is compliant"
  fi
}

# =============================================================================
# Gate 7: Canonical source invariant (ADR-0015 / ADR-0006 P5)
# Runtime execution assets must not cite an external ~/.claude/skills/ path as
# the canonical source of an agent protocol. The dev-squad model matrix and
# state-emission contract are sourced from the Tier 2 compiled mirror
# (.agents/skills/dev-squad/SKILL.md), never the external mirror.
# Scope is deliberately narrow: ADRs (.specs/decisions), opt-in bootstrap
# installers (.enterprise/tooling/bootstrap), reference docs, and hook
# provenance comments legitimately mention the external mirror and are excluded.
# =============================================================================
gate_canonical_source() {
  info "Gate 7: Canonical Source Invariant (ADR-0015)"

  local scan_paths=(
    ".hseos/agents"
    ".hseos/workflows"
    ".hseos/AGENT-MANIFEST.md"
    ".enterprise/agents"
    ".enterprise/governance/agent-skills"
    ".agents/skills"
  )

  # Lines explicitly labeled as the external / non-canonical mirror are permitted.
  local allow_marker='external mirror|non-canonical|not canonical|tier 3'

  # Match the external skill mirror under any home spelling: ~, $HOME, /home/<user>.
  local mirror_pattern='(~|\$HOME|/home/[^/]+)/\.claude/skills/'

  local violations=0 hit
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    echo "$hit" | grep -Eiq "$allow_marker" && continue
    record_fail "ADR-0015: external skill mirror cited as canonical -> ${hit}"
    violations=$((violations + 1))
  done < <(
    grep -rnE --binary-files=without-match \
      --exclude-dir=.git --exclude-dir=node_modules \
      "$mirror_pattern" \
      "${scan_paths[@]/#/${REPO_ROOT}/}" 2>/dev/null || true
  )

  if [[ "${violations}" -eq 0 ]]; then
    pass "No external skill-mirror canonical references in runtime assets"
  fi
}

# =============================================================================
# Main execution
# =============================================================================
main() {
  gate_enforcement

  case "$PHASE" in
    doc|documentation)
      gate_governance_structure
      gate_governance_anchors
      gate_canonical_source
      gate_documentation
      gate_workflow_publication
      ;;
    code)
      GATE_CODE_MODE="${HSEOS_HOOK_MODE}"
      gate_governance_structure
      gate_governance_anchors
      gate_canonical_source
      gate_code
      gate_security
      gate_commit_hygiene
      gate_workflow_publication
      ;;
    ci)
      # Server-side posture: doc gates + tracked-tree security scan + commit-message
      # hygiene. gate_code is intentionally absent — the CI `test` job already runs
      # the full suite; duplicating it here would double CI time for no coverage.
      gate_governance_structure
      gate_governance_anchors
      gate_canonical_source
      gate_documentation
      gate_security
      gate_commit_hygiene
      gate_workflow_publication
      ;;
    auto|full|*)
      gate_governance_structure
      gate_governance_anchors
      gate_canonical_source
      gate_documentation
      gate_code
      gate_security
      gate_commit_hygiene
      gate_workflow_publication
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
    if [[ "${VALIDATION_ENFORCED}" != "true" ]]; then
      warn "Quality gate had ${FAILURES} failure(s) — advisory only (VALIDATION_ENFORCED=false). Continuing."
    else
      fatal "Quality gate FAILED with ${FAILURES} failure(s). Commit blocked."
    fi
  elif [[ $WARNINGS -gt 0 && "$STRICT" == "true" ]]; then
    fatal "Quality gate FAILED in strict mode — ${WARNINGS} warning(s). Commit blocked."
  else
    pass "All quality gates passed."
  fi
}

main
