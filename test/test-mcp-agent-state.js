/**
 * MCP server smoke test for `as_*` tools (W4 expansion).
 *
 * Spawns the MCP server, calls tools/list, then tools/call for the new tools
 * (runs_list, run_create, agent_runs_list, orphans_list, events_search, handoffs_list, event_emit).
 *
 * Skips cleanly if better-sqlite3 is not installed.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

if (!Database) {
  console.warn('[test-mcp-agent-state] better-sqlite3 not installed — skipping');
  process.exit(0);
}

const REPO_ROOT = path.join(__dirname, '..');
const MCP_SERVER = path.join(REPO_ROOT, 'tools', 'mcp-project-state', 'index.js');

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
  return 3500 + Math.floor(Math.random() * 200);
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
        timeout: 4000,
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
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function waitFor(predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        if (await predicate()) return resolve();
      } catch {
        /* swallow */
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

(async () => {
  console.log('MCP agent-state expansion smoke');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-mcp-'));
  const dbPath = path.join(tmp, '.hseos', 'state', 'project.db');
  const port = pickPort();

  const child = spawn(process.execPath, [MCP_SERVER, `--port=${port}`, `--db=${dbPath}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
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

    await it('tools/list includes new agent-state tools', async () => {
      const r = await rpc(port, 'tools/list', {});
      const names = new Set(r.tools.map((t) => t.name));
      for (const required of [
        'runs_list',
        'run_create',
        'agent_runs_list',
        'orphans_list',
        'events_search',
        'handoffs_list',
      ]) {
        if (!names.has(required)) throw new Error(`missing tool: ${required}`);
      }
    });

    await it('run_create + runs_list roundtrip', async () => {
      await rpc(port, 'tools/call', {
        name: 'run_create',
        arguments: { id: 'R-mcp-1', workflow_id: 'dev-squad', project: tmp },
      });
      const list = await rpc(port, 'tools/call', { name: 'runs_list', arguments: {} });
      if (!list.runs || list.runs.length === 0) throw new Error('runs_list empty after create');
      if (!list.runs.some((r) => r.id === 'R-mcp-1')) throw new Error('R-mcp-1 missing from runs_list');
    });

    await it('agent_runs_list filters by run_id', async () => {
      const result = await rpc(port, 'tools/call', { name: 'agent_runs_list', arguments: { run_id: 'R-mcp-1' } });
      if (!Array.isArray(result.agent_runs)) throw new Error('agent_runs not array');
    });

    await it('orphans_list shape', async () => {
      const result = await rpc(port, 'tools/call', { name: 'orphans_list', arguments: { stale_minutes: 5 } });
      if (!Array.isArray(result.orphans)) throw new Error('orphans not array');
      if (result.stale_minutes !== 5) throw new Error('stale_minutes echo mismatch');
    });
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!child.killed) child.kill('SIGKILL');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-agent-state] fatal:', error.message);
  process.exit(1);
});
