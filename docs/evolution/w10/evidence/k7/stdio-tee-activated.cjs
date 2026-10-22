'use strict';

// Proxy stdio transparente (derivado de ../k1/stdio-tee.cjs) para a K7: lanca um servidor MCP do PACOTE INSTALADO sobre um
// banco ATIVADO (modo moderno, sem NODE_ENV=test nem fixture) e grava cada frame JSON-RPC trocado com o cliente real (JSONL).
// uso: node stdio-tee-activated.cjs <frames.jsonl> <consumidor> <diretorio-do-servidor> [--config=<arquivo>]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [framesPath, consumer, serverDir, ...extraArgs] = process.argv.slice(2);
const database = path.join(consumer, '.hseos', 'state', 'project.db');
const args = [path.join(consumer, 'node_modules', 'hseos', 'tools', serverDir, 'index.js')];
if (serverDir === 'mcp-project-state') args.push(`--db=${database}`);
args.push(...extraArgs);
const server = spawn(process.execPath, args, {
  cwd: consumer,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: process.env.TMPDIR || '/build/tmp', HSEOS_STATE_DB: database },
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
