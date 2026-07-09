#!/usr/bin/env bash
# HSEOS suggest-skill handler — Wave 4 implementation slice (W4-T5)
#
# Event:   PreToolUse (matcher: Agent)
# Status:  active — advisory-only counterpart to swarm-gate.sh
#          (swarm-gate handles the blocking model-routing + dev-squad gate;
#          this handler walks .agents/skills/ and emits skill-match advisory
#          text from project-local SKILL.md frontmatter)
#
# Reads the prompt being delegated to a subagent (stdin JSON), walks
# every .agents/skills/<name>/SKILL.md frontmatter for declared
# triggers, and emits an advisory listing skills whose triggers match
# the prompt content. The advisory gives the main thread a chance to
# invoke /<skill> directly instead of delegating manually.
#
# Reference: SKILL.md frontmatter contract per the SKILL.md open
# standard (agentskills.io). HSEOS skills declare a `triggers:` array
# of keywords/phrases plus a `description:` line; either is consulted.
#
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: same prompt → same advisory text
#   - Best-effort: never blocks the triggering action; exit 0 always
#   - Project-scoped: walks .agents/skills/ inside the current project
#   - Config-aware: skips silently outside an HSEOS-installed project
#   - Fail-open: silent no-op when stdin parsing fails or no matches
#
# Skips when:
#   - Not in HSEOS project (.agents/skills/ missing)
#   - jq absent
#   - Stdin empty / not JSON / no prompt field
#   - Zero skill matches

set -euo pipefail

PROJECT_ROOT="$(pwd)"
SKILLS_DIR="$PROJECT_ROOT/.agents/skills"

# Skip silently when not running in an HSEOS-installed project
if [[ ! -d "$SKILLS_DIR" ]]; then
  exit 0
fi

# stdin must be read first
INPUT=""
if [[ ! -t 0 ]]; then
  INPUT=$(cat 2>/dev/null || true)
fi

if [[ -z "$INPUT" ]] || ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# Extract Agent tool input
PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // ""' 2>/dev/null || echo "")
DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // ""' 2>/dev/null || echo "")
SUBAGENT=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""' 2>/dev/null || echo "")

# Concatenate searchable haystack from all relevant Agent input fields
HAYSTACK=$(printf '%s\n%s\n%s\n' "$PROMPT" "$DESCRIPTION" "$SUBAGENT" | tr '[:upper:]' '[:lower:]')

if [[ -z "${HAYSTACK// /}" ]]; then
  exit 0
fi

# Walk every SKILL.md and check if its triggers (or description) match.
# Triggers can appear in the YAML frontmatter as either:
#   triggers: [a, b, c]            (inline array)
#   triggers:                      (block array)
#     - a
#     - b
# Or via the `description:` line. We also fall back to the `name:` itself.
MATCHES=()

for skill_dir in "$SKILLS_DIR"/*/; do
  [[ -d "$skill_dir" ]] || continue
  skill_file="$skill_dir/SKILL.md"
  [[ -f "$skill_file" ]] || continue

  # Extract frontmatter (between leading --- and second ---)
  frontmatter=$(awk '/^---$/{c++; next} c==1 {print} c==2 {exit}' "$skill_file" 2>/dev/null || echo "")
  [[ -z "$frontmatter" ]] || true

  skill_name=$(echo "$frontmatter" | grep -E '^name:' | head -1 | sed -E 's/^name:[[:space:]]*//; s/[[:space:]]*$//' || true)
  [[ -z "$skill_name" ]] && skill_name="$(basename "$skill_dir")"

  # Pull every word that could be a trigger from the frontmatter.
  # We scan: triggers (inline + block), description line, and the name itself.
  candidate_triggers=$(echo "$frontmatter" | awk '
    /^triggers:[[:space:]]*\[/ {
      gsub(/^triggers:[[:space:]]*\[/, "")
      gsub(/\].*$/, "")
      gsub(/[",]/, " ")
      print
      next
    }
    /^triggers:[[:space:]]*$/ { in_block=1; next }
    in_block && /^[[:space:]]*-[[:space:]]+/ {
      gsub(/^[[:space:]]*-[[:space:]]+/, "")
      print
      next
    }
    in_block && /^[^[:space:]-]/ { in_block=0 }
    /^description:/ {
      gsub(/^description:[[:space:]]*/, "")
      gsub(/^"|"$/, "")
      print
    }
  ' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)

  candidate_triggers="$candidate_triggers $skill_name"

  # Match: any trigger token of length ≥4 appearing in the haystack
  matched=0
  for token in $candidate_triggers; do
    token=$(echo "$token" | tr -d '[],"')
    [[ ${#token} -ge 4 ]] || continue
    if echo "$HAYSTACK" | grep -qF "$token" 2>/dev/null; then
      matched=1
      break
    fi
  done

  if [[ "$matched" == 1 ]]; then
    MATCHES+=("$skill_name")
  fi
done

# Emit advisory only when at least one skill matches and there are no more
# than 5 (avoid noisy output). De-dup matches.
if [[ "${#MATCHES[@]}" -eq 0 ]]; then
  exit 0
fi

# Sort + uniq
UNIQ_MATCHES=$(printf '%s\n' "${MATCHES[@]}" | sort -u)
COUNT=$(echo "$UNIQ_MATCHES" | wc -l | tr -d ' ')

if [[ "$COUNT" -gt 5 ]]; then
  # Too many matches → broad keywords, advisory would be noise
  exit 0
fi

printf '[HSEOS][SKILL-CHECK] Before delegating via Agent, consider invoking the matching skill(s) directly:\n'
echo "$UNIQ_MATCHES" | while IFS= read -r name; do
  printf '  - /%s\n' "$name"
done
printf '\n  If the matched skill does not actually fit the work, ignore this advisory and proceed.\n'

exit 0
