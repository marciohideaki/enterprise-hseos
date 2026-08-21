'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  HSEOS_IDEMPOTENCY_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} = require('../tools/lib/mcp-2026-adapter');
const { MCP_MODERN_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');
const { createOperationalExecution } = require('../tools/lib/governed-execution/operational-runtime');
const { openOperationalStateDatabase } = require('../tools/mcp-project-state/lib/operational-state-db');
const { runStaleSweep } = require('../tools/mcp-project-state/lib/scheduler');
const { sweepOrphans } = require('../tools/mcp-project-state/lib/stale-detector');

const ROOT = path.join(__dirname, '..');
const SERVERS = Object.freeze([
  {
    id: 'governance',
    script: 'mcp-hseos-governance',
    tool: 'query_constitution',
    arguments: {},
  },
  {
    id: 'project_state',
    script: 'mcp-project-state',
    tool: 'runs_list',
    arguments: {},
  },
  { id: 'swarm', script: 'mcp-hseos-swarm', tool: 'list_runs', arguments: {} },
  { id: 'axon_bridge', script: 'mcp-axon-bridge', tool: 'get_overview', arguments: {} },
]);

test('production entrypoint preserves metered legacy compatibility without pending schema activation', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-activation-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'project.db');
  const port = 4800 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'mcp-hseos-governance', 'index.js'), `--port=${port}`], {
    cwd: directory,
    env: { ...process.env, HSEOS_STATE_DB: databasePath, NODE_ENV: 'production' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    await waitForHealth(port);
    const response = await rpc(port, 'query_constitution', {}, 'legacy-metered');
    assert.equal(response.error, undefined);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
  }
  assert.equal(fs.existsSync(databasePath), false, 'pending execution database must not be created');
  const usagePath = path.join(directory, '.hseos', 'state', 'mcp-legacy-usage.db');
  const usageDb = new Database(usagePath, { readonly: true });
  assert.ok(usageDb.prepare("SELECT SUM(request_count) AS count FROM mcp_legacy_usage_daily WHERE server_id = 'governance'").get().count >= 1);
  usageDb.close();
});

function rpc(port, tool, argumentsValue, idempotencyKey, { capabilities = {}, requestState, inputResponses } = {}) {
  const meta = {
    [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
    [CLIENT_INFO_META_KEY]: { name: 'black-box-wiring', version: '1.0.0' },
    [CLIENT_CAPABILITIES_META_KEY]: capabilities,
    [HSEOS_IDEMPOTENCY_META_KEY]: idempotencyKey,
  };
  const message = {
    jsonrpc: '2.0',
    id: idempotencyKey,
    method: 'tools/call',
    params: {
      name: tool,
      arguments: argumentsValue,
      ...(requestState ? { requestState, inputResponses } : {}),
      _meta: meta,
    },
  };
  const body = JSON.stringify(message);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'mcp-protocol-version': MCP_MODERN_PROTOCOL_VERSION,
          'mcp-method': 'tools/call',
          'mcp-name': tool,
        },
      },
      (response) => {
        let payload = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (payload += chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(payload));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

function health(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/health' }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode === 200));
    });
    request.on('error', () => resolve(false));
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await health(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not become healthy on ${port}`);
}

async function withServer(spec, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `hseos-wiring-${spec.id}-`));
  const databasePath = path.join(directory, 'project.db');
  const port = 4300 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', spec.script, 'index.js'), `--port=${port}`, `--db=${databasePath}`], {
    cwd: ROOT,
    env: {
      ...process.env,
      AXON_BIN: '/nonexistent-axon-binary',
      HSEOS_GOVERNED_EXECUTION_FIXTURE: '1',
      HSEOS_STATE_DB: databasePath,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    await waitForHealth(port);
    await callback({ databasePath, port });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('close', resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function lifecycle(databasePath) {
  const db = new Database(databasePath, { readonly: true });
  try {
    return db.prepare(`SELECT event_type FROM execution_events ORDER BY position`).all().map((row) => row.event_type);
  } finally {
    db.close();
  }
}

for (const spec of SERVERS) {
  test(`${spec.id} real HTTP entrypoint persists lifecycle before returning provider data`, async () => {
    await withServer(spec, async ({ databasePath, port }) => {
      const response = await rpc(port, spec.tool, spec.arguments, `black-box-${spec.id}`);
      assert.equal(response.error, undefined);
      assert.equal(response.result.structuredContent.ok, true);
      assert.deepEqual(lifecycle(databasePath), ['ExecutionAuthorized', 'ExecutionStarted', 'ExecutionSucceeded']);
      const db = new Database(databasePath, { readonly: true });
      assert.equal(db.pragma('user_version', { simple: true }), 7);
      const authorized = db.prepare("SELECT actor_json, payload_json FROM execution_events WHERE event_type = 'ExecutionAuthorized'").get();
      const actor = JSON.parse(authorized.actor_json);
      const payload = JSON.parse(authorized.payload_json);
      assert.equal(actor.type, 'local_process');
      assert.match(actor.id, /^local:/);
      assert.equal(payload.resource_scope.state_db, path.resolve(databasePath));
      db.close();
    });
  });
}

test('project-state provider cannot mutate when the pre-effect append fails', async () => {
  const spec = SERVERS.find((server) => server.id === 'project_state');
  await withServer(spec, async ({ databasePath, port }) => {
    const db = new Database(databasePath);
    db.exec(`
      CREATE TRIGGER reject_black_box_execution_start
      BEFORE INSERT ON execution_events WHEN NEW.event_type = 'ExecutionStarted'
      BEGIN SELECT RAISE(ABORT, 'injected black-box pre-effect failure'); END;
    `);
    db.close();
    const response = await rpc(
      port,
      'run_create',
      { id: 'must-not-exist', workflow_id: 'fixture', project: '/tmp/fixture' },
      'black-box-rejected-mutation',
    );
    assert.equal(response.result.structuredContent.ok, false);
    const verify = new Database(databasePath, { readonly: true });
    assert.equal(verify.prepare(`SELECT COUNT(*) AS count FROM as_runs WHERE id = 'must-not-exist'`).get().count, 0);
    assert.equal(verify.prepare(`SELECT COUNT(*) AS count FROM execution_events`).get().count, 0);
    verify.close();
  });
});

test('approval-required modern mutation completes through signed elicitation state', async () => {
  const spec = SERVERS.find((server) => server.id === 'project_state');
  await withServer(spec, async ({ databasePath, port }) => {
    const options = { capabilities: { elicitation: {} } };
    const pending = await rpc(port, 'state_write', { fields: { approved: 'yes' }, agent: 'fixture' }, 'approved-state-write', options);
    assert.equal(pending.error, undefined);
    assert.equal(pending.result.resultType, 'input_required');
    assert.equal(typeof pending.result.requestState, 'string');
    const completed = await rpc(port, 'state_write', { fields: { approved: 'yes' }, agent: 'fixture' }, 'approved-state-write', {
      ...options,
      requestState: pending.result.requestState,
      inputResponses: { confirm: { action: 'accept', content: { approved: true } } },
    });
    assert.equal(completed.error, undefined);
    assert.equal(completed.result.structuredContent.ok, true);
    const db = new Database(databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT value FROM state WHERE key = 'approved'").get().value, 'yes');
    assert.deepEqual(
      db.prepare('SELECT event_type FROM execution_events ORDER BY position').all().map(({ event_type: type }) => type),
      ['ExecutionAuthorized', 'ExecutionStarted', 'ExecutionSucceeded'],
    );
    db.close();
  });
});

test('automatic stale sweep mutates only through the governed scheduler lifecycle', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governed-sweep-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'project.db');
  const previousFixture = process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = '1';
  process.env.NODE_ENV = 'test';
  const db = openOperationalStateDatabase(databasePath, { activatePendingFixture: true });
  if (previousFixture === undefined) delete process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
  else process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = previousFixture;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  const tool = {
    name: 'scheduler_sweep_orphans',
    inputSchema: {
      type: 'object',
      properties: { stale_minutes: { type: 'integer' } },
      required: ['stale_minutes'],
    },
  };
  const execution = createOperationalExecution({
    db,
    serverId: 'project_state',
    tools: new Map([[tool.name, tool]]),
    invokeTool(_name, input) {
      return sweepOrphans(db, input.stale_minutes);
    },
  });
  db.prepare("INSERT INTO as_runs (id, workflow_id, project) VALUES ('sweep-run', 'fixture', ?)").run(directory);
  db.prepare("INSERT INTO as_tasks (id, run_id, wave, status) VALUES ('sweep-task', 'sweep-run', 1, 'IN_PROGRESS')").run();
  db.prepare(
    "INSERT INTO as_agent_runs (agent_name, task_id, run_id, last_heartbeat_at, status) VALUES ('worker', 'sweep-task', 'sweep-run', datetime('now', '-30 minutes'), 'running')",
  ).run();
  try {
    const result = await runStaleSweep(execution.scheduler, { dbPath: databasePath, project: directory, staleMinutes: 10 });
    assert.equal(result.swept, 1);
    assert.equal(db.prepare("SELECT status FROM as_agent_runs WHERE run_id = 'sweep-run'").get().status, 'orphaned');
    assert.deepEqual(
      db.prepare('SELECT event_type FROM execution_events ORDER BY position').all().map(({ event_type: type }) => type),
      ['ExecutionAuthorized', 'ExecutionStarted', 'ExecutionSucceeded'],
    );
  } finally {
    await execution.scheduler.close({ cancelQueued: true, cancelRunning: true });
    db.close();
  }
});

test('operational output validation rejects lossy provider values before success', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-strict-output-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const previousFixture = process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = '1';
  process.env.NODE_ENV = 'test';
  const db = openOperationalStateDatabase(path.join(directory, 'project.db'), { activatePendingFixture: true });
  if (previousFixture === undefined) delete process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE;
  else process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE = previousFixture;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  const execution = createOperationalExecution({
    db,
    serverId: 'fixture',
    tools: new Map([['invalid_output', { name: 'invalid_output', inputSchema: { type: 'object' } }]]),
    invokeTool() {
      return { missing: undefined, not_a_number: Number.NaN };
    },
  });
  try {
    const result = await execution.scheduler.execute({
      tool: 'invalid_output',
      input: {},
      actor: { id: 'fixture-user', type: 'human' },
      resource_scope: { project: directory },
      idempotency_key: 'strict-output-fixture',
    });
    assert.equal(result.ok, false);
    assert.deepEqual(
      db.prepare('SELECT event_type FROM execution_events ORDER BY position').all().map(({ event_type: type }) => type),
      ['ExecutionAuthorized', 'ExecutionStarted', 'ExecutionFailed'],
    );
  } finally {
    await execution.scheduler.close({ cancelQueued: true, cancelRunning: true });
    db.close();
  }
});
