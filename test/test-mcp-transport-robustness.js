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

// ---------------------------------------------------------------------------
// W5-04: eager $ref resolution, bounded HTTP body, legacy gateway (denials), telemetry target guards.
// ---------------------------------------------------------------------------
const { MAX_HTTP_BODY_BYTES, buildMcpError, createHttpServer, startStdioServer } = require(
  path.join(REPO_ROOT, 'tools', 'lib', 'mcp-transport'),
);
const {
  SCOPE_DENIED_CODE,
  TOOL_UNKNOWN_CODE,
  assertLegacyTelemetryTarget,
  createLegacyGateway,
  resolveLegacyTelemetryPath,
  startLegacyMcpServer,
} = require(path.join(REPO_ROOT, 'tools', 'lib', 'legacy-mcp-server'));

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function rawPost(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const TOOL_DESCRIPTOR = { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } };

async function runW504Tests() {
  // Clean shutdown matters for coverage too: a SIGKILLed child never flushes its V8 coverage.
  function runToExit(script, input, { env = legacyEnv, extraArgs = [], cwd } = {}) {
    return new Promise((resolve, reject) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-exit-'));
      const child = spawn(process.execPath, [...extraArgs, path.join(REPO_ROOT, 'tools', script, 'index.js')], {
        cwd: cwd || tmp,
        env: env(tmp),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        fs.rmSync(tmp, { recursive: true, force: true });
        resolve({ code, stdout, stderr });
      });
      child.stdin.end(input);
    });
  }

  for (const script of ['mcp-hseos-governance', 'mcp-hseos-swarm']) {
    await it(`${script}: legacy stdio answers parse errors, then exits 0 when stdin closes`, async () => {
      const result = await runToExit(script, `not json\n\n${INIT}\n${call(2, 'ghost_tool', {})}\n`);
      assert.equal(result.code, 0, result.stderr);
      const lines = result.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.equal(lines[0].error.code, -32_700);
      assert.ok(lines[1].result);
      assert.equal(lines[2].error.message, 'Unknown tool: ghost_tool');
      assert.ok(result.stderr.includes('[gateway:denied]') || result.stderr.includes(':gateway:denied]'), result.stderr);
    });

    await it(`${script}: a server that cannot start exits with the boot code instead of a stack trace`, async () => {
      const result = await runToExit(script, '', {
        env: (tmp) => ({ ...legacyEnv(tmp), HSEOS_LEGACY_TELEMETRY_DB: 'relative.db' }),
      });
      assert.equal(result.code, 78, result.stderr);
      assert.ok(result.stderr.includes('fatal:') && result.stderr.includes('absolute path'), result.stderr);
    });

    await it(`${script}: an unreadable tool directory fails the real entrypoint's boot with the catalog code`, async () => {
      const preload = path.join(os.tmpdir(), `hseos-w5-04-preload-${process.pid}-${script}.cjs`);
      fs.writeFileSync(
        preload,
        "const fs = require('node:fs'); const real = fs.existsSync; fs.existsSync = (target) => (String(target).endsWith('/tools') && String(target).includes('mcp-hseos-') ? false : real(target));",
      );
      try {
        const result = await runToExit(script, '', { extraArgs: ['--require', preload] });
        assert.equal(result.code, 78, result.stderr);
        assert.ok(result.stderr.includes('MCP_TOOL_CATALOG_INVALID'), result.stderr);
      } finally {
        fs.rmSync(preload, { force: true });
      }
    });
  }

  await it('transport: an unresolvable $ref fails at registration, not at the first call', async () => {
    assert.throws(
      () =>
        createMessageHandler({
          serverInfo: { name: 't', version: '1' },
          tools: [{ name: 'broken', description: 'd', inputSchema: { type: 'object', properties: { a: { $ref: '#/$defs/missing' } } } }],
          callTool: async () => ({}),
        }),
      (error) => error.code === 'MCP_TOOL_SCHEMA_INVALID' && error.message.includes('broken'),
    );
    const handler = createMessageHandler({
      serverInfo: { name: 't', version: '1' },
      tools: [
        {
          name: 'ref_ok',
          description: 'd',
          inputSchema: { type: 'object', $defs: { text: { type: 'string' } }, properties: { a: { $ref: '#/$defs/text' } } },
        },
      ],
      callTool: async () => ({ ok: true }),
    });
    const bad = await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ref_ok', arguments: { a: 5 } } });
    assert.equal(bad.error.code, -32_602);
    const good = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ref_ok', arguments: { a: 'x' } } });
    assert.ok(good.result);
  });

  await it('transport: only errors with an allowlisted authored code keep their message on the client', async () => {
    const hostile = 'ENOENT /home/x/.ssh/id_ed25519 token=sk-test-000';
    const thrown = new Map([
      ['plain', () => new Error(hostile)],
      ['foreign-code', () => Object.assign(new Error(hostile), { code: 'ENOENT' })],
      ['authored', () => Object.assign(new Error('Task not found: t-1'), { code: 'TASK_NOT_FOUND' })],
      ['prefixed', () => Object.assign(new Error('axon is down'), { code: 'AXON_UNAVAILABLE' })],
    ]);
    const stderrOriginal = process.stderr.write;
    const captured = [];
    process.stderr.write = (chunk) => (captured.push(String(chunk)), true);
    try {
      const handler = createMessageHandler({
        serverInfo: { name: 't', version: '1' },
        tools: [{ name: 'boom', description: 'd', inputSchema: { type: 'object', properties: { kind: { type: 'string' } } } }],
        callTool: async (name, args) => {
          throw thrown.get(args.kind)();
        },
      });
      const call = (kind) => handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'boom', arguments: { kind } } });
      for (const kind of ['plain', 'foreign-code']) {
        const response = await call(kind);
        assert.equal(response.error.code, -32_000);
        assert.equal(response.error.message, 'Tool failed');
        assert.ok(!JSON.stringify(response).includes('id_ed25519'), JSON.stringify(response));
      }
      assert.equal((await call('authored')).error.message, 'Task not found: t-1');
      assert.equal((await call('prefixed')).error.message, 'axon is down');
      assert.ok(captured.join('').includes('id_ed25519'), 'the detail must go to stderr');

      const http = createHttpServer(
        async (message) => {
          throw thrown.get(message.kind)();
        },
        { status: 'ok' },
      );
      const port = await listen(http);
      try {
        for (const kind of ['plain', 'foreign-code']) {
          const response = await rawPost(port, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', kind }));
          assert.equal(response.body.error.code, -32_603);
          assert.equal(response.body.error.message, 'Internal error');
          assert.ok(!JSON.stringify(response.body).includes('id_ed25519'), JSON.stringify(response.body));
        }
        const authored = await rawPost(port, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', kind: 'authored' }));
        assert.equal(authored.body.error.message, 'Internal error: Task not found: t-1');
      } finally {
        http.close();
      }
    } finally {
      process.stderr.write = stderrOriginal;
    }
  });

  await it('transport: a legacy HTTP body above the limit is refused with 413 and the server survives', async () => {
    assert.equal(MAX_HTTP_BODY_BYTES, 1_048_576);
    const handled = [];
    const server = createHttpServer(
      async (message) => (handled.push(message), { jsonrpc: '2.0', id: message.id, result: {} }),
      { status: 'ok' },
      { maxBodyBytes: 2048 },
    );
    const port = await listen(server);
    try {
      const small = await rawPost(port, '{"jsonrpc":"2.0","id":1,"method":"ping"}');
      assert.equal(small.status, 200);
      const oversized = await rawPost(port, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: { pad: 'x'.repeat(8192) } }));
      assert.equal(oversized.status, 413, JSON.stringify(oversized));
      assert.equal(oversized.body.error.code, -32_600);
      assert.equal(oversized.body.error.message, 'Request body exceeds limit');
      assert.equal(handled.length, 1, 'the oversized body must never reach the handler');
      assert.equal((await rawPost(port, '{"jsonrpc":"2.0","id":3,"method":"ping"}')).status, 200);
      assert.equal((await rawPost(port, 'not json')).status, 400);
      assert.equal(await get(port, '/health').catch(() => 0), 200);
    } finally {
      server.close();
    }
  });

  await it('transport: an upload of 3 MiB over the limit still receives the complete 413 and never reaches the handler', async () => {
    let handled = 0;
    const server = createHttpServer(
      async () => {
        handled++;
        return { jsonrpc: '2.0', id: 1, result: {} };
      },
      { status: 'ok' },
    );
    const port = await listen(server);
    try {
      const outcome = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'Transfer-Encoding': 'chunked' } });
        req.on('response', (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', (error) => setTimeout(() => reject(error), 500).unref());
        const chunk = Buffer.alloc(1024 * 1024, 0x78);
        req.write(chunk);
        req.write(chunk);
        req.write(chunk);
        req.end(chunk);
      });
      assert.equal(outcome.status, 413);
      assert.equal(JSON.parse(outcome.data).error.message, 'Request body exceeds limit');
      assert.equal(handled, 0);
      assert.equal(await get(port, '/health'), 200);
    } finally {
      server.close();
      server.closeAllConnections();
    }
  });

  await it('transport: a handler that returns nothing answers 202 and a throwing handler answers -32603', async () => {
    const server = createHttpServer(
      async (message) => {
        if (message.method === 'boom') throw new Error('handler exploded');
        return null;
      },
      { status: 'ok' },
    );
    const port = await listen(server);
    try {
      assert.equal((await rawPost(port, '{"jsonrpc":"2.0","method":"quiet"}')).status, 202);
      const exploded = await rawPost(port, '{"jsonrpc":"2.0","id":1,"method":"boom"}');
      assert.equal(exploded.body.error.code, -32_603);
      assert.deepEqual(buildMcpError(1, -32_000, 'm'), { jsonrpc: '2.0', id: 1, error: { code: -32_000, message: 'm' } });
      const wrongMethod = await new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port, method: 'PUT', path: '/' }, (res) => (res.resume(), resolve(res.statusCode)));
        req.end();
      });
      assert.equal(wrongMethod, 405);
    } finally {
      server.close();
    }
  });

  await it('transport: stdio answers parse errors and stays up, and the JSON-RPC notification path stays silent', async () => {
    assert.equal(typeof startStdioServer, 'function');
    const handler = createMessageHandler({
      serverInfo: { name: 't', version: '1' },
      tools: [TOOL_DESCRIPTOR],
      callTool: async () => ({ ok: 1 }),
    });
    for (const method of ['initialize', 'notifications/initialized', 'tools/list', 'nope']) {
      const response = await handler({ jsonrpc: '2.0', id: 1, method, params: {} });
      assert.ok(response.result || response.error, method);
    }
    assert.equal(await handler({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'echo' } }), null);
    const missingName = await handler({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { arguments: {} } });
    assert.equal(missingName.error.code, -32_602);
    const wrapped = await createMessageHandler({
      serverInfo: { name: 't', version: '1' },
      tools: [TOOL_DESCRIPTOR],
      wrapToolResults: false,
      callTool: async () => ({ raw: true }),
    })({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo' },
    });
    assert.deepEqual(wrapped.result, { raw: true });
    const failing = await createMessageHandler({
      serverInfo: { name: 't', version: '1' },
      tools: [TOOL_DESCRIPTOR],
      callTool: async () => {
        throw new Error('tool failed');
      },
    })({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'echo' },
    });
    assert.equal(failing.error.code, -32_000);
  });

  await it('legacy gateway: unknown tools never reach the handler and are reported as denials', async () => {
    const denials = [];
    const logs = [];
    let invoked = 0;
    const gateway = createLegacyGateway({
      serverId: 'unit',
      tools: new Map([['echo', TOOL_DESCRIPTOR]]),
      invokeTool: async () => (invoked++, 'done'),
      recordDenial: (denial) => denials.push(denial),
      log: (line) => logs.push(line),
    });
    await assert.rejects(
      () => gateway('ghost', {}),
      (error) => error.code === TOOL_UNKNOWN_CODE,
    );
    await assert.rejects(
      () => gateway(42, {}),
      (error) => error.code === TOOL_UNKNOWN_CODE,
    );
    assert.equal(invoked, 0);
    assert.equal(await gateway('echo', {}), 'done');
    assert.deepEqual(
      denials.map((denial) => denial.code),
      [TOOL_UNKNOWN_CODE, TOOL_UNKNOWN_CODE],
    );
    assert.ok(logs.some((line) => line.includes('[unit:gateway:denied]')));
    assert.equal(denials[0].tool, 'ghost');
  });

  await it('legacy gateway: an out-of-scope refusal is recorded and rethrown; a failing recorder does not relax it', async () => {
    const denials = [];
    const logs = [];
    const scoped = Object.assign(new Error('Path escapes allowed directory'), { code: SCOPE_DENIED_CODE });
    const gateway = createLegacyGateway({
      serverId: 'unit',
      tools: new Map([['echo', TOOL_DESCRIPTOR]]),
      invokeTool: async (name, args) => {
        if (args.kind === 'scope') throw scoped;
        throw new Error('ordinary failure');
      },
      recordDenial: (denial) => {
        denials.push(denial);
        if (denials.length > 1) throw new Error('ledger down');
      },
      log: (line) => logs.push(line),
    });
    await assert.rejects(
      () => gateway('echo', { kind: 'scope' }),
      (error) => error === scoped,
    );
    await assert.rejects(() => gateway('echo', { kind: 'other' }), /ordinary failure/);
    assert.equal(denials.length, 1, 'ordinary failures are not denials');
    await assert.rejects(
      () => gateway('echo', { kind: 'scope' }),
      (error) => error === scoped,
    );
    assert.ok(logs.some((line) => line.includes('denial recorder failed')));
    assert.throws(() => createLegacyGateway({ serverId: 'x', tools: {}, invokeTool() {} }), TypeError);
    assert.throws(() => createLegacyGateway({ serverId: 'x', tools: new Map(), invokeTool: null }), TypeError);
    const defaultLogged = createLegacyGateway({ serverId: 'x', tools: new Map(), invokeTool() {}, log: () => {} });
    await assert.rejects(
      () => defaultLogged('a', {}),
      (error) => error.code === TOOL_UNKNOWN_CODE,
    );
  });

  await it('legacy server: every tool call goes through the gateway over HTTP and telemetry failures answer -32000', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-legacy-'));
    const denials = [];
    const logs = [];
    const tools = new Map([['echo', TOOL_DESCRIPTOR]]);
    let invoked = 0;
    const handle = startLegacyMcpServer({
      serverId: 'unit',
      serverName: 'hseos-unit',
      tools,
      invokeTool: async (name, args) => (invoked++, { echoed: args.text }),
      mode: 'http',
      port: 0,
      projectDirectory: dir,
      stateDatabasePath: path.join(dir, 'state.db'),
      telemetryPath: path.join(dir, 'telemetry.db'),
      recordDenial: (denial) => denials.push(denial),
      log: (line) => logs.push(line),
    });
    try {
      await new Promise((resolve) => (handle.server.listening ? resolve() : handle.server.once('listening', resolve)));
      const port = handle.server.address().port;
      const call = (id, name, args) =>
        rawPost(port, JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }));
      const ok = await call(1, 'echo', { text: 'hi' });
      assert.ok(ok.body.result, JSON.stringify(ok.body));
      const ghost = await call(2, 'ghost', {});
      assert.equal(ghost.body.error.code, -32_000);
      assert.equal(invoked, 1, 'the unknown tool must not reach the invoker');
      assert.equal(denials[0].code, TOOL_UNKNOWN_CODE);
      const init = await rawPost(
        port,
        JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { clientInfo: { name: 'unit-client' } } }),
      );
      assert.ok(init.body.result);
      handle.usage.close();
      const afterClose = await call(4, 'echo', { text: 'x' });
      assert.equal(afterClose.body.error.message, 'Legacy compatibility telemetry unavailable');
    } finally {
      await handle.close();
      await handle.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.ok(logs.some((line) => line.includes('legacy MCP compatibility listening')));
  });

  await it('legacy server: denials are durable in the telemetry store and a recorder failure never releases the call', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-durable-'));
    const logs = [];
    const scoped = Object.assign(new Error('Path escapes allowed directory'), { code: SCOPE_DENIED_CODE });
    let invoked = 0;
    const handle = startLegacyMcpServer({
      serverId: 'unit',
      serverName: 'hseos-unit',
      tools: new Map([[TOOL_DESCRIPTOR.name, TOOL_DESCRIPTOR]]),
      invokeTool: async (name, args) => {
        invoked++;
        if (args.text === 'escape') throw scoped;
        return { ok: true };
      },
      mode: 'http',
      port: 0,
      projectDirectory: dir,
      stateDatabasePath: path.join(dir, 'state.db'),
      telemetryPath: path.join(dir, 'telemetry.db'),
      log: (line) => logs.push(line),
    });
    try {
      await new Promise((resolve) => (handle.server.listening ? resolve() : handle.server.once('listening', resolve)));
      const port = handle.server.address().port;
      const call = (id, name, args) =>
        rawPost(port, JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }));
      const before = Date.now();
      assert.equal((await call(1, 'ghost_tool', {})).body.error.message, 'Unknown tool: ghost_tool');
      assert.equal((await call(2, 'echo', { text: 'escape' })).body.error.message, 'Path escapes allowed directory');
      assert.equal(invoked, 1, 'the unknown tool must not reach the invoker');
      const rows = handle.usage.listDenials();
      assert.deepEqual(
        rows.map(({ server_id, tool, code, rpc_code }) => ({ server_id, tool, code, rpc_code })),
        [
          { server_id: 'unit', tool: 'ghost_tool', code: 'MCP_TOOL_UNKNOWN', rpc_code: -32_000 },
          { server_id: 'unit', tool: 'echo', code: 'MCP_SCOPE_DENIED', rpc_code: -32_000 },
        ],
      );
      assert.ok(Date.parse(rows[0].occurred_at) >= before - 1000 && rows[0].occurred_at.endsWith('Z'));
      assert.throws(() => handle.usage.db.prepare('UPDATE mcp_gateway_denials SET tool = ?').run('x'), /append-only/);
      assert.throws(() => handle.usage.db.prepare('DELETE FROM mcp_gateway_denials').run(), /append-only/);
      handle.usage.recordDenial = () => {
        throw new Error('store is read-only');
      };
      const refused = await call(3, 'ghost_tool', {});
      assert.ok(refused.body.error, 'the call stays denied');
      assert.match(refused.body.error.message, /Unknown tool: ghost_tool \(denial not recorded\)/);
      assert.ok(!refused.body.error.message.includes('store is read-only'), 'the recorder failure text stays off the wire');
      const refusedScope = await call(4, 'echo', { text: 'escape' });
      assert.match(refusedScope.body.error.message, /denial not recorded/);
      assert.ok(!refusedScope.body.error.message.includes('store is read-only'));
      assert.equal(invoked, 2);
    } finally {
      await handle.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.ok(logs.some((line) => line.includes('denial recorder failed')));
  });

  await it('legacy telemetry target: path resolution and aliasing guards fail closed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-telemetry-'));
    try {
      assert.equal(resolveLegacyTelemetryPath({ projectDirectory: dir, telemetryPath: path.join(dir, 't.db') }), path.join(dir, 't.db'));
      assert.equal(
        resolveLegacyTelemetryPath({ projectDirectory: dir, stateDatabasePath: 'sub/state.db', telemetryPath: undefined }),
        path.join(dir, 'sub', 'mcp-legacy-usage.db'),
      );
      assert.equal(
        resolveLegacyTelemetryPath({ projectDirectory: dir, stateDatabasePath: undefined, telemetryPath: undefined }),
        path.join(dir, '.hseos', 'state', 'mcp-legacy-usage.db'),
      );
      assert.throws(() => resolveLegacyTelemetryPath({ projectDirectory: dir, telemetryPath: 'relative.db' }), TypeError);
      assert.throws(() => resolveLegacyTelemetryPath({ projectDirectory: dir, telemetryPath: '' }), TypeError);
      assert.throws(
        () => resolveLegacyTelemetryPath({ projectDirectory: dir, stateDatabasePath: '', telemetryPath: undefined }),
        TypeError,
      );

      const state = path.join(dir, 'state.db');
      const telemetry = path.join(dir, 'telemetry.db');
      assert.throws(() => assertLegacyTelemetryTarget(state, { projectDirectory: dir, stateDatabasePath: state }), /separate/);
      fs.writeFileSync(state, 'x');
      fs.symlinkSync(state, path.join(dir, 'state-link.db'));
      assert.throws(() => assertLegacyTelemetryTarget(telemetry, { projectDirectory: dir, stateDatabasePath: 'state-link.db' }), /symlink/);
      fs.writeFileSync(telemetry, 'x');
      assertLegacyTelemetryTarget(telemetry, { projectDirectory: dir, stateDatabasePath: state });
      fs.linkSync(telemetry, path.join(dir, 'telemetry-hard.db'));
      assert.throws(() => assertLegacyTelemetryTarget(telemetry, { projectDirectory: dir }), /regular, non-linked/);
      fs.unlinkSync(path.join(dir, 'telemetry-hard.db'));
      fs.unlinkSync(telemetry);
      fs.symlinkSync(state, telemetry);
      assert.throws(() => assertLegacyTelemetryTarget(telemetry, { projectDirectory: dir }), /regular, non-linked/);
      fs.unlinkSync(telemetry);
      fs.linkSync(state, telemetry);
      assert.throws(
        () => assertLegacyTelemetryTarget(telemetry, { projectDirectory: dir, stateDatabasePath: state }),
        /regular, non-linked|separate/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
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

  await runW504Tests();

  console.log(`\nMCP transport robustness tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-transport-robustness] fatal:', error.message);
  process.exit(1);
});
