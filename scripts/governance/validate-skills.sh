#!/usr/bin/env bash
# =============================================================================
# HSEOS Skill Validator — validates skill directory format and frontmatter
# Authority: .enterprise/governance/agent-skills/SKILLS-REGISTRY.md
# Usage: ./scripts/governance/validate-skills.sh [--strict] [--dir <path>]
# Exit: 0 = pass, 1 = failures found
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SKILLS_DIR="${REPO_ROOT}/.enterprise/governance/agent-skills"
STRICT="${STRICT:-false}"
TARGET_DIR=""

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

pass()  { echo -e "  ${GREEN}[PASS]${NC} $*"; }
fail()  { echo -e "  ${RED}[FAIL]${NC} $*"; }
warn()  { echo -e "  ${YELLOW}[WARN]${NC} $*"; }
info()  { echo -e "${BLUE}[INFO]${NC} $*"; }

FAILURES=0
WARNINGS=0
CHECKED=0

record_fail() { FAILURES=$((FAILURES + 1)); fail "$@"; }
record_warn() { WARNINGS=$((WARNINGS + 1)); warn "$@"; }

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict) STRICT="true"; shift ;;
    --dir) TARGET_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SCAN_DIR="${TARGET_DIR:-${SKILLS_DIR}}"

info "HSEOS Skill Validator"
info "Scanning: ${SCAN_DIR}"
echo ""

# =============================================================================
# SKILL-01: SKILL-QUICK.md exists in each skill directory
# =============================================================================
check_skill_directory() {
  local skill_dir="$1"
  local skill_name
  skill_name="$(basename "$skill_dir")"

  # Skip non-skill directories (README-only, index-only)
  if [[ "$skill_name" == "_"* ]] || [[ "$skill_name" == "README"* ]]; then
    return 0
  fi

  # Only check directories that look like skill dirs (contain .md files)
  if ! ls "$skill_dir"/*.md &>/dev/null 2>&1; then
    return 0
  fi

  CHECKED=$((CHECKED + 1))
  info "Checking skill: ${skill_name}"

  # SKILL-01: SKILL-QUICK.md must exist
  local quick_file="${skill_dir}/SKILL-QUICK.md"
  if [[ ! -f "$quick_file" ]]; then
    record_fail "SKILL-01: SKILL-QUICK.md missing in '${skill_name}'"
    return 0
  else
    pass "SKILL-01: SKILL-QUICK.md exists"
  fi

  # SKILL-02: frontmatter has name: field
  if ! grep -qE "^name:|^skill:" "$quick_file" 2>/dev/null; then
    record_fail "SKILL-02: SKILL-QUICK.md missing 'name:' or 'skill:' in frontmatter — ${skill_name}"
  else
    pass "SKILL-02: name/skill field present"
  fi

  # SKILL-03: description: field present
  if ! grep -q "^description:" "$quick_file" 2>/dev/null; then
    record_fail "SKILL-03: SKILL-QUICK.md missing 'description:' in frontmatter — ${skill_name}"
  else
    pass "SKILL-03: description field present"
  fi

  # SKILL-04: description starts with "Use when"
  local desc
  desc=$(grep "^description:" "$quick_file" 2>/dev/null | head -1 | sed 's/^description:\s*//' | tr -d '"'"'" | xargs)
  if [[ -n "$desc" ]]; then
    if echo "$desc" | grep -qi "^Use when"; then
      pass "SKILL-04: description uses 'Use when...' trigger format"
    else
      record_warn "SKILL-04: description should start with 'Use when...' — current: '${desc:0:60}...' [${skill_name}]"
    fi
  fi

  # SKILL-05: no absolute paths in skill files
  local abs_path_found=false
  for skill_file in "$skill_dir"/*.md; do
    if grep -qE "^[^#\`].*(/opt/|/home/|/usr/|/var/|C:\\\\)" "$skill_file" 2>/dev/null; then
      record_warn "SKILL-05: potential absolute path in '$(basename "$skill_file")' [${skill_name}]"
      abs_path_found=true
    fi
  done
  if ! $abs_path_found; then
    pass "SKILL-05: no absolute paths detected"
  fi

  # SKILL-06: no direct path references to other skill directories
  for skill_file in "$skill_dir"/*.md; do
    if grep -qE "(agent-skills/[a-z-]+/agent-skills|\.\.\/[a-z-]+\/SKILL)" "$skill_file" 2>/dev/null; then
      record_warn "SKILL-06: cross-skill path reference found in '$(basename "$skill_file")' [${skill_name}] — use SKILLS-REGISTRY.md instead"
    fi
  done

  echo ""
}

# =============================================================================
# Main: scan all skill directories
# =============================================================================
# Find skill directories (1-2 levels deep)
while IFS= read -r dir; do
  if [[ -d "$dir" ]] && [[ "$dir" != "$SCAN_DIR" ]]; then
    check_skill_directory "$dir"
  fi
done < <(find "$SCAN_DIR" -mindepth 1 -maxdepth 2 -type d | sort)

# =============================================================================
# Summary
# =============================================================================
echo "========================================="
echo "  HSEOS Skill Validator Summary"
echo "========================================="
echo "  SKILLS CHECKED : ${CHECKED}"
echo "  FAILURES       : ${FAILURES}"
echo "  WARNINGS       : ${WARNINGS}"
echo "========================================="

if [[ $FAILURES -gt 0 ]]; then
  echo -e "${RED}Skill validation FAILED with ${FAILURES} failure(s).${NC}"
  exit 1
elif [[ $WARNINGS -gt 0 && "$STRICT" == "true" ]]; then
  echo -e "${RED}Skill validation FAILED in strict mode — ${WARNINGS} warning(s).${NC}"
  exit 1
else
  echo -e "${GREEN}All skill validations passed.${NC}"
  exit 0
fi
