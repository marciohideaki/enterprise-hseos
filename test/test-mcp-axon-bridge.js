'use strict';

/**
 * MCP round-trip smoke test for mcp-axon-bridge.
 * Forces fallback mode (AXON_BIN=/nonexistent) and verifies all 6 tools
 * return fallback:true without throwing.
 */

const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'tools', 'mcp-axon-bridge', 'index.js');

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
  return 4000 + Math.floor(Math.random() * 200);
}

function rpc(port, method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
        timeout: 8000,
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (chunks += d));
        res.on('end', () => {
          try {
            const r = JSON.parse(chunks);
            if (r.error) return reject(new Error(`${method}: ${r.error.message}`));
            resolve(r.result);
          } catch (error) {
            reject(error);
          }
        });
      },
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
      try {
        if (await predicate()) return resolve();
      } catch {
        /* swallow */
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error('timeout waiting for server'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

(async () => {
  console.log('mcp-axon-bridge smoke test (fallback mode)');

  const port = pickPort();
  const child = spawn(process.execPath, [SERVER, `--port=${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AXON_BIN: '/nonexistent-axon-binary' },
  });
  child.on('error', (e) => console.error('spawn error', e));

  try {
    await waitFor(async () => {
      try {
        const r = await rpc(port, 'tools/list', {});
        return Array.isArray(r.tools);
      } catch {
        return false;
      }
    });

    await it('tools/list returns 6 tools', async () => {
      const r = await rpc(port, 'tools/list', {});
      const names = new Set(r.tools.map((t) => t.name));
      const expected = ['code_search', 'dep_graph', 'memory_search', 'get_skeleton', 'get_overview', 'run_pipeline'];
      for (const name of expected) {
        if (!names.has(name)) throw new Error(`missing tool: ${name}`);
      }
      if (r.tools.length !== 6) throw new Error(`expected 6 tools, got ${r.tools.length}`);
    });

    await it('initialize handshake', async () => {
      const r = await rpc(port, 'initialize', {});
      if (r.serverInfo?.name !== 'axon-bridge') throw new Error(`unexpected serverInfo: ${JSON.stringify(r.serverInfo)}`);
    });

    const FALLBACK_CASES = [
      { name: 'code_search', arguments: { query: 'test query' } },
      { name: 'dep_graph', arguments: { files: ['src/index.js'] } },
      { name: 'memory_search', arguments: { query: 'test memory' } },
      { name: 'get_skeleton', arguments: { files: ['src/index.js'] } },
      { name: 'get_overview', arguments: {} },
      { name: 'run_pipeline', arguments: {} },
    ];

    for (const { name, arguments: args } of FALLBACK_CASES) {
      await it(`${name} returns fallback:true (no binary)`, async () => {
        const r = await rpc(port, 'tools/call', { name, arguments: args });
        const result = JSON.parse(r.content[0].text);
        if (result.fallback !== true) throw new Error(`expected fallback:true, got ${JSON.stringify(result)}`);
        if (!Array.isArray(result.results)) throw new Error('results is not array');
      });
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!child.killed) child.kill('SIGKILL');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-axon-bridge] fatal:', error.message);
  process.exit(1);
});
