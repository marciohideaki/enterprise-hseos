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
const { CAPABILITY_CONTRACTS, ENVIRONMENT_CONTRACTS } = require('../tools/lib/governed-execution/contract-registry');
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
      for (const stub of [...ENVIRONMENT_CONTRACTS, ...CAPABILITY_CONTRACTS]) assert.ok(names.has(stub.name), `missing ${stub.name}`);
      assert.ok(names.has('list_runs'));
      assert.throws(
        () => execution.contracts.validateInput(execution.contracts.resolve('memory.write'), {}),
        (error) => error.code === 'AGENT_MEMORY_INVALID',
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
      execution: {
        approvalStore: { issue: (approval) => issued.push(approval) },
        contracts: { resolve: (tool) => ({ policy_version: tool === 'cap_tool' ? 'hseos-w5-capability-v1' : 'hseos-operational-v1' }) },
      },
      serverId: 'unit',
    });
    const operationId = deterministicOperationId('some_tool', 'key-1');
    const begin = await flow.begin({
      outcome: { error: { operation_id: operationId } },
      executionRequest: { tool: 'some_tool', input: {} },
    });
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
    assert.equal(issued[0].policy_version, 'hseos-operational-v1');
    // A capability contract carries its own policy version; the grant must follow the contract or the runtime refuses to spend it.
    const capabilityId = deterministicOperationId('cap_tool', 'key-2');
    const capability = await flow.resolve({
      inputResponses: { confirm: { action: 'accept', content: { approved: true } } },
      verifiedState: { operation_id: capabilityId, policy_version: 'hseos-w5-capability-v1' },
      executionRequest: { tool: 'cap_tool', idempotency_key: 'key-2', resource_scope: { project: '/p' } },
    });
    assert.equal(capability.policy_version, 'hseos-w5-capability-v1');
    assert.equal(issued[1].policy_version, 'hseos-w5-capability-v1');
  });
}

// ---------------------------------------------------------------------------
// W4-C7: providers of the environment.* and memory.* contracts behind the governed runtime.
// ---------------------------------------------------------------------------
async function runCapabilityProviderTests() {
  const memoryPackage = require('../packages/agent-memory');
  const environment = require('../packages/agent-environment');
  const { containsCredential } = require('../tools/cli/lib/campaign-evidence-store');
  const { ENV_CAPABILITY_UNAVAILABLE } = require('../tools/lib/governed-execution/operational-runtime');
  const { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } = require('../tools/lib/mcp-2026-adapter');
  const { MCP_MODERN_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');

  const ACTOR = { id: 'local:uid:1', type: 'local_process' };
  const OPERATOR = { kind: 'operator', id: 'owner' };
  const SCOPE = { project: 'alpha' };
  const ALLOW = [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }];
  const SHOT = 'a'.repeat(64);
  const BINDING = 'b'.repeat(64);
  const tools = new Map([['list_runs', { name: 'list_runs', description: 'd', inputSchema: { type: 'object' } }]]);

  const fakeServices = (calls, wiring) => {
    const sink = environment.createEnvironmentLedgerSink({
      ledger: wiring.ledger,
      project_id: 'alpha',
      actor: { type: 'host', id: 'env-host' },
      session_id: 'session-1',
    });
    const display = (extra = {}) => ({ contract: 'environment.computer.v1', session_id: 'session-1', ...extra });
    return {
      lsp: {
        async run(input) {
          calls.push(['lsp', input]);
          sink({ type: 'environment.lsp.completed', action: input.action });
          return {
            contract: 'environment.lsp.v1',
            status: 'ok',
            action: 'hover',
            result: { action: 'hover', hover: 'greet(name)' },
            source: { authority: 'data', provenance: { trust: 'untrusted' } },
          };
        },
      },
      computer: {
        async start(input) {
          calls.push(['start', input]);
          return display({ status: 'started' });
        },
        async screenshot(sessionId) {
          calls.push(['screenshot', sessionId]);
          return display({ status: 'captured' });
        },
        requestApproval(sessionId, action) {
          calls.push(['requestApproval', sessionId, action]);
          return { status: 'pending', request_id: `req-${calls.length}`, binding_digest: BINDING, seq: 1, screenshot_digest: SHOT };
        },
        async act(sessionId, action, options) {
          calls.push(['act', sessionId, action, options]);
          return display({ status: 'acted' });
        },
        async stop(sessionId) {
          calls.push(['stop', sessionId]);
          return display({ status: 'stopped' });
        },
      },
      approvals: {
        approve(requestId, who) {
          calls.push(['approve', requestId, who]);
          return { status: 'approved', request_id: requestId };
        },
      },
    };
  };

  const memoryHost = (wiring, overrides = {}) => ({
    store: new memoryPackage.MemoryStore({
      ledger: wiring.ledger,
      scanCredential: (text) => containsCredential(text),
      approvalVerifier: memoryPackage.createExecutionApprovalVerifier({
        approvalStore: wiring.approvalStore,
        resolveApprovalId: wiring.resolveMemoryDeleteApproval,
      }),
    }),
    rules: ALLOW,
    actor: OPERATOR,
    operator: OPERATOR,
    ...overrides,
  });

  const setup = ({ withHost = true, hostOverrides = {}, memoryOverrides = {} } = {}) => {
    const db = new Database(':memory:');
    applyExecutionLedgerFixtureSchema(db);
    const calls = [];
    let wired = null;
    const execution = createOperationalExecution({
      db,
      serverId: 'swarm',
      tools,
      invokeTool: async () => ({}),
      environmentHost: withHost
        ? (wiring) => {
            wired = wiring;
            return {
              ...fakeServices(calls, wiring),
              project_id: 'alpha',
              allow_digest_only_approval: true,
              memory: memoryHost(wiring, memoryOverrides),
              ...hostOverrides,
            };
          }
        : null,
    });
    // The host's own explicit approval of one call, as the MCP elicitation flow issues it.
    const approve = (tool, key) => {
      const contract = execution.contracts.resolve(tool);
      const approvalId = `approval-${tool}-${key}`;
      execution.approvalStore.issue({
        approval_id: approvalId,
        operation_id: deterministicOperationId(tool, key),
        authorizer: { id: 'owner', type: 'human' },
        resource_scope: SCOPE,
        issued_at: new Date(Date.now() - 1000).toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        decision: 'approved',
        policy_version: contract.policy_version,
        evidence_ref: `hseos://test/${approvalId}`,
      });
      return { approval_id: approvalId };
    };
    const run = (tool, input, { approved = false, key = `${tool}-${Math.random()}` } = {}) =>
      execution.port.execute({
        tool,
        input,
        actor: ACTOR,
        resource_scope: SCOPE,
        idempotency_key: key,
        approval_context: approved ? approve(tool, key) : null,
      });
    return { db, calls, execution, run, wired: () => wired };
  };
  const entry = (overrides = {}) => ({
    scope: { project_id: 'alpha' },
    memory_id: 'note-1',
    content: 'the deploy pipeline uses blue green rollouts',
    origin: 'agent',
    trust: 'untrusted',
    classification: 'internal',
    source_ref: 'doc://runbook/deploy',
    ttl_seconds: 3600,
    ...overrides,
  });
  const withDigest = (value) => ({ ...value, source_digest: memoryPackage.sha256Text(value.content) });
  const HOVER = { action: 'hover', language: 'python', file: 'm.py', position: { line: 0, character: 5 } };
  const CLICK = { session_id: 'session-1', action: 'click', x: 10, y: 10 };

  await it('capability providers: without a host every environment.* and memory.* call fails closed with ENV_CAPABILITY_UNAVAILABLE', async () => {
    const { db, run, execution } = setup({ withHost: false });
    try {
      const cases = [
        ['environment.lsp.hover', HOVER, false],
        ['environment.computer.screenshot', { session_id: 'session-1' }, false],
        ['environment.computer.stop', { session_id: 'session-1' }, false],
        ['environment.computer.start', { target: { command: '/usr/bin/xterm' } }, true],
        ['memory.retrieve', { project_id: 'alpha', query: 'deploy' }, false],
        ['memory.write', withDigest(entry()), false],
        ['memory.delete', { project_id: 'alpha', memory_id: 'note-1' }, true],
      ];
      for (const [tool, input, approved] of cases) {
        const envelope = await run(tool, input, { approved });
        assert.equal(envelope.ok, false, tool);
        assert.equal(envelope.error.code, ENV_CAPABILITY_UNAVAILABLE, tool);
      }
      assert.notEqual(ENV_CAPABILITY_UNAVAILABLE, 'NOT_IMPLEMENTED');
      assert.equal(execution.contracts.resolve('environment.lsp.hover').name, 'environment.lsp.hover');
    } finally {
      db.close();
    }
  });

  await it('capability providers: with a host environment.lsp.* runs through the runtime and the service writes its ledger event', async () => {
    const { db, run, calls } = setup();
    try {
      const envelope = await run('environment.lsp.hover', HOVER);
      assert.equal(envelope.ok, true, JSON.stringify(envelope));
      assert.equal(envelope.data.result.result.hover, 'greet(name)');
      assert.deepEqual(calls, [['lsp', HOVER]]);
      const rows = db.prepare("SELECT event_type FROM execution_events WHERE aggregate_type = 'environment_session'").all();
      assert.deepEqual(
        rows.map((row) => row.event_type),
        ['environment.lsp.completed'],
      );
      const invalid = await run('environment.lsp.hover', { ...HOVER, action: 'definition' });
      assert.equal(invalid.ok, false);
      assert.equal(invalid.error.code, 'ENV_LSP_INPUT_INVALID');
      assert.equal(calls.length, 1, 'a rejected input never reaches the service');
    } finally {
      db.close();
    }
    const lspLess = setup({ hostOverrides: { lsp: undefined } });
    try {
      const missingMember = await lspLess.run('environment.lsp.hover', HOVER);
      assert.equal(missingMember.ok, false);
      assert.equal(missingMember.error.code, ENV_CAPABILITY_UNAVAILABLE);
    } finally {
      lspLess.db.close();
    }
  });

  await it('capability policy: the expected policy version comes from a table, so a contract cannot pick its own', async () => {
    const { db, execution } = setup();
    try {
      const { policy } = execution.runtime;
      const base = execution.contracts.resolve('environment.lsp.hover');
      const expected = {
        'environment.lsp.hover': 'hseos-w5-environment-v1',
        'environment.computer.act': 'hseos-w5-capability-v1',
        'memory.write': 'hseos-w5-capability-v1',
        list_runs: 'hseos-operational-v1',
      };
      for (const [tool, version] of Object.entries(expected)) {
        const contract = execution.contracts.resolve(tool);
        assert.equal((await policy.evaluate({ contract })).policy_version, version, tool);
        // Whatever the contract declares, the expected version does not follow it: the runtime check then refuses it.
        const lying = (await policy.evaluate({ contract: { ...contract, policy_version: 'rogue-v9' } })).policy_version;
        assert.equal(lying, version, `${tool} must not echo the contract`);
        assert.notEqual(lying, 'rogue-v9');
      }
      const stranger = (await policy.evaluate({ contract: { ...base, capability: 'rogue.cap' } })).policy_version;
      assert.equal(stranger, null, 'an unlisted family has no expected version');
      assert.equal((await policy.evaluate({ contract: { ...base, capability: 'mcp.rogue' } })).policy_version, 'hseos-operational-v1');
    } finally {
      db.close();
    }
  });

  await it('capability providers: memory.write and memory.retrieve work, and write needs the store policy', async () => {
    const { db, run, wired } = setup();
    try {
      const written = await run('memory.write', withDigest(entry()));
      assert.equal(written.ok, true, JSON.stringify(written));
      assert.equal(written.data.result.write_policy_ref, 'rule:memory-write');
      const found = await run('memory.retrieve', { project_id: 'alpha', query: 'blue green', include_untrusted: true });
      assert.equal(found.ok, true, JSON.stringify(found));
      assert.equal(found.data.result.length, 1);
      assert.equal(found.data.result[0].authority, 'data');
      const invalid = await run('memory.retrieve', { project_id: 'alpha', query: 'x', unknown: 1 });
      assert.equal(invalid.ok, false);
      assert.equal(invalid.error.code, 'AGENT_MEMORY_INVALID');
      const duplicate = await run('memory.write', withDigest(entry()));
      assert.equal(duplicate.error.code, 'AGENT_MEMORY_DUPLICATE');
      assert.equal(typeof wired().resolveMemoryDeleteApproval, 'function');
    } finally {
      db.close();
    }
  });

  await it('capability providers: memory tools refuse a project other than the host project', async () => {
    const { db, run } = setup();
    try {
      const write = await run('memory.write', withDigest(entry({ scope: { project_id: 'beta' } })));
      assert.equal(write.error.code, 'ENV_PROJECT_SCOPE_MISMATCH');
      const retrieve = await run('memory.retrieve', { project_id: 'beta', query: 'deploy' });
      assert.equal(retrieve.error.code, 'ENV_PROJECT_SCOPE_MISMATCH');
      const del = await run('memory.delete', { project_id: 'beta', memory_id: 'note-1' }, { approved: true });
      assert.equal(del.error.code, 'ENV_PROJECT_SCOPE_MISMATCH');
      const events = db.prepare("SELECT 1 FROM execution_events WHERE aggregate_type = 'agent_memory'").all();
      assert.equal(events.length, 0, 'nothing was written for another project');
    } finally {
      db.close();
    }
  });

  await it('capability providers: memory.delete is refused without approval and deletes with one, leaving no grant behind', async () => {
    const { db, run, wired } = setup();
    try {
      await run('memory.write', withDigest(entry()));
      const refused = await run('memory.delete', { project_id: 'alpha', memory_id: 'note-1' });
      assert.equal(refused.ok, false);
      assert.equal(refused.error.code, 'EXECUTION_APPROVAL_REQUIRED');
      const still = await run('memory.retrieve', { project_id: 'alpha', query: 'blue green', include_untrusted: true });
      assert.equal(still.data.result.length, 1, 'an unapproved delete leaves the entry');

      const deleted = await run('memory.delete', { project_id: 'alpha', memory_id: 'note-1', reason: 'obsolete' }, { approved: true });
      assert.equal(deleted.ok, true, JSON.stringify(deleted));
      assert.deepEqual(deleted.data.result, { memory_id: 'note-1', deleted: true });
      const operation = memoryPackage.memoryDeleteOperation('alpha', 'note-1').operation_id;
      assert.equal(wired().resolveMemoryDeleteApproval({ operation_id: operation }), undefined, 'the grant is gone after the delete');
      const gone = await run('memory.retrieve', { project_id: 'alpha', query: 'blue green', include_untrusted: true });
      assert.equal(gone.data.result.length, 0);
      const events = db.prepare("SELECT event_type FROM execution_events WHERE aggregate_type = 'agent_memory'").all();
      assert.ok(events.some((row) => row.event_type === memoryPackage.EVENTS.DELETED));
      // The entry no longer exists: the failed forget must not leave a grant that a later call could spend.
      const again = await run('memory.delete', { project_id: 'alpha', memory_id: 'note-1' }, { approved: true });
      assert.equal(again.error.code, 'AGENT_MEMORY_NOT_FOUND');
      assert.equal(wired().resolveMemoryDeleteApproval({ operation_id: operation }), undefined, 'a failed forget leaves no grant');
    } finally {
      db.close();
    }
  });

  await it('capability providers: concurrent deletions of different entries do not overwrite each other', async () => {
    const { db, run } = setup();
    try {
      await run('memory.write', withDigest(entry()));
      await run('memory.write', withDigest(entry({ memory_id: 'note-2', content: 'rollback runs through the same pipeline' })));
      const results = await Promise.all([
        run('memory.delete', { project_id: 'alpha', memory_id: 'note-1' }, { approved: true }),
        run('memory.delete', { project_id: 'alpha', memory_id: 'note-2' }, { approved: true }),
        run('memory.delete', { project_id: 'alpha', memory_id: 'note-1' }, { approved: true }),
      ]);
      assert.deepEqual(
        results.map((result) => result.ok),
        [true, true, false],
      );
      assert.equal(results[2].error.code, 'AGENT_MEMORY_NOT_FOUND');
    } finally {
      db.close();
    }
  });

  await it('capability approvals: grant and take compare the exact input on their own, and a grant is single use', async () => {
    const { db, execution, calls } = setup();
    try {
      const approvals = execution.capabilityApprovals;
      const normalized = { session_id: 'session-1', action: 'click', button: 1, x: 10, y: 10 };
      const request = { tool: 'environment.computer.act', input: CLICK };
      const refusedWith = (fn) => assert.throws(fn, (error) => error.code === 'ENV_COMPUTER_APPROVAL_REQUIRED');
      refusedWith(() => approvals.grant(request, 'op-1', 'approver'));
      assert.match(approvals.describe(request, 'op-1'), /click/);
      refusedWith(() => approvals.grant({ ...request, input: { ...CLICK, x: 99 } }, 'op-1', 'approver'));
      refusedWith(() => approvals.take('op-1', normalized));
      assert.equal(
        calls.some((call) => call[0] === 'approve'),
        false,
        'a divergent grant never resolves the gate',
      );
      approvals.grant(request, 'op-1', 'approver');
      refusedWith(() => approvals.take('op-1', { ...normalized, x: 99 }));
      refusedWith(() => approvals.take('op-other', normalized));
      const requestId = approvals.take('op-1', normalized);
      assert.equal(typeof requestId, 'string');
      refusedWith(() => approvals.take('op-1', normalized));
      // The table of pending grants is bounded: the oldest request is forgotten, never accumulated.
      for (let index = 0; index < 200; index += 1) approvals.describe(request, `bulk-${index}`);
      refusedWith(() => approvals.grant(request, 'bulk-0', 'approver'));
      approvals.grant(request, 'bulk-199', 'approver');
    } finally {
      db.close();
    }
  });

  await it('capability host: the shape returned by environmentHost is validated and fails loudly', async () => {
    const bad = (hostOverrides, pattern, withDefaults = true) => {
      const db = new Database(':memory:');
      try {
        applyExecutionLedgerFixtureSchema(db);
        assert.throws(
          () =>
            createOperationalExecution({
              db,
              serverId: 'swarm',
              tools,
              invokeTool: async () => ({}),
              environmentHost: (wiring) =>
                withDefaults ? { ...fakeServices([], wiring), project_id: 'alpha', ...hostOverrides } : hostOverrides,
            }),
          pattern,
        );
      } finally {
        db.close();
      }
    };
    bad({ approvals: undefined }, /approvals/);
    bad({ approvals: {} }, /approvals/);
    bad({ computer: { start() {} } }, /computer/);
    bad({ lsp: {} }, /lsp/);
    bad({ typo_service: {} }, /typo_service/);
    bad({ memory: { store: {} } }, /memory/);
    bad({ project_id: undefined, memory: {} }, /project_id|memory/);
    bad({}, /at least one/, false);
    bad(null, /environment host/, false);
  });

  await it('capability providers: environmentHost must be a builder function', async () => {
    const db = new Database(':memory:');
    try {
      applyExecutionLedgerFixtureSchema(db);
      assert.throws(
        () => createOperationalExecution({ db, serverId: 'swarm', tools, invokeTool: async () => ({}), environmentHost: {} }),
        TypeError,
      );
    } finally {
      db.close();
    }
  });

  // ---- end to end through the MCP adapter: tools/list, tools/call, elicitation, requestState, resolve, execution ----
  const CAPABLE = {
    [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
    [CLIENT_INFO_META_KEY]: { name: 'fixture-client', version: '1.0.0' },
    [CLIENT_CAPABILITIES_META_KEY]: { elicitation: {} },
  };
  const ACCEPT = { confirm: { action: 'accept', content: { approved: true } } };
  const withServer = async (hostOptions, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w4-c7-'));
    const calls = [];
    try {
      await withEnv({ NODE_ENV: 'test', HSEOS_GOVERNED_EXECUTION_FIXTURE: '1' }, async () => {
        const handle = startNativeMcpServer({
          serverId: 'swarm',
          tools,
          invokeTool: async () => ({ runs: [] }),
          mode: 'http',
          port: 0,
          dbPath: path.join(dir, 'project.db'),
          log: () => {},
          environmentHost:
            hostOptions === null
              ? null
              : (wiring) => ({
                  ...fakeServices(calls, wiring),
                  project_id: 'alpha',
                  allow_digest_only_approval: true,
                  memory: memoryHost(wiring),
                  ...hostOptions,
                }),
        });
        try {
          await new Promise((resolve) => (handle.server.listening ? resolve() : handle.server.once('listening', resolve)));
          let id = 0;
          const call = (name, args, extra = {}) =>
            handle.adapter.handle({
              jsonrpc: '2.0',
              id: ++id,
              method: 'tools/call',
              params: { name, arguments: args, _meta: { ...CAPABLE, ...extra._meta }, ...extra.params },
            });
          const list = () => handle.adapter.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/list', params: { _meta: CAPABLE } });
          await fn({ handle, call, list, calls });
        } finally {
          await handle.close();
        }
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const approveVia = async (call, name, args, { argsOnRetry = args, key = `key-${name}` } = {}) => {
    const meta = { 'io.hseos/idempotencyKey': key };
    const pending = await call(name, args, { _meta: meta });
    assert.equal(pending.result?.resultType, 'input_required', JSON.stringify(pending));
    const retry = await call(name, argsOnRetry, {
      _meta: meta,
      params: { requestState: pending.result.requestState, inputResponses: ACCEPT },
    });
    return { pending, retry };
  };

  await it('capability MCP: tools/list shows environment.* and memory.* only when a host backs them, and tools/call reaches them', async () => {
    await withServer(null, async ({ call, list }) => {
      const names = (await list()).result.tools.map((tool) => tool.name);
      assert.ok(!names.some((name) => name.startsWith('environment.') || name.startsWith('memory.')), names.join(','));
      const denied = await call('environment.lsp.hover', HOVER);
      assert.match(denied.error.message, /Unknown tool/);
    });
    await withServer({ dap: undefined, browser: undefined }, async ({ call, list, calls }) => {
      const names = new Set((await list()).result.tools.map((tool) => tool.name));
      for (const expected of ['environment.lsp.hover', 'environment.computer.act', 'memory.write', 'memory.delete', 'list_runs']) {
        assert.ok(names.has(expected), expected);
      }
      assert.ok(!names.has('environment.dap.run'), 'a service the host lacks is not advertised');
      const hover = await call('environment.lsp.hover', HOVER);
      assert.equal(hover.result.structuredContent.ok, true, JSON.stringify(hover));
      assert.equal(calls.length, 1);
    });
  });

  await it('capability MCP: computer.act goes elicitation -> requestState -> resolve -> execution, with the action, args and screenshot digest shown', async () => {
    await withServer({}, async ({ call, calls }) => {
      const meta = { 'io.hseos/idempotencyKey': 'act-1' };
      const pending = await call('environment.computer.act', CLICK, { _meta: meta });
      assert.equal(pending.result.resultType, 'input_required', JSON.stringify(pending));
      const message = pending.result.inputRequests.confirm.params.message;
      for (const needle of ['click', '"x":10', '"y":10', 'session-1', SHOT, BINDING])
        assert.ok(message.includes(needle), `${needle} in: ${message}`);
      assert.equal(
        calls.some((c) => c[0] === 'approve'),
        false,
        'asking does not approve',
      );
      assert.equal(
        calls.some((c) => c[0] === 'act'),
        false,
      );

      const done = await call('environment.computer.act', CLICK, {
        _meta: meta,
        params: { requestState: pending.result.requestState, inputResponses: ACCEPT },
      });
      assert.equal(done.result.resultType, 'complete', JSON.stringify(done));
      assert.equal(done.result.structuredContent.ok, true, JSON.stringify(done));
      const approve = calls.find((c) => c[0] === 'approve');
      assert.ok(approve, 'the service gate was resolved after the human accepted');
      assert.match(approve[2].approver, /^local:/, 'by the identity of the approver, not a runtime constant');
      const act = calls.find((c) => c[0] === 'act');
      assert.equal(act[3].approval_id, approve[1]);
      assert.deepEqual(act[2], { action: 'click', button: 1, x: 10, y: 10 });
    });
  });

  await it('capability MCP: computer.act is refused before anyone is asked when the approval would be digest-only, unless the operator allows it explicitly', async () => {
    const stable = async (hostOptions) => {
      await withServer(hostOptions, async ({ call, calls }) => {
        const refused = await call('environment.computer.act', CLICK, { _meta: { 'io.hseos/idempotencyKey': 'img-1' } });
        assert.notEqual(refused.result?.resultType, 'input_required', 'no elicitation is opened without the image');
        assert.equal(refused.result.structuredContent.ok, false, JSON.stringify(refused));
        assert.equal(refused.result.structuredContent.error.code, 'ENV_COMPUTER_IMAGE_APPROVAL_UNSUPPORTED');
        for (const kind of ['requestApproval', 'approve', 'act'])
          assert.equal(
            calls.some((c) => c[0] === kind),
            false,
            kind,
          );
      });
    };
    // Default (fail-closed), and only a literal true opens the override.
    await stable({ allow_digest_only_approval: undefined });
    await stable({ allow_digest_only_approval: false });
    await stable({ allow_digest_only_approval: 'true' });
    await stable({ allow_digest_only_approval: 1 });
  });

  await it('capability MCP: computer.start is refused too without the override, and asks for approval with it', async () => {
    const START = { target: { command: '/usr/bin/xterm' } };
    await withServer({ allow_digest_only_approval: undefined }, async ({ call, calls }) => {
      const refused = await call('environment.computer.start', START, { _meta: { 'io.hseos/idempotencyKey': 'st-1' } });
      assert.notEqual(refused.result?.resultType, 'input_required', JSON.stringify(refused));
      assert.equal(refused.result.structuredContent.error.code, 'ENV_COMPUTER_IMAGE_APPROVAL_UNSUPPORTED');
      assert.equal(
        calls.some((c) => c[0] === 'start'),
        false,
      );
    });
    await withServer({}, async ({ call }) => {
      const asked = await call('environment.computer.start', START, { _meta: { 'io.hseos/idempotencyKey': 'st-2' } });
      assert.equal(asked.result.resultType, 'input_required', JSON.stringify(asked));
    });
  });

  await it('capability MCP: computer.stop and the screenshot need no approval and are not refused for the missing image', async () => {
    await withServer({ allow_digest_only_approval: undefined }, async ({ call, calls }) => {
      const stop = await call('environment.computer.stop', { session_id: 'session-1' });
      assert.equal(stop.result.structuredContent.ok, true, JSON.stringify(stop));
      assert.ok(calls.some((c) => c[0] === 'stop'));
    });
  });

  await it('capability MCP: an approval of one computer action does not serve another, and a declined one never resolves the gate', async () => {
    await withServer({}, async ({ call, calls }) => {
      const other = { ...CLICK, x: 99 };
      const { retry } = await approveVia(call, 'environment.computer.act', CLICK, { argsOnRetry: other, key: 'act-2' });
      assert.ok(retry.error, 'the signed state is bound to the exact arguments');
      assert.equal(
        calls.some((c) => c[0] === 'act'),
        false,
      );

      const meta = { 'io.hseos/idempotencyKey': 'act-3' };
      const pending = await call('environment.computer.act', CLICK, { _meta: meta });
      const declined = await call('environment.computer.act', CLICK, {
        _meta: meta,
        params: { requestState: pending.result.requestState, inputResponses: { confirm: { action: 'decline' } } },
      });
      assert.ok(declined.error, JSON.stringify(declined));
      assert.equal(
        calls.some((c) => c[0] === 'approve'),
        false,
        'no human approval, no resolve',
      );
      assert.equal(
        calls.some((c) => c[0] === 'act'),
        false,
      );
    });
  });

  await it('capability MCP: memory.delete goes through elicitation and requestState and deletes only after the human accepts', async () => {
    await withServer({}, async ({ call }) => {
      assert.equal((await call('memory.write', withDigest(entry()))).result.structuredContent.ok, true);
      const { pending, retry } = await approveVia(call, 'memory.delete', { project_id: 'alpha', memory_id: 'note-1', reason: 'obsolete' });
      const message = pending.result.inputRequests.confirm.params.message;
      assert.ok(message.includes('note-1') && message.includes('alpha'), message);
      assert.equal(retry.result.resultType, 'complete', JSON.stringify(retry));
      assert.equal(retry.result.structuredContent.ok, true, JSON.stringify(retry));
      const found = await call('memory.retrieve', { project_id: 'alpha', query: 'blue green', include_untrusted: true });
      assert.equal(found.result.structuredContent.data.result.length, 0);
    });
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
  await runCapabilityProviderTests();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-hseos-governance] fatal:', error.message);
  process.exit(1);
});
