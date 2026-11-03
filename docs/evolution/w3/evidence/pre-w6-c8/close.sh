#!/usr/bin/env bash
# Fecha a janela da C8: restaura a allowlist por hash. Uso: close.sh <diretorio-da-campanha>
set -euo pipefail
M=$1
cp -a "$M/settings.json.before" "$HOME/.claude/settings.json"
sha256sum -c "$M/settings.sha256.before"
echo "allowlist restaurada; copia do banco em $M"
