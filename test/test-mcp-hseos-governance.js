'use strict';

/**
 * MCP round-trip smoke test for mcp-hseos-governance.
 * Spawns the server, verifies 5 tools are listed, calls each tool with minimal input.
 */

const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'tools', 'mcp-hseos-governance', 'index.js');

let pass = 0;
let fail = 0;

async function it(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    pass++;
  } catch (error) {
    console.log(`  \u2717 ${name}\n    ${error.message}`);
    fail++;
  }
}

function pickPort() {
  return 3600 + Math.floor(Math.random() * 200);
}

function rpc(port, method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const req = http.request(
      { host: '127.0.0.1', port, path: '/', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }, timeout: 4000 },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (chunks += d));
        res.on('end', () => {
          try {
            const r = JSON.parse(chunks);
            if (r.error) return reject(new Error(`${method}: ${r.error.message}`));
            resolve(r.result);
          } catch (error) { reject(error); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function waitFor(predicate, { timeoutMs = 6000, intervalMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      try { if (await predicate()) return resolve(); } catch { /* swallow */ }
      if (Date.now() - t0 > timeoutMs) return reject(new Error('timeout waiting for server'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

(async () => {
  console.log('mcp-hseos-governance smoke test');

  const port = pickPort();
  const child = spawn(process.execPath, [SERVER, `--port=${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('error', (e) => console.error('spawn error', e));

  try {
    await waitFor(async () => {
      try { const r = await rpc(port, 'tools/list', {}); return Array.isArray(r.tools); } catch { return false; }
    });

    await it('tools/list returns 5 tools', async () => {
      const r = await rpc(port, 'tools/list', {});
      const names = new Set(r.tools.map((t) => t.name));
      const expected = ['query_constitution', 'validate_adr', 'check_authority', 'list_skills', 'list_workflows'];
      for (const name of expected) {
        if (!names.has(name)) throw new Error(`missing tool: ${name}`);
      }
      if (r.tools.length !== 5) throw new Error(`expected 5 tools, got ${r.tools.length}`);
    });

    await it('initialize handshake', async () => {
      const r = await rpc(port, 'initialize', {});
      if (r.serverInfo?.name !== 'hseos-governance') throw new Error(`unexpected serverInfo: ${JSON.stringify(r.serverInfo)}`);
    });

    await it('query_constitution (no article = all)', async () => {
      const r = await rpc(port, 'tools/call', { name: 'query_constitution', arguments: {} });
      const result = JSON.parse(r.content[0].text);
      if (!result.article) throw new Error('missing article field');
    });

    await it('validate_adr architectural = required', async () => {
      const r = await rpc(port, 'tools/call', { name: 'validate_adr', arguments: { change_kind: 'architectural' } });
      const result = JSON.parse(r.content[0].text);
      if (result.required !== true) throw new Error(`expected required:true, got ${result.required}`);
    });

    await it('validate_adr documentation = not required', async () => {
      const r = await rpc(port, 'tools/call', { name: 'validate_adr', arguments: { change_kind: 'documentation' } });
      const result = JSON.parse(r.content[0].text);
      if (result.required !== false) throw new Error(`expected required:false, got ${result.required}`);
    });

    await it('check_authority ghost', async () => {
      const r = await rpc(port, 'tools/call', { name: 'check_authority', arguments: { agent_code: 'ghost' } });
      const result = JSON.parse(r.content[0].text);
      if (result.agent_code === undefined) throw new Error('missing agent_code');
    });

    await it('list_skills returns array', async () => {
      const r = await rpc(port, 'tools/call', { name: 'list_skills', arguments: {} });
      const result = JSON.parse(r.content[0].text);
      if (!Array.isArray(result.skills)) throw new Error('skills is not array');
    });

    await it('list_workflows returns array', async () => {
      const r = await rpc(port, 'tools/call', { name: 'list_workflows', arguments: {} });
      const result = JSON.parse(r.content[0].text);
      if (!Array.isArray(result.workflows)) throw new Error('workflows is not array');
    });

  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!child.killed) child.kill('SIGKILL');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-hseos-governance] fatal:', error.message);
  process.exit(1);
});
