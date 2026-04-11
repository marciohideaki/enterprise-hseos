#!/usr/bin/env bash
# Usage: tools/install-all.sh [--root /opt/hideakisolutions] [--second-brain-path /path/to/vault]
#
# Installs HSEOS in all git repositories under ROOT, skipping known non-project dirs.

set -uo pipefail

ROOT="/opt/hideakisolutions"
VAULT_PATH=""
SKIP_DIRS=("second-brain" "enterprise-hseos")

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --second-brain-path) VAULT_PATH="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

ok=0
fail=0

for dir in "$ROOT"/*/; do
  name=$(basename "$dir")

  # Skip list
  skip=false
  for s in "${SKIP_DIRS[@]}"; do
    [[ "$name" == "$s" ]] && skip=true && break
  done
  $skip && echo "[skip] $name (excluded)" && continue

  # Only git repos
  if [[ ! -d "$dir/.git" ]]; then
    echo "[skip] $name (not a git repo)"
    continue
  fi

  echo "[install] $name..."

  args=(--yes --directory "$dir")
  [[ -n "$VAULT_PATH" ]] && args+=(--second-brain-path "$VAULT_PATH")

  if hseos install "${args[@]}" > "/tmp/hseos-install-${name}.log" 2>&1; then
    echo "  [ok] $name"
    ((ok++))
  else
    echo "  [fail] $name — see /tmp/hseos-install-${name}.log"
    ((fail++))
  fi
done

echo ""
echo "Done: $ok installed, $fail failed"
