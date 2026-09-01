#!/usr/bin/env bash
# Managed-shadow session preflight. Advisory and project-scoped by contract.
set -u

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$PROJECT_ROOT" ]] || exit 0
[[ -f "$PROJECT_ROOT/.hseos/config/managed-governance.json" ]] || exit 0

if [[ -x "$PROJECT_ROOT/node_modules/.bin/hseos" ]]; then
  COMMAND=("$PROJECT_ROOT/node_modules/.bin/hseos")
elif [[ -f "$PROJECT_ROOT/tools/cli/hseos-cli.js" ]]; then
  COMMAND=(node "$PROJECT_ROOT/tools/cli/hseos-cli.js")
elif command -v hseos >/dev/null 2>&1; then
  COMMAND=(hseos)
else
  echo "HSEOS managed-shadow advisory: session preflight is unavailable because the project CLI was not found. Local Constitution remains authoritative."
  exit 0
fi

if command -v timeout >/dev/null 2>&1; then
  OUTPUT="$(cd "$PROJECT_ROOT" && timeout 4s "${COMMAND[@]}" governance session preflight --json 2>/dev/null)" || OUTPUT=""
else
  OUTPUT="$(cd "$PROJECT_ROOT" && "${COMMAND[@]}" governance session preflight --json 2>/dev/null)" || OUTPUT=""
fi

if [[ -z "$OUTPUT" ]]; then
  echo "HSEOS managed-shadow advisory: session preflight did not complete. Local Constitution remains authoritative."
  exit 0
fi

STATUS="$(printf '%s' "$OUTPUT" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const envelope = JSON.parse(input);
    const status = envelope?.data?.status;
    const reason = envelope?.data?.reason_code;
    if (typeof status !== "string" || typeof reason !== "string") process.exit(1);
    process.stdout.write(`${status}\t${reason}`);
  } catch { process.exit(1); }
});
' 2>/dev/null)" || STATUS=""

if [[ -z "$STATUS" ]]; then
  echo "HSEOS managed-shadow advisory: session preflight returned an unsupported result. Local Constitution remains authoritative."
  exit 0
fi

IFS=$'\t' read -r RESULT_STATUS RESULT_REASON <<<"$STATUS"
if [[ "$RESULT_STATUS" == "equivalent" || "$RESULT_STATUS" == "not_configured" ]]; then
  exit 0
fi

echo "HSEOS managed-shadow advisory: $RESULT_STATUS ($RESULT_REASON). Local Constitution remains authoritative."
exit 0
