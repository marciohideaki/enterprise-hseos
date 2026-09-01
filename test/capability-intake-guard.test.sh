#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HANDLER="$ROOT/.enterprise/governance/hooks/handlers/capability-intake-guard.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q
mkdir -p "$TMP/applications/demo/src" "$TMP/docs/decisions"

run() {
  local path="$1" content="$2" ack="${3:-}" tool="${4:-Write}"
  set +e
  printf '%s' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\",\"content\":\"$content\",\"new_string\":\"$content\"}}" | (cd "$TMP" && CORE_INTAKE_ACK="$ack" bash "$HANDLER") >/dev/null
  local status=$?
  set -e
  echo "$status"
}

blocked=$(run "$TMP/applications/demo/src/Widget.tsx" 'export function Widget() {}')
[[ "$blocked" == 2 ]] || { echo "FAIL missing intake: $blocked"; exit 1; }
printf '%s\n' 'ack: intake-widget' > "$TMP/docs/decisions/2026-intake.md"
allowed=$(run "$TMP/applications/demo/src/Widget.tsx" 'export function Widget() {}' intake-widget)
[[ "$allowed" == 0 ]] || { echo "FAIL valid ACK: $allowed"; exit 1; }
invalid=$(run "$TMP/applications/demo/src/Widget.tsx" 'export function Widget() {}' 1)
[[ "$invalid" == 2 ]] || { echo "FAIL legacy ACK: $invalid"; exit 1; }
ignored=$(run "$TMP/applications/demo/src/Widget.test.tsx" 'export function Widget() {}')
[[ "$ignored" == 0 ]] || { echo "FAIL test exclusion: $ignored"; exit 1; }
nonexport=$(run "$TMP/applications/demo/src/Widget.tsx" 'const Widget = 1')
[[ "$nonexport" == 0 ]] || { echo "FAIL non-export: $nonexport"; exit 1; }
edit_export=$(run "$TMP/applications/demo/src/useDemo.ts" 'export function useDemo() {}' '' Edit)
[[ "$edit_export" == 2 ]] || { echo "FAIL Edit export: $edit_export"; exit 1; }
mkdir -p "$TMP/src/Services/Demo"
dotnet_export=$(run "$TMP/src/Services/Demo/AuditHelper.cs" 'public static class AuditHelper {}')
[[ "$dotnet_export" == 2 ]] || { echo "FAIL .NET helper: $dotnet_export"; exit 1; }
printf '%s\n' 'decision: keep-local-intake' > "$TMP/docs/decisions/2026-keep-local-intake.md"
keep_local=$(run "$TMP/applications/demo/src/LocalWidget.tsx" 'export function LocalWidget() {}' keep-local-intake)
[[ "$keep_local" == 0 ]] || { echo "FAIL keep-local intake: $keep_local"; exit 1; }
echo 'PASS capability-intake-guard: 8 cases'
