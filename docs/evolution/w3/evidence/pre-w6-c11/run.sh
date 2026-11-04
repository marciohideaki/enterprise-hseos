#!/usr/bin/env bash
set -uo pipefail
export PATH=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin:$HOME/.local/bin:$PATH
S=d05920002872fef32ab6edb0d1053f895b4ff19d
OUT=$(/build/tmp/wc/c11/open.sh $S) || { echo "open falhou"; exit 1; }
M=$(printf '%s\n' "$OUT" | sed -n 's/^M=//p'); echo "M=$M"
restore() { cp -a "$M/settings.json.before" "$HOME/.claude/settings.json"; sha256sum -c "$M/settings.sha256.before" >"$M/settings-restore.txt" 2>&1; echo "restore: $(cat $M/settings-restore.txt)"; }
trap restore EXIT
claude --version >"$M/claude-version.txt" 2>&1
date -u +%FT%TZ >"$M/client-start.txt"
( cd "$M" && timeout 420 claude -p "$(cat PROMPT.txt)" --mcp-config "$M/mcp.json" --strict-mcp-config --output-format json --allowedTools "mcp__hseos-state-tracking__environment_lsp_hover" --max-budget-usd 0.5 >"$M/client-run.json" 2>"$M/client-run.err" ); echo "claude-exit=$?"
date -u +%FT%TZ >"$M/client-end.txt"
head -c 1500 "$M/client-run.json"; echo; head -c 400 "$M/client-run.err"
