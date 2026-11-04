// Free pre-check: speak MCP over stdio to the exact systemd-run wrapper of mcp.json and list tools (no tools/call, no client).
const { spawn } = require('node:child_process');
const cfg = JSON.parse(require('node:fs').readFileSync(process.argv[2] + '/mcp.json', 'utf8')).mcpServers['hseos-state-tracking'];
const p = spawn(cfg.command, cfg.args, { stdio: ['pipe', 'pipe', 'pipe'] });
let out = '',
  err = '';
p.stdout.on('data', (d) => (out += d));
p.stderr.on('data', (d) => (err += d));
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c11-handshake', version: '0' } },
});
setTimeout(() => {
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
}, 1500);
setTimeout(() => {
  const msgs = out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const list = msgs.find((m) => m.id === 2);
  const names = (list?.result?.tools || []).map((t) => t.name);
  console.log(
    JSON.stringify(
      {
        protocol: msgs.find((m) => m.id === 1)?.result?.protocolVersion,
        tools: names.length,
        lsp: names.filter((n) => n.startsWith('environment.lsp')),
        dap: names.filter((n) => n.startsWith('environment.dap')).length,
        memory: names.filter((n) => n.startsWith('memory.')),
        stderr_has_off_line: /environment\.lsp and environment\.dap are off/.test(err),
        stderr: err.slice(0, 300),
      },
      null,
      1,
    ),
  );
  p.kill('SIGTERM');
  process.exitCode = 0;
}, 8000);
