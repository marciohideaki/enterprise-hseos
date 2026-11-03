#!/usr/bin/env bash
# Abre a janela da C8 (F14): cópia instantânea do project.db ativado, config só com memory.*, mcp.json apontando para a distribuição global,
# allowlist do Claude Code liberada para hseos-state-tracking (backup por hash). Uso: open.sh <sha-da-distribuicao>
set -euo pipefail
S=$1
R=/workspace/local/tooling/hseos-releases/$S
N=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin/node
SRC=/workspace/github/marciohideaki/enterprise-hseos/.hseos/state
[ -f "$R/tools/mcp-project-state/index.js" ] || { echo "release ausente: $R"; exit 1; }
M=$(mktemp -d "${TMPDIR:-/build/tmp}/c8-live-XXXX")
date -u +%FT%TZ >"$M/snapshot-at.txt"
cp -p "$SRC/project.db" "$M/project.db"
for s in wal shm; do [ -f "$SRC/project.db-$s" ] && cp -p "$SRC/project.db-$s" "$M/project.db-$s"; done
python3 -c "import sqlite3,sys;c=sqlite3.connect('file:$M/project.db?mode=ro',uri=True);r=c.execute('pragma integrity_check').fetchone()[0];v=c.execute('pragma user_version').fetchone()[0];print('integrity',r,'user_version',v);sys.exit(r!='ok' or v!=17)"
cat >"$M/config.yaml" <<YAML
environment:
  project_id: c8-f14
  memory:
    rules:
      - id: memory-write
        source: project
        stage: allow
        decision: allow
    operator:
      id: owner
      kind: operator
YAML
cat >"$M/mcp.json" <<JSON
{"mcpServers":{"hseos-state-tracking":{"command":"$N","args":["$R/tools/mcp-project-state/index.js","--db=$M/project.db","--config=$M/config.yaml"],"env":{"HSEOS_STATE_DB":"$M/project.db","HSEOS_LEGACY_TELEMETRY_DB":"$M/legacy.db"}}}}
JSON
cp -a "$HOME/.claude/settings.json" "$M/settings.json.before"
sha256sum "$HOME/.claude/settings.json" >"$M/settings.sha256.before"
python3 - "$HOME/.claude/settings.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p)); a=d.setdefault('allowedMcpServers',[])
if not any(x.get('serverName')=='hseos-state-tracking' for x in a): a.append({'serverName':'hseos-state-tracking'})
open(p,'w').write(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
PY
C='Remember: adding integers in this project never overflows, the sum is exact.'
D=$(printf %s "$C" | sha256sum | cut -d' ' -f1)
cat >"$M/PROMPT.txt" <<TXT
Use the hseos-state-tracking MCP server. Call memory.write exactly once with scope {"project_id":"c8-f14"}, memory_id "c8-note-1", content "$C", source_digest "$D", classification "internal", source_ref "doc://runbook/sums", ttl_seconds 86400. Report the raw result. Do not call any other tool.
TXT
echo "M=$M"
