'use strict';

/**
 * Transport robustness for the shared MCP transport (legacy path):
 *  M1 - non-object JSON values must yield -32600 and never kill the server (stdio + HTTP)
 *  M2 - tools/call validates arguments against the declared inputSchema (-32602) before any effect
 *  L1 - notifications (no id) with unknown methods get no response
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

// HSEOS_TEST_REPO_ROOT lets the same cases run against another tools/ tree (e.g. a copy holding master's transport).
const REPO_ROOT = process.env.HSEOS_TEST_REPO_ROOT || path.join(__dirname, '..');
// The axon-bridge only serves HTTP behind a bearer credential of at least 32 characters.
const AXON_BRIDGE_CREDENTIAL = crypto.randomBytes(24).toString('hex');
const AUTHORIZATION = { authorization: `Bearer ${AXON_BRIDGE_CREDENTIAL}` };
const { createMessageHandler } = require(path.join(REPO_ROOT, 'tools', 'lib', 'mcp-transport'));
const STDIO_SERVERS = [
  { name: 'hseos-governance', script: 'mcp-hseos-governance' },
  { name: 'hseos-swarm', script: 'mcp-hseos-swarm' },
  { name: 'hseos-project-state', script: 'mcp-project-state' },
];
const BAD_MESSAGES = ['null', '[]', '"x"', '42', 'true', '{"jsonrpc":"2.0","id":9}', '{"jsonrpc":"2.0","id":9,"method":""}'];

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    failed++;
  }
}

function legacyEnv(tmp) {
  const env = { ...process.env, HSEOS_STATE_DB: path.join(tmp, 'project.db'), NODE_ENV: 'production' };
  delete env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
  return env;
}

// Sends each line, waits for `expected` response lines (or a quiet period), reports exit state.
function stdioSession(script, lines, expected) {
  return new Promise((resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-mcp-robust-'));
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'tools', script, 'index.js')], {
      cwd: tmp,
      env: legacyEnv(tmp),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let exited = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const responses = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const result = { responses, exited };
      child.kill('SIGKILL');
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve(result);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.split('\n').filter(Boolean).length >= expected) setTimeout(finish, 150);
    });
    child.on('error', reject);
    child.on('exit', () => {
      exited = true;
      finish();
    });
    setTimeout(finish, 8000).unref();
    child.stdin.write(`${lines.join('\n')}\n`);
  });
}

const INIT = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';

function post(port, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: AUTHORIZATION }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, headers: AUTHORIZATION }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', reject);
  });
}

function call(id, name, args) {
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
}

(async () => {
  console.log('mcp transport robustness test');

  const runsDir = path.join(REPO_ROOT, '.hseos', 'runs', 'dev-squad');
  const runsBefore = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];

  for (const server of STDIO_SERVERS) {
    await it(`${server.name}: non-object JSON gets -32600 and the server stays alive (M1)`, async () => {
      const { responses, exited } = await stdioSession(server.script, [...BAD_MESSAGES, INIT], BAD_MESSAGES.length + 1);
      assert.equal(exited, false, 'server exited');
      assert.equal(responses.length, BAD_MESSAGES.length + 1, JSON.stringify(responses));
      for (const response of responses.slice(0, BAD_MESSAGES.length)) {
        assert.equal(response.error?.code, -32_600, JSON.stringify(response));
      }
      assert.ok(responses.at(-1).result, 'initialize after bad input must succeed');
    });

    await it(`${server.name}: unknown-method notification gets no response (L1)`, async () => {
      const { responses } = await stdioSession(
        server.script,
        ['{"jsonrpc":"2.0","method":"bogus/notification"}', '{"jsonrpc":"2.0","id":5,"method":"bogus/request"}'],
        1,
      );
      assert.equal(responses.length, 1, JSON.stringify(responses));
      assert.equal(responses[0].id, 5);
      assert.equal(responses[0].error.code, -32_601);
    });
  }

  await it('hseos-swarm: plan_squad rejects missing/wrong-typed arguments before any effect (M2)', async () => {
    const { responses } = await stdioSession(
      'mcp-hseos-swarm',
      [
        call(1, 'plan_squad', { run_id: 'robust-m2-missing' }),
        call(2, 'plan_squad', { batch_description: 123, run_id: 'robust-m2-type' }),
        call(3, 'plan_squad', { batch_description: { a: 1 }, run_id: 'robust-m2-object' }),
        call(4, 'plan_squad', 'not-an-object'),
      ],
      4,
    );
    assert.equal(responses.length, 4);
    for (const response of responses) assert.equal(response.error?.code, -32_602, JSON.stringify(response));
    const runsAfter = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
    assert.deepEqual(runsAfter, runsBefore, 'no run directory may be created by rejected calls');
  });

  await it('hseos-project-state: tasks_list rejects an enum violation (M2)', async () => {
    const { responses } = await stdioSession(
      'mcp-project-state',
      [call(1, 'tasks_list', { status: 'bogus' }), call(2, 'tasks_list', {})],
      2,
    );
    assert.equal(responses[0].error?.code, -32_602, JSON.stringify(responses[0]));
    assert.ok(responses[1].result, JSON.stringify(responses[1]));
  });

  await it('handler: additionalProperties:false is enforced and unknown tools fall through (M2)', async () => {
    let calls = 0;
    const handle = createMessageHandler({
      serverInfo: { name: 't', version: '1' },
      tools: [{ name: 'strict', inputSchema: { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } } }],
      callTool: async () => {
        calls++;
        return {};
      },
    });
    const extra = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'strict', arguments: { b: 1 } } });
    assert.equal(extra.error.code, -32_602);
    const nullArgs = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'strict', arguments: null } });
    assert.equal(nullArgs.error.code, -32_602);
    const noName = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} });
    assert.equal(noName.error.code, -32_602);
    assert.equal(calls, 0);
    const ok = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'strict', arguments: { a: 'x' } } });
    assert.ok(ok.result);
    assert.equal(calls, 1);
    assert.equal(await handle({ jsonrpc: '2.0', method: 'bogus/notification' }), null);
  });

  await it('hseos-swarm: tools/call without id is discarded, never executed or answered (T1)', async () => {
    const { responses } = await stdioSession(
      'mcp-hseos-swarm',
      [
        '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"plan_squad","arguments":{"run_id":"robust-t1"}}}',
        '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"plan_squad","arguments":{"batch_description":"x","run_id":"robust-t1-ok"}}}',
        INIT,
      ],
      1,
    );
    assert.equal(responses.length, 1, JSON.stringify(responses));
    assert.equal(responses[0].id, 1);
    const runsAfter = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [];
    assert.deepEqual(runsAfter, runsBefore, 'a notification must not execute tools/call');
  });

  await it('handler: ids of invalid type get -32600 with null id (T2)', async () => {
    const handle = createMessageHandler({ serverInfo: { name: 't', version: '1' }, tools: [], callTool: async () => ({}) });
    for (const id of [{}, [], true, null, '', 1.5]) {
      const response = await handle({ jsonrpc: '2.0', id, method: 'tools/list' });
      assert.equal(response.error?.code, -32_600, JSON.stringify({ id, response }));
      assert.equal(response.id, null);
    }
    assert.ok((await handle({ jsonrpc: '2.0', id: 'a', method: 'tools/list' })).result);
    assert.ok((await handle({ jsonrpc: '2.0', id: 0, method: 'tools/list' })).result);
  });

  await it('axon-bridge (http): null/array bodies get -32600, server survives, bad args get -32602 (M1, M2)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-axon-robust-'));
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'tools', 'mcp-axon-bridge', 'index.js'), '--http', '--port=0'], {
      cwd: tmp,
      env: { ...legacyEnv(tmp), AXON_BIN: '/nonexistent-axon-binary', HSEOS_AXON_BRIDGE_CREDENTIAL: AXON_BRIDGE_CREDENTIAL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const port = await new Promise((resolve, reject) => {
        let out = '';
        const onData = (chunk) => {
          out += chunk;
          const match = out.match(/127\.0\.0\.1:(\d+)/);
          if (match) resolve(Number(match[1]));
        };
        // The listening banner goes to stderr so stdout stays a clean protocol channel.
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', () => reject(new Error(`axon-bridge exited early: ${out}`)));
        setTimeout(() => reject(new Error('timeout waiting for port')), 8000).unref();
      });
      for (const body of ['null', '[]', '"x"', '42', '{"jsonrpc":"2.0","id":3}']) {
        const response = await post(port, body);
        assert.equal(response.body?.error?.code, -32_600, `${body}: ${JSON.stringify(response)}`);
        assert.equal(await get(port, '/health'), 200, `server died after ${body}`);
      }
      for (const args of [{}, { query: 123, limit: 'abc' }]) {
        const response = await post(port, call(4, 'code_search', args));
        assert.equal(response.body?.error?.code, -32_602, JSON.stringify(response));
      }
      const notification = await post(port, '{"jsonrpc":"2.0","method":"bogus/notification"}');
      assert.equal(notification.status, 202);
      assert.equal(notification.body, null);
    } finally {
      child.kill('SIGKILL');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  console.log(`\nMCP transport robustness tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-transport-robustness] fatal:', error.message);
  process.exit(1);
});
