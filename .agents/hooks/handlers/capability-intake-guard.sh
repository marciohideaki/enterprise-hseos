#!/usr/bin/env bash
# Capability-reuse intake guard. Compiled adapters invoke this only after Fase 5 activation.
set -euo pipefail

INPUT="$(cat 2>/dev/null || true)"
command -v jq >/dev/null 2>&1 || exit 0
FILE="$(jq -r '.tool_input.file_path // .tool_input.path // ""' <<<"$INPUT")"
CONTENT="$(jq -r '.tool_input.content // .tool_input.new_string // ""' <<<"$INPUT")"
[[ -n "$FILE" ]] || exit 0
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
