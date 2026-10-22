#!/usr/bin/env bash
# K7: N execucoes do Claude Code (Haiku) contra o servidor project-state moderno (banco ativado) via tee, com config isolada.
# uso: claude-runs.sh <worktree> <scratch K> <primeira> <ultima> ; o teto de gasto acumulado e 0.0195 USD
set -u
W=$1; K=$2; FIRST=$3; LAST=$4
NODE=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin/node
CUM=0
for N in $(seq "$FIRST" "$LAST"); do
  CFG=$K/claude-mcp-run$N.json
  cat >"$CFG" <<JSON
{"mcpServers":{"hseos-project-state":{"type":"stdio","command":"$NODE","args":["$W/docs/evolution/w10/evidence/k7/stdio-tee-activated.cjs","$K/frames-raw/claude-run$N.jsonl","$K/cc","mcp-project-state"]}}}
JSON
  rm -f "$K/frames-raw/claude-run$N.jsonl"*
  (cd "$K/cc" && timeout 150 claude -p "Call the MCP tool state_read of the server hseos-project-state exactly once with no arguments, then reply with the single word DONE." \
    --mcp-config "$CFG" --strict-mcp-config --setting-sources "" --no-session-persistence --model haiku --max-budget-usd 0.004 \
    --allowedTools "mcp__hseos-project-state__state_read" --output-format json </dev/null >"$K/frames-raw/claude-run$N-out.json" 2>"$K/frames-raw/claude-run$N-err.txt")
  echo "run $N rc=$?"
  CUM=$(python3 -c "import json;print(json.load(open('$K/frames-raw/claude-run$N-out.json')).get('total_cost_usd',0))" 2>/dev/null || echo 0)
  echo "run $N cost=$CUM"
done
