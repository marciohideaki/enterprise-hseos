#!/usr/bin/env bash
# Abre a janela da C11 (F20, environment.*): cópia instantânea do project.db ativado, config com memory.* e environment.workspace,
# mcp.json com o envelope systemd-run Delegate=yes (--pipe) apontando para a distribuição global, allowlist do Claude Code só para esta janela (backup por hash).
# Uso: open.sh <sha-da-distribuicao> [--no-allowlist]
set -euo pipefail
S=$1; ALLOW=${2:-}
R=/workspace/local/tooling/hseos-releases/$S
NB=/workspace/local/sdk/nvm/versions/node/v24.15.0/bin
SRC=/workspace/github/marciohideaki/enterprise-hseos/.hseos/state
[ -f "$R/tools/mcp-project-state/index.js" ] || { echo "release ausente: $R"; exit 1; }
M=$(mktemp -d "${TMPDIR:-/build/tmp}/c11-live-XXXX")
date -u +%FT%TZ >"$M/snapshot-at.txt"
cp -p "$SRC/project.db" "$M/project.db"
for s in wal shm; do [ -f "$SRC/project.db-$s" ] && cp -p "$SRC/project.db-$s" "$M/project.db-$s"; done
python3 -c "import sqlite3,sys;c=sqlite3.connect('file:$M/project.db?mode=ro',uri=True);r=c.execute('pragma integrity_check').fetchone()[0];v=c.execute('pragma user_version').fetchone()[0];print('integrity',r,'user_version',v);sys.exit(r!='ok' or v!=17)"
mkdir -p "$M/main/workspace"
printf '%s' 'function calculate(n: number): number { return n + 1; } module.exports = calculate;' >"$M/main/workspace/index.ts"
printf '{}' >"$M/main/manifest.json"
cat >"$M/config.yaml" <<YAML
environment:
  project_id: c11-f20
  toolchain_cache: /build/cache/hseos-toolchain
  workspace:
    host_workspace: $M/main/workspace
    main_checkout: $M/main
    protected_paths:
      - $M/main/manifest.json
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
{"mcpServers":{"hseos-state-tracking":{"command":"systemd-run","args":["--user","-p","Delegate=yes","--wait","--collect","--pipe","--quiet","--working-directory=$M","--setenv=PATH=$NB:/usr/bin:/bin","--setenv=TMPDIR=${TMPDIR:-/build/tmp}","--setenv=HSEOS_STATE_DB=$M/project.db","--setenv=HSEOS_LEGACY_TELEMETRY_DB=$M/legacy.db","--","$NB/node","$R/tools/mcp-project-state/index.js","--db=$M/project.db","--config=$M/config.yaml"]}}}
JSON
if [ "$ALLOW" != "--no-allowlist" ]; then
cp -a "$HOME/.claude/settings.json" "$M/settings.json.before"
sha256sum "$HOME/.claude/settings.json" >"$M/settings.sha256.before"
python3 - "$HOME/.claude/settings.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p)); a=d.setdefault('allowedMcpServers',[])
if not any(x.get('serverName')=='hseos-state-tracking' for x in a): a.append({'serverName':'hseos-state-tracking'})
open(p,'w').write(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
PY
fi
cat >"$M/PROMPT.txt" <<TXT
Use the hseos-state-tracking MCP server. Call environment.lsp.hover exactly once with arguments {"action":"hover","language":"typescript","file":"index.ts","position":{"line":0,"character":10}}. Report the raw result. Do not call any other tool.
TXT
echo "M=$M"
