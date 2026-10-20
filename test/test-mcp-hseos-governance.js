'use strict';

/**
 * MCP round-trip smoke test for mcp-hseos-governance.
 * Spawns the server, verifies legacy and managed read-only tools, and calls each legacy tool.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { MCP_LEGACY_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');
const { freePort } = require('./helpers/free-port');

const REPO_ROOT = path.join(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'tools', 'mcp-hseos-governance', 'index.js');

// Legacy compatibility ends at the sunset by the wall clock; the spawned server starts inside the window.
const LEGACY_WINDOW_CLOCK = path.join(__dirname, 'helpers', 'legacy-window-clock.cjs');

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

function rpc(port, method, params = {}) {
  const normalizedParams =
    method === 'initialize'
      ? { protocolVersion: MCP_LEGACY_PROTOCOL_VERSION, clientInfo: { name: 'governance-test', version: '1.0.0' }, ...params }
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

// ---------------------------------------------------------------------------
// W5-04: governed boot guards, local approval flow, ledger-recorded gateway denials.
// ---------------------------------------------------------------------------
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  createDenialRecorder,
  createLocalApprovalFlow,
  startNativeMcpServer,
} = require('../tools/lib/governed-execution/native-mcp-server');
const { CAPABILITY_CONTRACT_STUBS, ENVIRONMENT_CONTRACTS } = require('../tools/lib/governed-execution/contract-registry');
const { createOperationalExecution, schemaContract } = require('../tools/lib/governed-execution/operational-runtime');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { createExecutionEventRegistry } = require('../tools/lib/governed-execution/event-registry');
const { deterministicOperationId } = require('../tools/lib/governed-execution/runtime');

// In-process counterpart of the legacy-window-clock preload: the adapter reads `new Date()`, so for the duration
// of `fn` a no-argument Date is placed inside the legacy window and then restored.
async function withLegacyWindowClock(fn) {
  const RealDate = Date;
  const base = RealDate.parse('2026-08-21T12:00:00.000Z');
  const started = performance.now();
  const pinnedNow = () => base + Math.round(performance.now() - started);
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) =>
      args.length === 0 ? Reflect.construct(target, [pinnedNow()], newTarget) : Reflect.construct(target, args, newTarget),
    get: (target, prop, receiver) => (prop === 'now' ? pinnedNow : Reflect.get(target, prop, receiver)),
  });
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

async function withEnv(patch, fn) {
  const saved = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runGovernedUnitTests() {
  const tools = new Map([['noop', { name: 'noop', description: 'd', inputSchema: { type: 'object' }, handler() {} }]]);
  await it('governed boot: unknown servers, missing activation, non-temporary and pre-existing databases fail closed', async () => {
    assert.throws(() => startNativeMcpServer({ serverId: 'nope', tools, invokeTool() {}, mode: 'http', port: 0 }), TypeError);
    await withEnv({ NODE_ENV: 'production', HSEOS_GOVERNED_EXECUTION_FIXTURE: undefined }, () => {
      assert.throws(
        () => startNativeMcpServer({ serverId: 'governance', tools, invokeTool() {}, mode: 'http', port: 0 }),
        (error) => error.code === 'EXECUTION_ACTIVATION_PENDING',
      );
    });
    await withEnv({ NODE_ENV: 'test', HSEOS_GOVERNED_EXECUTION_FIXTURE: '1' }, () => {
      assert.throws(
        () =>
          startNativeMcpServer({ serverId: 'governance', tools, invokeTool() {}, mode: 'http', port: 0, dbPath: '/nonexistent-root/x.db' }),
        /temporary database/,
      );
      const existing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-existing-')), 'project.db');
      fs.writeFileSync(existing, '');
      assert.throws(
        () => startNativeMcpServer({ serverId: 'governance', tools, invokeTool() {}, mode: 'http', port: 0, dbPath: existing }),
        /fresh database/,
      );
      fs.rmSync(path.dirname(existing), { recursive: true, force: true });
      const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-redirect-'));
      const elsewhere = fs.mkdtempSync(path.join('/dev/shm', 'hseos-w5-04-elsewhere-'));
      fs.symlinkSync(elsewhere, path.join(outsideRoot, 'link'));
      assert.throws(
        () =>
          startNativeMcpServer({
            serverId: 'governance',
            tools,
            invokeTool() {},
            mode: 'http',
            port: 0,
            dbPath: path.join(outsideRoot, 'link', 'p.db'),
          }),
        /outside the temporary root/,
      );
      fs.rmSync(outsideRoot, { recursive: true, force: true });
      fs.rmSync(elsewhere, { recursive: true, force: true });
    });
  });

  await it('governed in-process server: stdio-less HTTP boot records an unknown-tool denial and closes cleanly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-inproc-'));
    const databasePath = path.join(dir, 'project.db');
    const logs = [];
    await withLegacyWindowClock(() =>
      withEnv({ NODE_ENV: 'test', HSEOS_GOVERNED_EXECUTION_FIXTURE: '1' }, async () => {
        const handle = startNativeMcpServer({
          serverId: 'swarm',
          tools: new Map([['list_runs', { name: 'list_runs', description: 'd', inputSchema: { type: 'object' } }]]),
          invokeTool: async () => ({ runs: [] }),
          mode: 'http',
          port: 0,
          dbPath: databasePath,
          log: (line) => logs.push(line),
        });
        try {
          await new Promise((resolve) => (handle.server.listening ? resolve() : handle.server.once('listening', resolve)));
          const port = handle.server.address().port;
          await assert.rejects(() => rpc(port, 'tools/call', { name: 'ghost', arguments: {} }), /Unknown tool/);
          const rows = handle.db.prepare("SELECT payload_json FROM execution_events WHERE aggregate_type = 'mcp_gateway'").all();
          assert.equal(rows.length, 1);
          assert.equal(JSON.parse(rows[0].payload_json).error.code, 'MCP_TOOL_UNKNOWN');
        } finally {
          await handle.close();
          await handle.close();
        }
      }),
    );
    assert.ok(logs.some((line) => line.includes('governed MCP listening')));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await it('operational registry: the production registry carries the versioned environment.* and memory.* stubs', async () => {
    const db = new Database(':memory:');
    try {
      applyExecutionLedgerFixtureSchema(db);
      const execution = createOperationalExecution({
        db,
        serverId: 'swarm',
        tools: new Map([['list_runs', { name: 'list_runs', description: 'd', inputSchema: { type: 'object' } }]]),
        invokeTool: async () => ({}),
      });
      const names = new Set(execution.contracts.list().map((contract) => contract.name));
      for (const stub of [...ENVIRONMENT_CONTRACTS, ...CAPABILITY_CONTRACT_STUBS]) assert.ok(names.has(stub.name), `missing ${stub.name}`);
      assert.ok(names.has('list_runs'));
      assert.throws(
        () => execution.contracts.validateInput(execution.contracts.resolve('memory.write'), {}),
        (error) => error.code === 'ENV_CAPABILITY_NOT_IMPLEMENTED',
      );
    } finally {
      db.close();
    }
  });

  await it('operational runtime: rejects bad wiring, unclassified tools, and maps governance classes', async () => {
    const db = new Database(':memory:');
    try {
      applyExecutionLedgerFixtureSchema(db);
      const tool = (name) => ({ name, description: 'd', inputSchema: { type: 'object', properties: { a: { type: 'string' } } } });
      const base = { db, serverId: 'swarm', tools: new Map([['list_runs', tool('list_runs')]]), invokeTool: async () => ({}) };
      assert.throws(() => createOperationalExecution({ ...base, db: {} }), TypeError);
      assert.throws(() => createOperationalExecution({ ...base, tools: new Map() }), TypeError);
      assert.throws(() => createOperationalExecution({ ...base, tools: [] }), TypeError);
      assert.throws(() => createOperationalExecution({ ...base, invokeTool: null }), TypeError);
      assert.throws(
        () => createOperationalExecution({ ...base, tools: new Map([['mystery', tool('mystery')]]) }),
        /Explicit execution governance is required for swarm:mystery/,
      );
      const governed = createOperationalExecution({
        ...base,
        tools: new Map([
          ['plan_squad', tool('plan_squad')],
          ['list_runs', tool('list_runs')],
          ['mystery', tool('mystery')],
        ]),
        toolGovernance: {
          mystery: { reversibility: 'idempotent_mutation', requires_approval: true, exclusive: true, provider_accepts_idempotency: true },
        },
      });
      const plan = governed.contracts.resolve('plan_squad');
      assert.equal(plan.reversibility, 'compensatable_mutation');
      assert.equal(plan.cancellation_policy, 'non_cancellable');
      assert.equal(plan.exclusive, true);
      const read = governed.contracts.resolve('list_runs');
      assert.equal(read.reversibility, 'read_only');
      assert.equal(read.cancellation_policy, 'cooperative');
      const mystery = governed.contracts.resolve('mystery');
      assert.ok(mystery.requires_approval && mystery.exclusive && mystery.provider_accepts_idempotency);
      assert.equal(mystery.authority, 'mcp.swarm.mutate');
      const projectState = createOperationalExecution({
        ...base,
        serverId: 'project_state',
        tools: new Map([['tasks_add', tool('tasks_add')]]),
      });
      assert.equal(projectState.contracts.resolve('tasks_add').provider_accepts_idempotency, true);

      // Input schemas are enforced and provider output must be strict JSON.
      assert.throws(
        () => read.input_schema.safeParse && governed.contracts.validateInput(read, { a: 5 }),
        (error) => error.code === 'EXECUTION_INPUT_INVALID',
      );
      assert.deepEqual(governed.contracts.validateInput(read, { a: 'x' }), { a: 'x' });
      const cyclic = {};
      cyclic.self = cyclic;
      const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
      const decorated = Object.assign([1], { extra: true });
      const accessor = Object.defineProperty({}, 'x', { enumerable: true, get: () => 1 });
      const symbolic = { [Symbol('s')]: 1 };
      const instance = new (class Custom {})();
      for (const value of [Number.NaN, -0, undefined, () => 1, cyclic, sparse, decorated, accessor, symbolic, instance]) {
        assert.throws(
          () => governed.contracts.validateOutput(read, value),
          (error) => error.code === 'EXECUTION_OUTPUT_INVALID',
          String(value),
        );
      }
      const nested = { list: [1, 'two', { three: null, four: true }] };
      assert.deepEqual(governed.contracts.validateOutput(read, nested), nested);
      assert.equal(typeof schemaContract(undefined, 'x').safeParse, 'function');
    } finally {
      db.close();
    }
  });

  await it('governed denial recorder: a ledger failure is logged and never thrown to the caller', async () => {
    const logs = [];
    const recorder = createDenialRecorder({
      ledger: {
        append() {
          throw new Error('ledger down');
        },
      },
      eventRegistry: createExecutionEventRegistry(),
      serverId: 'unit',
      actor: { id: 'local:uid:1', type: 'local_process' },
      log: (line) => logs.push(line),
    });
    recorder({ tool: 'ghost', code: 'MCP_TOOL_UNKNOWN', rpc_code: -32_602 });
    recorder({ tool: 'ghost', code: 'NOT_A_DENIAL_CODE' });
    assert.equal(logs.length, 2);
    assert.ok(logs[0].includes('denial not recorded in the ledger'));
  });

  await it('governed approval flow: explicit approval issues a bound, expiring, single-purpose approval', async () => {
    const issued = [];
    const flow = createLocalApprovalFlow({
      execution: { approvalStore: { issue: (approval) => issued.push(approval) } },
      serverId: 'unit',
    });
    const operationId = deterministicOperationId('some_tool', 'key-1');
    const begin = await flow.begin({ outcome: { error: { operation_id: operationId } } });
    assert.equal(begin.state.operation_id, operationId);
    assert.equal(begin.inputRequests.confirm.method, 'elicitation/create');
    const executionRequest = { tool: 'some_tool', idempotency_key: 'key-1', resource_scope: { project: '/p' } };
    const verifiedState = { operation_id: operationId, policy_version: 'hseos-operational-v1' };
    for (const inputResponses of [
      undefined,
      { confirm: { action: 'decline' } },
      { confirm: { action: 'accept', content: { approved: false } } },
    ]) {
      await assert.rejects(
        () => flow.resolve({ inputResponses, verifiedState, executionRequest }),
        (error) => error.code === 'EXECUTION_APPROVAL_DENIED',
      );
    }
    await assert.rejects(
      () =>
        flow.resolve({
          inputResponses: { confirm: { action: 'accept', content: { approved: true } } },
          verifiedState: { ...verifiedState, operation_id: 'other' },
          executionRequest,
        }),
      /binding mismatch/,
    );
    assert.equal(issued.length, 0, 'no approval is issued on denial or mismatch');
    const approved = await flow.resolve({
      inputResponses: { confirm: { action: 'accept', content: { approved: true } } },
      verifiedState,
      executionRequest,
    });
    assert.equal(issued.length, 1);
    assert.equal(issued[0].operation_id, operationId);
    assert.equal(issued[0].decision, 'approved');
    assert.equal(approved.approval_id, issued[0].approval_id);
    assert.ok(Date.parse(issued[0].expires_at) - Date.parse(issued[0].issued_at) === 300_000);
  });
}

(async () => {
  console.log('mcp-hseos-governance smoke test');

  const port = await freePort();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-governance-state-'));
  const child = spawn(process.execPath, ['-r', LEGACY_WINDOW_CLOCK, SERVER, `--port=${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HSEOS_GOVERNED_EXECUTION_FIXTURE: '1',
      HSEOS_STATE_DB: path.join(stateDir, 'project.db'),
      NODE_ENV: 'test',
    },
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

    await it('tools/list preserves 5 legacy tools and adds 10 managed read-only tools', async () => {
      const r = await rpc(port, 'tools/list', {});
      const names = new Set(r.tools.map((t) => t.name));
      const expected = ['query_constitution', 'validate_adr', 'check_authority', 'list_skills', 'list_workflows'];
      for (const name of expected) {
        if (!names.has(name)) throw new Error(`missing tool: ${name}`);
      }
      const managed = [
        'get_effective_governance_context',
        'evaluate_governed_action',
        'explain_governance_decision',
        'get_governance_artifact',
        'get_governance_release',
        'diff_governance_releases',
        'verify_governance_snapshot',
        'get_governance_session_status',
        'get_governance_session_preflight',
        'get_governance_readiness',
      ];
      for (const name of managed) if (!names.has(name)) throw new Error(`missing managed tool: ${name}`);
      if (r.tools.length !== 15) throw new Error(`expected 15 tools, got ${r.tools.length}`);
    });

    await it('initialize handshake', async () => {
      const r = await rpc(port, 'initialize', {});
      if (r.serverInfo?.name !== 'hseos-governance') throw new Error(`unexpected serverInfo: ${JSON.stringify(r.serverInfo)}`);
    });

    await it('query_constitution (no article = all)', async () => {
      const r = await rpc(port, 'tools/call', { name: 'query_constitution', arguments: {} });
      const result = toolData(r);
      if (!result.article) throw new Error('missing article field');
    });

    await it('validate_adr architectural = required', async () => {
      const r = await rpc(port, 'tools/call', { name: 'validate_adr', arguments: { change_kind: 'architectural' } });
      const result = toolData(r);
      if (result.required !== true) throw new Error(`expected required:true, got ${result.required}`);
    });

    await it('validate_adr documentation = not required', async () => {
      const r = await rpc(port, 'tools/call', { name: 'validate_adr', arguments: { change_kind: 'documentation' } });
      const result = toolData(r);
      if (result.required !== false) throw new Error(`expected required:false, got ${result.required}`);
    });

    await it('check_authority ghost', async () => {
      const r = await rpc(port, 'tools/call', { name: 'check_authority', arguments: { agent_code: 'ghost' } });
      const result = toolData(r);
      if (result.agent_code === undefined) throw new Error('missing agent_code');
    });

    await it('list_skills returns array', async () => {
      const r = await rpc(port, 'tools/call', { name: 'list_skills', arguments: {} });
      const result = toolData(r);
      if (!Array.isArray(result.skills)) throw new Error('skills is not array');
    });

    await it('list_workflows returns array', async () => {
      const r = await rpc(port, 'tools/call', { name: 'list_workflows', arguments: {} });
      const result = toolData(r);
      if (!Array.isArray(result.workflows)) throw new Error('workflows is not array');
    });

    await it('an unknown tool is denied', async () => {
      let denied = null;
      try {
        await rpc(port, 'tools/call', { name: 'ghost_tool', arguments: {} });
      } catch (error) {
        denied = error;
      }
      if (!denied || !/Unknown tool/.test(denied.message)) throw new Error(`unknown tool was not denied: ${denied && denied.message}`);
    });
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await it('the unknown-tool denial is recorded in the ledger', async () => {
      const db = new Database(path.join(stateDir, 'project.db'), { readonly: true });
      try {
        const rows = db.prepare("SELECT payload_json FROM execution_events WHERE aggregate_type = 'mcp_gateway'").all();
        const codes = rows.map((row) => JSON.parse(row.payload_json).error.code);
        if (!codes.includes('MCP_TOOL_UNKNOWN')) throw new Error(`no denial in ledger: ${codes.join(',')}`);
      } finally {
        db.close();
      }
    });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  await runGovernedUnitTests();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-hseos-governance] fatal:', error.message);
  process.exit(1);
});
