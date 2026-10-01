#!/usr/bin/env bash
# Capability-reuse intake guard. Compiled adapters invoke this only after Fase 5 activation.
set -euo pipefail

INPUT="$(cat 2>/dev/null || true)"
command -v jq >/dev/null 2>&1 || exit 0
FILE="$(jq -r '.tool_input.file_path // .tool_input.path // ""' <<<"$INPUT")"
CONTENT="$(jq -r '.tool_input.content // .tool_input.new_string // ""' <<<"$INPUT")"
[[ -n "$FILE" ]] || exit 0

# Platform bindings are human-owned (ADR-0046 section 4): block agent writes to the file.
# Normalized the same way for every spelling: backslashes as separators, symlinks and dot segments resolved, case-folded.
NORMALIZED="${FILE//\\//}"
NORMALIZED="$(realpath -m -- "$NORMALIZED" 2>/dev/null || printf '%s' "$NORMALIZED")"
NORMALIZED="$(printf '%s' "$NORMALIZED" | tr '[:upper:]' '[:lower:]')"
case "$NORMALIZED" in
  */.hseos/config/platform-bindings.yaml|.hseos/config/platform-bindings.yaml)
    PROTECTED_CONTEXT='Platform bindings are human-owned (ADR-0046 §4): .hseos/config/platform-bindings.yaml must not be edited by an agent. Edit it yourself or run `hseos install --platform-mode <mode>`.'
    jq -nc --arg context "$PROTECTED_CONTEXT" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"platform-bindings-protected",additionalContext:$context}}'
    printf '%s\n' "$PROTECTED_CONTEXT" >&2
    exit 2
    ;;
esac
# With platform bindings every Write, Edit and MultiEdit is decided by the CLI (mode-aware, ADR-0046 sections 2 and 5)
# with no legacy pre-filters: the CLI applies the widened detection, path resolution and MultiEdit handling itself.
# Without the file, or when the CLI or node is unavailable or fails, the legacy decision below applies unchanged
# (platform mode).
GUARD_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [[ -f "$GUARD_ROOT/.hseos/config/platform-bindings.yaml" ]]; then
  GUARD_COMMAND=()
  if [[ -x "$GUARD_ROOT/node_modules/.bin/hseos" ]]; then
    GUARD_COMMAND=("$GUARD_ROOT/node_modules/.bin/hseos")
  elif [[ -f "$GUARD_ROOT/tools/cli/hseos-cli.js" ]] && command -v node >/dev/null 2>&1; then
    GUARD_COMMAND=(node "$GUARD_ROOT/tools/cli/hseos-cli.js")
  elif command -v hseos >/dev/null 2>&1; then
    GUARD_COMMAND=(hseos)
  fi
  if [[ ${#GUARD_COMMAND[@]} -gt 0 ]]; then
    set +e
    if command -v timeout >/dev/null 2>&1; then
      GUARD_OUTPUT="$(printf '%s' "$INPUT" | timeout 4s "${GUARD_COMMAND[@]}" platform-bindings guard 2>/dev/null)"
    else
      GUARD_OUTPUT="$(printf '%s' "$INPUT" | "${GUARD_COMMAND[@]}" platform-bindings guard 2>/dev/null)"
    fi
    GUARD_STATUS=$?
    set -e
    if [[ "$GUARD_STATUS" -eq 0 || ( "$GUARD_STATUS" -eq 2 && -n "$GUARD_OUTPUT" ) ]]; then
      [[ -z "$GUARD_OUTPUT" ]] || printf '%s\n' "$GUARD_OUTPUT"
      if [[ "$GUARD_STATUS" -eq 2 ]]; then
        printf '%s\n' "$GUARD_OUTPUT" | jq -r '.hookSpecificOutput.additionalContext // empty' >&2 || true
      fi
      exit "$GUARD_STATUS"
    fi
  fi
fi
case "$FILE" in *.test.*|*.spec.*|*.stories.*|*/__mocks__/*|*.generated.*|*/dist/*) exit 0;; esac
case "$FILE" in */applications/*/src/*|*/packages/*|*/src/Services/*) ;; *) exit 0;; esac
grep -Eq 'export[[:space:]]+(default[[:space:]]+)?(function|class|const|interface|type)|export[[:space:]]*\{|public[[:space:]]+(static[[:space:]]+)?(class|interface)[[:space:]]+' <<<"$CONTENT" || exit 0

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ACK="${CORE_INTAKE_ACK:-}"
if [[ -n "$ACK" && "$ACK" != "1" ]] && find "$ROOT/docs/decisions" -type f -iname '*intake*.md' -print 2>/dev/null | xargs -r grep -Fq "$ACK"; then exit 0; fi

SYMBOL="$(grep -Eo 'export[[:space:]]+(default[[:space:]]+)?(function|class|const|interface|type)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*|public[[:space:]]+(static[[:space:]]+)?(class|interface)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' <<<"$CONTENT" | head -1 | awk '{print $NF}')"
CANDIDATES=""
for search_root in "$ROOT/packages" "$ROOT/cores"; do
  [[ -d "$search_root" ]] || continue
  MATCHES="$(find "$search_root" -type f -iname "*${SYMBOL:-__none__}*" 2>/dev/null | head -3 | sed "s#^$ROOT/##" | paste -sd ', ' -)"
  [[ -n "$MATCHES" ]] && CANDIDATES+="${CANDIDATES:+, }$MATCHES"
done
CONTEXT="[CAPABILITY-INTAKE] Export ${SYMBOL:-unknown} requires a valid CORE_INTAKE_ACK=<intake-id> recorded in docs/decisions/*intake*.md. CORE_INTAKE_ACK=1 is invalid. Run: hseos capability-check ${SYMBOL:-<symbol>}.${CANDIDATES:+ Candidates: $CANDIDATES}"
jq -nc --arg context "$CONTEXT" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"capability-intake-required",additionalContext:$context}}'
exit 2
