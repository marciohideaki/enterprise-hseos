'use strict';

// Transparent stdio proxy: launches the governed MCP server in fixture mode and
// records every JSON-RPC frame exchanged with the real client (JSONL).
// usage: node stdio-tee.cjs <frames.jsonl> <repo-root> <fresh-state-db> [server-entry-relative-to-repo-root]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [framesPath, repoRoot, stateDb, entry = 'tools/mcp-hseos-governance/index.js'] = process.argv.slice(2);
const server = spawn(process.execPath, [path.join(repoRoot, entry)], {
  cwd: repoRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR || '/build/tmp',
    // K1_LEGACY_SERVER=1 launches the production-default (legacy 2024-11-05) server instead of the fixture-only governed one.
    ...(process.env.K1_LEGACY_SERVER === '1' ? {} : { NODE_ENV: 'test', HSEOS_GOVERNED_EXECUTION_FIXTURE: '1' }),
    HSEOS_STATE_DB: stateDb,
  },
});

function recorder(direction) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim())
        fs.appendFileSync(framesPath, `${JSON.stringify({ t: new Date().toISOString(), dir: direction, frame: safeParse(line) })}\n`);
    }
  };
}
function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return { unparsable: line.slice(0, 500) };
  }
}

const fromClient = recorder('client->server');
const fromServer = recorder('server->client');
process.stdin.on('data', (chunk) => {
  fromClient(chunk);
  server.stdin.write(chunk);
});
process.stdin.on('end', () => server.stdin.end());
server.stdout.on('data', (chunk) => {
  fromServer(chunk);
  process.stdout.write(chunk);
});
server.stderr.on('data', (chunk) => fs.appendFileSync(`${framesPath}.stderr`, chunk));
server.on('exit', (code) => {
  process.exitCode = code === null ? 1 : code;
  process.stdin.destroy();
});
process.on('SIGTERM', () => server.kill('SIGTERM'));
