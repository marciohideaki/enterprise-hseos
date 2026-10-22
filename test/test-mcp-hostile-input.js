'use strict';

/**
 * Hostile-input resilience of the MCP servers, stdio and HTTP.
 *
 * Any single message from a local client must be answered with a well-formed JSON-RPC response (or no response for a
 * notification) and must leave the server able to answer the next request. Never a dead process, never a stack trace
 * on the wire. The legacy transport is the control: the modern adapter may not be more fragile than it.
 *
 *  F1  - a bare `null` line on stdio killed the modern server (TypeError in the line loop)
 *  F1b - a `null` body over HTTP killed the modern server (correlation id read on null)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');

const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  createMcp2026HttpServer,
  JSON_RPC,
  Mcp2026Adapter,
  PROTOCOL_VERSION_META_KEY,
  startMcp2026Stdio,
} = require('../tools/lib/mcp-2026-adapter');
const { MCP_MODERN_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');
const { createHttpServer, createMessageHandler } = require('../tools/lib/mcp-transport');

const ADAPTER_PATH = path.join(__dirname, '..', 'tools', 'lib', 'mcp-2026-adapter.js');
const LEGACY_SERVER = path.join(__dirname, '..', 'tools', 'mcp-hseos-swarm', 'index.js');

const TOOLS = [
  {
    name: 'alpha.read',
    description: 'Read a stable value',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function modernMeta() {
  return {
    [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
    [CLIENT_INFO_META_KEY]: { name: 'fixture-client', version: '1.0.0' },
    [CLIENT_CAPABILITIES_META_KEY]: {},
  };
}

const PROBE_ID = 'probe';
const MODERN_PROBE = { jsonrpc: '2.0', id: PROBE_ID, method: 'tools/list', params: { _meta: modernMeta() } };
const LEGACY_PROBE = { jsonrpc: '2.0', id: PROBE_ID, method: 'tools/list' };

function newAdapter(overrides = {}) {
  return new Mcp2026Adapter({
    serverInfo: { name: 'hseos-fixture', version: '2.0.0' },
    tools: TOOLS,
    execute: async () => ({ ok: true, data: { result: {} } }),
    resolveActor: async () => ({ id: 'actor-1', type: 'human' }),
    resolveResourceScope: async () => ({ project: 'fixture' }),
    ...overrides,
  });
}

// Raw wire lines (already serialised, so `null`, `1` and truncated JSON can be sent verbatim).
const HOSTILE_LINES = [
  ['null', 'null'],
  ['[null]', '[null]'],
  ['empty array', '[]'],
  ['number', '1'],
  ['string', '"x"'],
  ['boolean', 'true'],
  ['empty object', '{}'],
  ['no jsonrpc', '{"id":1,"method":"tools/list"}'],
  ['batch with null', '[{"jsonrpc":"2.0","id":1,"method":"tools/list"},null]'],
  ['null id', '{"jsonrpc":"2.0","id":null,"method":"tools/list"}'],
  ['object id', '{"jsonrpc":"2.0","id":{},"method":"tools/list"}'],
  ['numeric method', '{"jsonrpc":"2.0","id":1,"method":42}'],
  ['null method', '{"jsonrpc":"2.0","id":1,"method":null}'],
  ['null params', '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":null}'],
  ['array params', '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":[]}'],
  ['string params', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":"x"}'],
  ['null _meta', '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":null}}'],
  ['null arguments and name', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":null,"arguments":null}}'],
  ['null arguments', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"alpha.read","arguments":null}}'],
  ['null cancellation', '{"jsonrpc":"2.0","method":"notifications/cancelled","params":null}'],
  ['truncated JSON', '{"jsonrpc":"2.0","id":1,'],
  ['invalid JSON', 'not json'],
  ['2 MiB line', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', pad: 'x'.repeat(2 * 1024 * 1024) })],
  ['depth 100000', `${'['.repeat(100_000)}${']'.repeat(100_000)}`],
];

function assertWellFormedResponse(response, label) {
  assert.equal(response.jsonrpc, '2.0', `${label}: jsonrpc`);
  assert.ok(Object.hasOwn(response, 'id'), `${label}: id`);
  assert.ok(Object.hasOwn(response, 'result') !== Object.hasOwn(response, 'error'), `${label}: exactly one of result/error`);
  if (response.error) {
    assert.equal(typeof response.error.code, 'number', `${label}: error code`);
    assert.equal(typeof response.error.message, 'string', `${label}: error message`);
  }
  assert.ok(!/\n\s+at\s|node_modules|TypeError|ReferenceError/.test(JSON.stringify(response)), `${label}: no stack or internal detail`);
}

function waitUntil(condition, label, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (condition()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
      return setTimeout(tick, 5);
    };
    tick();
  });
}

function silenceStderr(t) {
  const original = process.stderr.write;
  const captured = [];
  process.stderr.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  t.after(() => {
    process.stderr.write = original;
  });
  return captured;
}

// ---------------------------------------------------------------------------
// stdio, in process
// ---------------------------------------------------------------------------
function openStdio(instance) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding('utf8');
  const lines = [];
  let pending = '';
  output.on('data', (chunk) => {
    pending += chunk;
    let index = pending.indexOf('\n');
    while (index !== -1) {
      lines.push(JSON.parse(pending.slice(0, index)));
      pending = pending.slice(index + 1);
      index = pending.indexOf('\n');
    }
  });
  const rl = startMcp2026Stdio(instance, { input, output });
  return {
    // Sends one hostile line plus a probe; resolves with the responses that preceded the probe answer.
    async exchange(raw, probe) {
      lines.length = 0;
      input.write(`${raw}\n`);
      input.write(`${JSON.stringify(probe)}\n`);
      await waitUntil(() => lines.some((line) => line.id === PROBE_ID), 'the probe answer');
      await new Promise((resolve) => setTimeout(resolve, 20));
      const probeAnswer = lines.find((line) => line.id === PROBE_ID);
      return { probeAnswer, others: lines.filter((line) => line.id !== PROBE_ID) };
    },
    close() {
      rl.close();
      input.end();
    },
  };
}

test('modern stdio: every hostile line gets a well-formed answer and the server keeps serving', async () => {
  const session = openStdio(newAdapter());
  try {
    for (const [label, raw] of HOSTILE_LINES) {
      const { probeAnswer, others } = await session.exchange(raw, MODERN_PROBE);
      assert.ok(probeAnswer.result, `${label}: probe answered after the hostile line`);
      for (const response of others) assertWellFormedResponse(response, label);
    }
  } finally {
    session.close();
  }
});

test('modern stdio: pathological nesting is refused as an invalid request, not as an internal error', async () => {
  const session = openStdio(newAdapter());
  try {
    const { others } = await session.exchange(`${'['.repeat(100_000)}${']'.repeat(100_000)}`, MODERN_PROBE);
    assert.equal(others.length, 1);
    assert.equal(others[0].error.code, JSON_RPC.INVALID_REQUEST);
  } finally {
    session.close();
  }
});

test('F1: a bare null line on modern stdio gets -32600 with a null id', async () => {
  const session = openStdio(newAdapter());
  try {
    const { probeAnswer, others } = await session.exchange('null', MODERN_PROBE);
    assert.equal(others.length, 1);
    assert.equal(others[0].id, null);
    assert.equal(others[0].error.code, JSON_RPC.INVALID_REQUEST);
    assert.ok(probeAnswer.result);
  } finally {
    session.close();
  }
});

test('F1: the modern stdio process survives a null line (spawned)', async () => {
  const script = `
    const { Mcp2026Adapter, startMcp2026Stdio } = require(${JSON.stringify(ADAPTER_PATH)});
    const adapter = new Mcp2026Adapter({
      serverInfo: { name: 'hseos-fixture', version: '2.0.0' },
      tools: ${JSON.stringify(TOOLS)},
      execute: async () => ({}),
      resolveActor: async () => ({ id: 'actor-1', type: 'human' }),
      resolveResourceScope: async () => ({ project: 'fixture' }),
    });
    startMcp2026Stdio(adapter);
  `;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let exitCode;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('exit', (code) => {
    exitCode = code === null ? 'signal' : code;
  });
  try {
    child.stdin.write(`null\n${JSON.stringify(MODERN_PROBE)}\n`);
    await waitUntil(() => stdout.includes(`"${PROBE_ID}"`) || exitCode !== undefined, 'the probe answer or an exit');
    assert.equal(exitCode, undefined, `process must stay alive; stderr: ${stderr}`);
    assert.ok(stdout.includes('"result"'), 'probe answered');
    child.stdin.end();
    await waitUntil(() => exitCode !== undefined, 'a clean exit after stdin ends');
    assert.equal(exitCode, 0, stderr);
  } finally {
    child.kill('SIGKILL');
  }
});

test('last resort on modern stdio: an unexpected throw becomes -32603 without detail and the loop survives', async (t) => {
  const stderr = silenceStderr(t);
  const instance = newAdapter();
  const original = instance.handle.bind(instance);
  let armed = true;
  instance.handle = async (message, context) => {
    if (armed && message && message.id === 'boom') {
      armed = false;
      throw new TypeError('SECRET-INTERNAL-DETAIL');
    }
    return original(message, context);
  };
  const session = openStdio(instance);
  try {
    const { probeAnswer, others } = await session.exchange(
      JSON.stringify({ jsonrpc: '2.0', id: 'boom', method: 'tools/list', params: { _meta: modernMeta() } }),
      MODERN_PROBE,
    );
    assert.equal(others.length, 1);
    assert.equal(others[0].error.code, JSON_RPC.INTERNAL_ERROR);
    assert.ok(!JSON.stringify(others[0]).includes('SECRET-INTERNAL-DETAIL'));
    assert.ok(probeAnswer.result);
    assert.ok(stderr.join('').includes('SECRET-INTERNAL-DETAIL'), 'the operator sees the cause on stderr');
  } finally {
    session.close();
  }
});

test('adapter.handle: a non-adapter failure is reported as -32603 for the request id, with no stack', async () => {
  const instance = newAdapter();
  instance._modern = async () => {
    throw new TypeError('port refused the envelope');
  };
  const response = await instance.handle(
    { ...MODERN_PROBE, id: 7 },
    { transport: 'stdio', connection: instance.createConnectionContext() },
  );
  assert.equal(response.id, 7);
  assert.equal(response.error.code, JSON_RPC.INTERNAL_ERROR);
  assertWellFormedResponse(response, 'handle');
});

// ---------------------------------------------------------------------------
// HTTP, in process
// ---------------------------------------------------------------------------
function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function postRaw(port, body, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/mcp', headers: { 'Content-Type': 'application/json', ...headers } },
      (response) => {
        let payload = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (payload += chunk));
        response.on('end', () => {
          let parsed = null;
          if (payload) {
            try {
              parsed = JSON.parse(payload);
            } catch {
              parsed = { unparseable: payload };
            }
          }
          resolve({ status: response.statusCode, body: parsed });
        });
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

const MODERN_HTTP_HEADERS = { 'MCP-Protocol-Version': MCP_MODERN_PROTOCOL_VERSION, 'Mcp-Method': 'tools/list' };

async function hostileOverHttp(port, probeHeaders, probeBody, rawHeaders = {}) {
  for (const [label, raw] of HOSTILE_LINES) {
    const answer = await postRaw(port, raw, rawHeaders);
    if (answer.body !== null) assertWellFormedResponse(answer.body, `${label} (HTTP ${answer.status})`);
    const probe = await postRaw(port, probeBody, probeHeaders);
    assert.equal(probe.status, 200, `${label}: probe status`);
    assert.ok(probe.body.result, `${label}: probe answered after the hostile body`);
  }
}

test('modern HTTP: every hostile body gets a well-formed answer and the server keeps serving', async (t) => {
  const server = createMcp2026HttpServer(newAdapter());
  const port = await listen(server);
  t.after(() => server.close());
  await hostileOverHttp(port, MODERN_HTTP_HEADERS, JSON.stringify(MODERN_PROBE));
});

test('F1b: a null body over modern HTTP gets -32600 and the server keeps serving', async (t) => {
  const server = createMcp2026HttpServer(newAdapter());
  const port = await listen(server);
  t.after(() => server.close());
  const answer = await postRaw(port, 'null', {});
  assert.equal(answer.status, 200);
  assert.equal(answer.body.id, null);
  assert.equal(answer.body.error.code, JSON_RPC.INVALID_REQUEST);
  const probe = await postRaw(port, JSON.stringify(MODERN_PROBE), MODERN_HTTP_HEADERS);
  assert.ok(probe.body.result);
});

test('last resort on modern HTTP: an unexpected throw becomes 500 / -32603 without detail and the server keeps serving', async (t) => {
  const stderr = silenceStderr(t);
  const instance = newAdapter();
  const original = instance.handle.bind(instance);
  let armed = true;
  instance.handle = async (message, context) => {
    if (armed && message && message.id === 'boom') {
      armed = false;
      throw new TypeError('SECRET-INTERNAL-DETAIL');
    }
    return original(message, context);
  };
  const server = createMcp2026HttpServer(instance);
  const port = await listen(server);
  t.after(() => server.close());
  const answer = await postRaw(
    port,
    JSON.stringify({ jsonrpc: '2.0', id: 'boom', method: 'tools/list', params: { _meta: modernMeta() } }),
    MODERN_HTTP_HEADERS,
  );
  assert.equal(answer.status, 500);
  assert.equal(answer.body.error.code, JSON_RPC.INTERNAL_ERROR);
  assert.ok(!JSON.stringify(answer.body).includes('SECRET-INTERNAL-DETAIL'));
  const probe = await postRaw(port, JSON.stringify(MODERN_PROBE), MODERN_HTTP_HEADERS);
  assert.ok(probe.body.result);
  assert.ok(stderr.join('').includes('SECRET-INTERNAL-DETAIL'));
});

// ---------------------------------------------------------------------------
// Legacy transport: the control. It must keep surviving the same inputs.
// ---------------------------------------------------------------------------
test('legacy HTTP: every hostile body gets a well-formed answer and the server keeps serving', async (t) => {
  const handler = createMessageHandler({
    serverInfo: { name: 'legacy-fixture', version: '1.0.0' },
    tools: TOOLS,
    callTool: async () => ({}),
  });
  const server = createHttpServer(handler, { status: 'ok' });
  const port = await listen(server);
  t.after(() => server.close());
  await hostileOverHttp(port, {}, JSON.stringify(LEGACY_PROBE));
});

test('legacy stdio: every hostile line gets a well-formed answer and the server keeps serving', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-mcp-hostile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, HSEOS_STATE_DB: path.join(directory, 'project.db'), NODE_ENV: 'production' };
  delete env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
  const child = spawn(process.execPath, [LEGACY_SERVER], { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  const lines = [];
  let pending = '';
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    let index = pending.indexOf('\n');
    while (index !== -1) {
      lines.push(JSON.parse(pending.slice(0, index)));
      pending = pending.slice(index + 1);
      index = pending.indexOf('\n');
    }
  });
  for (const [label, raw] of HOSTILE_LINES) {
    lines.length = 0;
    child.stdin.write(`${raw}\n${JSON.stringify(LEGACY_PROBE)}\n`);
    await waitUntil(() => lines.some((line) => line.id === PROBE_ID) || exited, `${label}: probe answer`);
    assert.equal(exited, false, `${label}: legacy server must stay alive`);
    for (const response of lines.filter((line) => line.id !== PROBE_ID)) assertWellFormedResponse(response, label);
  }
});
