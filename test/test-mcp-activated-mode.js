'use strict';

/**
 * W10/K4: the MCP entrypoints and the governed CLI choose their mode from the state database.
 * v4 -> legacy; activated (user_version 17 + every execution table + integrity ok) -> modern without the fixture gate;
 * anything in between -> refused, never a silent legacy fallback. The modern server also serves the legacy
 * `initialize` revisions in compat mode (ADR-0048 item 2.f) and the compat sunset is configurable (item 3).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const Database = require('better-sqlite3');

const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  HSEOS_IDEMPOTENCY_META_KEY,
  Mcp2026Adapter,
  LEGACY_SUNSET,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} = require('../tools/lib/mcp-2026-adapter');
const { MCP_MODERN_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');
const { LEGACY_COMPAT_PROTOCOL_VERSIONS } = require('../tools/lib/governed-execution/native-mcp-server');
const {
  activateExecutionLedger,
  assertOperationalSchemaBoundary,
  openOperationalStateDatabase,
  resolveGovernedExecutionMode,
} = require('../tools/mcp-project-state/lib/operational-state-db');
const { runGovernedCliAction } = require('../tools/cli/lib/governed-action');

const ROOT = path.join(__dirname, '..');
const LEGACY_WINDOW_CLOCK = path.join(__dirname, 'helpers', 'legacy-window-clock.cjs');
const NOW = () => Date.parse('2026-10-22T12:00:00.000Z');
const SERVERS = {
  governance: { script: 'mcp-hseos-governance', tools: 15, simpleTool: 'list_workflows', name: 'hseos-governance' },
  swarm: { script: 'mcp-hseos-swarm', tools: 5, simpleTool: 'list_runs', name: 'hseos-swarm' },
  project_state: { script: 'mcp-project-state', tools: 15, simpleTool: 'state_history', name: 'hseos-project-state' },
};

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-k4-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decisions = path.join(root, 'decisions');
  fs.mkdirSync(decisions);
  fs.writeFileSync(path.join(decisions, 'ADR-0048-criterion.md'), '# ADR-0048: criterion\n\n## Status\n\nAccepted — 2026-10-22\n');
  return { root, decisions, backups: path.join(root, 'backups'), databasePath: path.join(root, 'state', 'project.db') };
}

function makeV4(box) {
  openOperationalStateDatabase(box.databasePath).close();
  return box.databasePath;
}

async function makeActivated(box) {
  makeV4(box);
  await activateExecutionLedger(box.databasePath, {
    adr: 'ADR-0048',
    backupDir: box.backups,
    now: NOW,
    internal: { decisionsDirectory: box.decisions },
  });
  return box.databasePath;
}

function withRawDatabase(databasePath, mutate) {
  const db = new Database(databasePath);
  try {
    mutate(db);
  } finally {
    db.close();
  }
}

function childEnv(box, extra = {}) {
  const env = { ...process.env, HSEOS_STATE_DB: box.databasePath, ...extra };
  delete env.NODE_ENV;
  delete env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
  if (!('HSEOS_MCP_LEGACY_SUNSET' in extra)) delete env.HSEOS_MCP_LEGACY_SUNSET;
  return env;
}

/** Minimal line-delimited JSON-RPC stdio client around one server child. */
function startServer(box, key, { env = {}, nodeArgs = [] } = {}) {
  const spec = SERVERS[key];
  const child = spawn(process.execPath, [...nodeArgs, path.join(ROOT, 'tools', spec.script, 'index.js')], {
    cwd: box.root,
    env: childEnv(box, env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let buffer = '';
  const waiting = new Map();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const resolve = waiting.get(message.id);
      if (resolve) {
        waiting.delete(message.id);
        resolve(message);
      }
    }
  });
  const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  let nextId = 1;
  const client = {
    spec,
    exited,
    stderr: () => stderr,
    request(method, params) {
      const id = nextId++;
      const reply = new Promise((resolve, reject) => {
        waiting.set(id, resolve);
        setTimeout(() => reject(new Error(`timeout waiting for ${method}; stderr=${stderr}`)), 20_000).unref();
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return reply;
    },
    modern(method, params = {}) {
      return client.request(method, {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
          [CLIENT_INFO_META_KEY]: { name: 'k4-test', version: '1.0.0' },
          [CLIENT_CAPABILITIES_META_KEY]: {},
          [HSEOS_IDEMPOTENCY_META_KEY]: `k4-${nextId}`,
        },
      });
    },
    initialize(protocolVersion) {
      return client.request('initialize', {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'codex-mcp-client', version: '0.163.0' },
      });
    },
    async close() {
      child.stdin.end();
      child.kill('SIGTERM');
      await exited;
    },
  };
  return client;
}

async function withServer(t, box, key, options) {
  const client = startServer(box, key, options);
  t.after(() => client.close());
  return client;
}

async function expectBootFailure(t, box, key, pattern) {
  const client = startServer(box, key);
  t.after(() => client.close());
  const code = await Promise.race([client.exited, new Promise((resolve) => setTimeout(() => resolve('still-running'), 20_000))]);
  assert.notEqual(code, 'still-running', `server did not refuse; stderr=${client.stderr()}`);
  assert.notEqual(code, 0);
  assert.match(client.stderr(), pattern);
  assert.doesNotMatch(client.stderr(), /governed mode=/);
}

test('resolveGovernedExecutionMode: absent and v4 databases are legacy, an activated one is modern', async (t) => {
  const box = sandbox(t);
  assert.equal(resolveGovernedExecutionMode(box.databasePath).mode, 'legacy');
  makeV4(box);
  assert.deepEqual(resolveGovernedExecutionMode(box.databasePath), { mode: 'legacy', fixture: false, modern: false, user_version: 4 });
  await makeActivated(box);
  const activated = resolveGovernedExecutionMode(box.databasePath);
  assert.equal(activated.mode, 'modern');
  assert.equal(activated.user_version, 17);
});

test('resolveGovernedExecutionMode refuses every intermediate or inconsistent state', async (t) => {
  const cases = {
    'user_version 17 without execution tables': (db) => {
      db.pragma('user_version = 17');
    },
    'user_version 9 with every table': (db) => {
      db.pragma('user_version = 9');
    },
    'activated but one execution table missing': (db) => {
      db.exec('DROP TABLE execution_approval_uses');
    },
    'activated schema without the activation marker': (db) => {
      db.pragma('application_id = 0');
    },
    'newer unknown user_version': (db) => {
      db.pragma('user_version = 18');
    },
    'v4 version with execution tables': (db) => {
      db.pragma('user_version = 4');
    },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const box = sandbox(t);
    if (label.startsWith('user_version 17 without')) makeV4(box);
    else await makeActivated(box);
    withRawDatabase(box.databasePath, mutate);
    assert.throws(
      () => resolveGovernedExecutionMode(box.databasePath),
      (error) => error.code === 'EXECUTION_ACTIVATION_PENDING' && /inconsistent/.test(error.message),
      label,
    );
  }
});

test('resolveGovernedExecutionMode refuses a corrupt activated database (integrity_check)', async (t) => {
  const box = sandbox(t);
  await makeActivated(box);
  const bytes = fs.readFileSync(box.databasePath);
  // Corrupt a data page past the header, keeping the file readable enough to open.
  for (let offset = 8192; offset < bytes.length && offset < 8192 + 2048; offset += 1) bytes[offset] = 0xff;
  fs.writeFileSync(box.databasePath, bytes);
  assert.throws(
    () => resolveGovernedExecutionMode(box.databasePath),
    (error) => error.code === 'EXECUTION_ACTIVATION_PENDING',
  );
});

test('the fixture gate keeps its own path and takes precedence', (t) => {
  const box = sandbox(t);
  const previous = { env: process.env.NODE_ENV, fixture: process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE };
  t.after(() => {
    if (previous.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.env;
    if (previous.fixture === undefined) delete process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
    else process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = previous.fixture;
  });
  process.env.NODE_ENV = 'test';
  process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = '1';
  assert.deepEqual(resolveGovernedExecutionMode(box.databasePath), { mode: 'fixture', fixture: true, modern: true, user_version: null });
});

test('the legacy boundary still refuses an activated database and points to the modern release', async (t) => {
  const box = sandbox(t);
  await makeActivated(box);
  const db = new Database(box.databasePath);
  t.after(() => db.close());
  assert.throws(
    () => assertOperationalSchemaBoundary(db),
    (error) =>
      error.code === 'EXECUTION_ACTIVATION_PENDING' && /re-register the MCP server on the governed \(modern\) release/.test(error.message),
  );
  db.close();
  assert.throws(
    () => openOperationalStateDatabase(box.databasePath),
    (error) => error.code === 'EXECUTION_ACTIVATION_PENDING',
  );
});

test('openActivated does not reapply migrations and rejects a v4 database', async (t) => {
  const box = sandbox(t);
  makeV4(box);
  assert.throws(() => openOperationalStateDatabase(box.databasePath, { openActivated: true }), { code: 'EXECUTION_ACTIVATION_PENDING' });
  await activateExecutionLedger(box.databasePath, {
    adr: 'ADR-0048',
    backupDir: box.backups,
    now: NOW,
    internal: { decisionsDirectory: box.decisions },
  });
  const db = openOperationalStateDatabase(box.databasePath, { openActivated: true });
  assert.equal(db.pragma('user_version', { simple: true }), 17);
  db.close();
  assert.throws(
    () => openOperationalStateDatabase(box.databasePath, { openActivated: true, activatePendingFixture: true }),
    /mutually exclusive/,
  );
});

test('a v4 database keeps the legacy server (initialize 2024-11-05, no governed mode)', async (t) => {
  for (const key of ['governance', 'swarm', 'project_state']) {
    const box = sandbox(t);
    makeV4(box);
    const client = await withServer(t, box, key);
    const response = await client.initialize('2024-11-05');
    assert.equal(response.result.protocolVersion, '2024-11-05');
    assert.doesNotMatch(client.stderr(), /governed mode=/);
    await client.close();
  }
});

test('an activated database starts the modern server without the fixture gate (counts, discover, call)', async (t) => {
  for (const [key, spec] of Object.entries(SERVERS)) {
    const box = sandbox(t);
    await makeActivated(box);
    const client = await withServer(t, box, key);
    const discover = await client.modern('server/discover');
    assert.equal(discover.result._meta[SERVER_INFO_META_KEY].name, spec.name);
    const listed = await client.modern('tools/list');
    const names = listed.result.tools.map((tool) => tool.name);
    assert.equal(names.length, spec.tools, `${key} tool count`);
    assert.equal(names.includes('scheduler_sweep_orphans'), false, `${key}: scheduler_sweep_orphans stays internal`);
    assert.ok(names.includes(spec.simpleTool), `${key} lists ${spec.simpleTool}`);
    assert.match(client.stderr(), /governed mode=activated user_version=17/);
    const called = await client.modern('tools/call', {
      name: spec.simpleTool,
      arguments: {},
    });
    assert.ok(called.result, `${key} tools/call answered: ${JSON.stringify(called)}`);
    assert.equal(called.result.resultType, 'complete');
    await client.close();
  }
});

test('the axon bridge starts modern on an activated database and legacy on v4', async (t) => {
  const activated = sandbox(t);
  await makeActivated(activated);
  const spec = { script: 'mcp-axon-bridge', tools: 0, name: 'axon-bridge' };
  SERVERS.axon = spec;
  t.after(() => delete SERVERS.axon);
  const modern = await withServer(t, activated, 'axon');
  const listed = await modern.modern('tools/list');
  assert.ok(listed.result.tools.length > 0);
  assert.match(modern.stderr(), /governed mode=activated/);
  const legacyBox = sandbox(t);
  makeV4(legacyBox);
  const legacy = await withServer(t, legacyBox, 'axon');
  assert.equal((await legacy.initialize('2024-11-05')).result.protocolVersion, '2024-11-05');
  assert.doesNotMatch(legacy.stderr(), /governed mode=/);
});

test('every entrypoint refuses an inconsistent database, with no legacy fallback', async (t) => {
  SERVERS.axon = { script: 'mcp-axon-bridge' };
  t.after(() => delete SERVERS.axon);
  for (const key of ['governance', 'swarm', 'project_state', 'axon']) {
    const box = sandbox(t);
    makeV4(box);
    withRawDatabase(box.databasePath, (db) => db.pragma('user_version = 17'));
    await expectBootFailure(t, box, key, /inconsistent/);
  }
  const box = sandbox(t);
  makeV4(box);
  withRawDatabase(box.databasePath, (db) => db.pragma('user_version = 9'));
  await expectBootFailure(t, box, 'governance', /EXECUTION|inconsistent|user_version 9/);
});

test('compat: legacy initialize revisions are served as 2024-11-05 with a warning and a counter', async (t) => {
  assert.deepEqual([...LEGACY_COMPAT_PROTOCOL_VERSIONS], ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
  const box = sandbox(t);
  await makeActivated(box);
  const client = await withServer(t, box, 'governance');
  for (const revision of LEGACY_COMPAT_PROTOCOL_VERSIONS) {
    const response = await client.initialize(revision);
    assert.equal(response.result.protocolVersion, '2024-11-05', `negotiates down from ${revision}`);
    assert.match(response.result._meta.deprecation, /deprecated/);
  }
  const listed = await client.request('tools/list', {});
  assert.equal(listed.result.tools.length, 15);
  await client.close();
  const usage = new Database(path.join(path.dirname(box.databasePath), 'mcp-legacy-usage.db'), { readonly: true });
  t.after(() => usage.close());
  const total = usage.prepare('SELECT COALESCE(SUM(request_count), 0) AS total FROM mcp_legacy_usage_daily').get().total;
  assert.ok(total > 0, 'legacy usage counter incremented');
});

test('compat: an unknown protocol version is still refused with -32022', async (t) => {
  const box = sandbox(t);
  await makeActivated(box);
  const client = await withServer(t, box, 'governance');
  const response = await client.initialize('1999-01-01');
  assert.equal(response.error.code, -32_022);
});

test('compat: approval-required tools stay listed and answer MCP_LEGACY_APPROVAL_UNSUPPORTED on legacy tools/call', async () => {
  const instance = new Mcp2026Adapter({
    serverInfo: { name: 'approval-fixture', version: '1.0.0' },
    tools: [{ name: 'risky.run', description: 'needs approval', inputSchema: { type: 'object', additionalProperties: false } }],
    execute: async (request) => ({
      schema_version: 1,
      ok: false,
      data: null,
      error: { code: 'EXECUTION_APPROVAL_REQUIRED', message: 'approval required', operation_id: `op-${request.tool}`, retryable: false },
      evidence: [],
      warnings: [],
    }),
    resolveActor: async () => ({ id: 'actor', type: 'human' }),
    resolveResourceScope: async () => ({ project: 'fixture' }),
    legacyProtocolVersions: LEGACY_COMPAT_PROTOCOL_VERSIONS,
    legacySunset: null,
  });
  const connection = instance.createConnectionContext();
  const context = { transport: 'stdio', connection };
  const init = await instance.handle(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'codex' } } },
    context,
  );
  assert.equal(init.result.protocolVersion, '2024-11-05');
  const listed = await instance.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, context);
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    ['risky.run'],
  );
  const called = await instance.handle(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'risky.run', arguments: {} } },
    context,
  );
  assert.equal(called.result.structuredContent.error.code, 'MCP_LEGACY_APPROVAL_UNSUPPORTED');
});

function sunsetAdapter(options, now) {
  return new Mcp2026Adapter({
    serverInfo: { name: 'sunset-fixture', version: '1.0.0' },
    tools: [{ name: 'noop.run', description: 'noop', inputSchema: { type: 'object', additionalProperties: false } }],
    execute: async () => ({ schema_version: 1, ok: true, data: {}, error: null, evidence: [], warnings: [] }),
    resolveActor: async () => ({ id: 'actor', type: 'human' }),
    resolveResourceScope: async () => ({ project: 'fixture' }),
    clock: { now: () => new Date(now) },
    ...options,
  });
}

const legacyInit = (adapter) =>
  adapter.handle(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'c', version: '1' } } },
    { transport: 'stdio', connection: adapter.createConnectionContext() },
  );

test('sunset: default keeps 2026-11-30, null never expires, a configured date expires on that date', async () => {
  const after = '2027-03-01T00:00:00.000Z';
  assert.ok((await legacyInit(sunsetAdapter({}, '2026-11-29T00:00:00.000Z'))).result);
  assert.equal((await legacyInit(sunsetAdapter({}, '2026-11-30T00:00:00.000Z'))).error.code, -32_022);
  const never = await legacyInit(sunsetAdapter({ legacySunset: null }, after));
  assert.ok(never.result);
  assert.notEqual(never.result._meta.sunset, LEGACY_SUNSET);
  assert.doesNotMatch(never.result._meta.deprecation, /ends|removed by/);
  assert.equal((await legacyInit(sunsetAdapter({ legacySunset: '2027-01-01' }, after))).error.code, -32_022);
  assert.ok((await legacyInit(sunsetAdapter({ legacySunset: '2027-06-01' }, after))).result);
  assert.throws(() => sunsetAdapter({ legacySunset: 'not-a-date' }, after), /legacySunset/);
  assert.throws(() => sunsetAdapter({ legacyProtocolVersions: ['2025-06-18'] }, after), /legacyProtocolVersions/);
});

test('sunset wiring: an activated server has no expiry by default, HSEOS_MCP_LEGACY_SUNSET in the past refuses', async (t) => {
  const box = sandbox(t);
  await makeActivated(box);
  const postSunset = { HSEOS_TEST_LEGACY_CLOCK_BASE: '2027-03-01T00:00:00.000Z' };
  const nodeArgs = ['-r', LEGACY_WINDOW_CLOCK];
  const open = await withServer(t, box, 'governance', { env: postSunset, nodeArgs });
  assert.equal((await open.initialize('2025-06-18')).result.protocolVersion, '2024-11-05', 'no expiry without the variable');
  await open.close();
  const closed = await withServer(t, box, 'governance', { env: { ...postSunset, HSEOS_MCP_LEGACY_SUNSET: '2026-12-31' }, nodeArgs });
  assert.equal((await closed.initialize('2025-06-18')).error.code, -32_022);
  await closed.close();
  const future = await withServer(t, box, 'governance', { env: { ...postSunset, HSEOS_MCP_LEGACY_SUNSET: '2028-01-01' }, nodeArgs });
  assert.ok((await future.initialize('2024-11-05')).result);
});

test('sunset wiring: the fixture path keeps the built-in 2026-11-30 and ignores the variable', async (t) => {
  const box = sandbox(t);
  const env = {
    NODE_ENV: 'test',
    HSEOS_GOVERNED_EXECUTION_FIXTURE: '1',
    HSEOS_MCP_LEGACY_SUNSET: '2099-01-01',
    HSEOS_TEST_LEGACY_CLOCK_BASE: '2027-03-01T00:00:00.000Z',
    HSEOS_STATE_DB: path.join(box.root, 'fixture', 'project.db'),
  };
  const child = spawn(process.execPath, ['-r', LEGACY_WINDOW_CLOCK, path.join(ROOT, 'tools', 'mcp-hseos-governance', 'index.js')], {
    cwd: box.root,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  const reply = new Promise((resolve) => {
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('\n')) resolve(JSON.parse(buffer.split('\n')[0]));
    });
  });
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'c' } } })}\n`,
  );
  assert.equal((await reply).error.code, -32_022);
});

test('governed-action: v4 stays legacy, activated runs governed, inconsistent is refused', async (t) => {
  const run = async (box) => {
    const seen = [];
    const result = await runGovernedCliAction('state-list', async (...args) => seen.push(args.length), [{ directory: box.root }]);
    return { result, seen };
  };
  const previous = { env: process.env.NODE_ENV, fixture: process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE };
  t.after(() => {
    for (const [key, value] of [
      ['NODE_ENV', previous.env],
      ['HSEOS_GOVERNED_EXECUTION_FIXTURE', previous.fixture],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  delete process.env.NODE_ENV;
  delete process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE;

  const v4 = sandbox(t);
  v4.databasePath = path.join(v4.root, '.hseos', 'state', 'project.db');
  makeV4(v4);
  await run(v4);
  const legacyUsage = new Database(path.join(v4.root, '.hseos', 'state', 'mcp-legacy-usage.db'), { readonly: true });
  assert.ok(legacyUsage.prepare('SELECT COUNT(*) AS n FROM mcp_legacy_usage_daily').get().n > 0, 'CLI usage counted as legacy');
  legacyUsage.close();

  const activated = sandbox(t);
  activated.databasePath = path.join(activated.root, '.hseos', 'state', 'project.db');
  await makeActivated(activated);
  await run(activated);
  const db = new Database(activated.databasePath, { readonly: true });
  t.after(() => db.close());
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM execution_events').get().n > 0, 'CLI action recorded in the ledger');
  assert.equal(
    fs.existsSync(path.join(activated.root, '.hseos', 'state', 'mcp-legacy-usage.db')),
    false,
    'no legacy usage on the modern path',
  );

  const broken = sandbox(t);
  broken.databasePath = path.join(broken.root, '.hseos', 'state', 'project.db');
  makeV4(broken);
  withRawDatabase(broken.databasePath, (database) => database.pragma('user_version = 9'));
  await assert.rejects(run(broken), { code: 'EXECUTION_ACTIVATION_PENDING' });
});
