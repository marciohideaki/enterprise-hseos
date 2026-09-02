'use strict';

/**
 * MCP round-trip smoke test for mcp-hseos-swarm.
 * Spawns server, verifies 5 tools, exercises plan_squad + get_run_state + list_runs.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { MCP_LEGACY_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');

const REPO_ROOT = path.join(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'tools', 'mcp-hseos-swarm', 'index.js');

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

function waitForServerPort(child, { timeoutMs = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`timeout waiting for server port${output ? `: ${output.slice(-500)}` : ''}`)), timeoutMs);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-2000);
      const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before listening (code=${code}, signal=${signal})${output ? `: ${output.slice(-500)}` : ''}`));
    });
  });
}

function rpc(port, method, params = {}) {
  const normalizedParams =
    method === 'initialize'
      ? { protocolVersion: MCP_LEGACY_PROTOCOL_VERSION, clientInfo: { name: 'swarm-test', version: '1.0.0' }, ...params }
      : params;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: normalizedParams });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
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
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function toolData(result) {
  const envelope = result.structuredContent || JSON.parse(result.content[0].text);
  if (!Object.hasOwn(envelope, 'ok')) return envelope;
  if (!envelope.ok) throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
  return envelope.data.result;
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
  console.log('mcp-hseos-swarm smoke test');

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-swarm-state-'));
  const child = spawn(process.execPath, [SERVER, '--port=0'], {
    cwd: stateDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HSEOS_STATE_DB: path.join(stateDir, 'project.db'),
      NODE_ENV: 'production',
    },
  });
  child.on('error', (e) => console.error('spawn error', e));

  let testRunId = null;

  try {
    const port = await waitForServerPort(child);
    await waitFor(async () => {
      try {
        const r = await rpc(port, 'tools/list', {});
        return Array.isArray(r.tools);
      } catch {
        return false;
      }
    });

    await it('tools/list returns 5 tools', async () => {
      const r = await rpc(port, 'tools/list', {});
      const names = new Set(r.tools.map((t) => t.name));
      const expected = ['list_runs', 'plan_squad', 'dispatch_wave', 'consolidate_handoff', 'get_run_state'];
      for (const name of expected) {
        if (!names.has(name)) throw new Error(`missing tool: ${name}`);
      }
    });

    await it('list_runs returns array (may be empty)', async () => {
      const r = await rpc(port, 'tools/call', { name: 'list_runs', arguments: {} });
      const result = toolData(r);
      if (!Array.isArray(result.runs)) throw new Error('runs is not array');
    });

    await it('plan_squad creates run dir + PLAN.md', async () => {
      const r = await rpc(port, 'tools/call', {
        name: 'plan_squad',
        arguments: {
          batch_description: 'W3 MCP smoke test batch',
          run_id: `test-smoke-${Date.now()}`,
        },
      });
      const result = toolData(r);
      if (!result.run_id) throw new Error('missing run_id');
      if (!result.run_dir) throw new Error('missing run_dir');
      if (!result.plan_md) throw new Error('missing plan_md');
      if (!fs.existsSync(path.join(result.run_dir, 'PLAN.md'))) throw new Error('PLAN.md not written');
      testRunId = result.run_id;
    });

    await it('get_run_state returns STATUS.md content', async () => {
      if (!testRunId) throw new Error('no test run_id — plan_squad must pass first');
      const r = await rpc(port, 'tools/call', { name: 'get_run_state', arguments: { run_id: testRunId } });
      const result = toolData(r);
      if (!result.status) throw new Error('status is null — STATUS.md not found');
      if (!result.status.includes('INTAKE')) throw new Error('STATUS.md missing INTAKE phase');
    });

    await it('list_runs includes the new run', async () => {
      if (!testRunId) throw new Error('no test run_id');
      const r = await rpc(port, 'tools/call', { name: 'list_runs', arguments: {} });
      const result = toolData(r);
      if (!result.runs.some((run) => run.id === testRunId)) throw new Error(`run ${testRunId} not in list`);
    });

    await it('dispatch_wave no-waves returns gracefully', async () => {
      if (!testRunId) throw new Error('no test run_id');
      const r = await rpc(port, 'tools/call', { name: 'dispatch_wave', arguments: { run_id: testRunId, wave_index: 0 } });
      const result = toolData(r);
      if (!('worktree_paths' in result) && !('note' in result) && !('error' in result)) {
        throw new Error('dispatch_wave returned unexpected shape');
      }
    });
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!child.killed) child.kill('SIGKILL');

    // Cleanup test run dir
    if (testRunId) {
      const runDir = path.join(REPO_ROOT, '.hseos', 'runs', 'dev-squad', testRunId);
      if (fs.existsSync(runDir)) fs.rmSync(runDir, { recursive: true, force: true });
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-hseos-swarm] fatal:', error.message);
  process.exit(1);
});
