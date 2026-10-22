'use strict';

// W5 closeout (W4-C10): the environment and memory journey end to end on a real SQLite ledger. An engineering task that
// the control admits calls LSP and governed memory and drives a display session, a second task receives the governed
// memory as quoted data, and the same capabilities are served over MCP with the elicitation flow. Only the binaries are
// faked (the display host); the services, the approval gate, the policy, the ledger and the runtimes are the real ones.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const { parseCreationInput, EngineeringControl } = require('../tools/cli/lib/engineering-control');
const { createApprovalGate } = require('../tools/cli/lib/environment-approval');
const memoryPackage = require('../packages/agent-memory');
const environment = require('../packages/agent-environment');
const { containsCredential } = require('../tools/cli/lib/campaign-evidence-store');
const { startNativeMcpServer } = require('../tools/lib/governed-execution/native-mcp-server');
const { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } = require('../tools/lib/mcp-2026-adapter');
const { MCP_MODERN_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');
const {
  sha256,
  PNG,
  START,
  fakeTerminal,
  computerFactory,
  lspFactory,
  project,
  execute,
  ledgerRows,
  environmentEvents,
  toolErrors,
  ALLOW,
  OPERATOR,
  memoryHost,
  outcomeOf,
} = require('./helpers/environment-fixtures');
const { createEnvironmentLedgerSink } = environment;

const JOURNEY = [
  'environment.lsp.diagnostics',
  'memory.write',
  'memory.retrieve',
  'memory.delete',
  'environment.computer.start',
  'environment.computer.screenshot',
  'environment.computer.act',
  'environment.computer.stop',
];
const DIAGNOSTICS = { action: 'diagnostics', language: 'typescript', file: 'index.js' };
const TRUSTED = { origin: 'operator', trust: 'trusted' };
const memoryEntry = (env, overrides) => env.entry({ classification: 'internal', ttl_seconds: 3600, ...overrides });

/** The journey's task: v2, admitted by the control with check_ids per criterion, opting into the given capabilities. */
const ROOMY = { max_tool_calls: 32, max_turns: 32, max_tokens: 1_000_000 };
function admittedTask(t, capabilities) {
  const f = project(t, capabilities, { limits: ROOMY });
  const input = { contract: structuredClone(f.contract), responses: [] };
  assert.equal(parseCreationInput('create', input, { admission: true }).contract.environment.capabilities.length, capabilities.length);
  // The control's own admission of the contract (workspace, model source and the hardened rules), not only the parser.
  const control = new EngineeringControl({ workspaces: [f.root] });
  t.after(() => {
    control.close();
    fs.rmSync(control.state, { recursive: true, force: true });
  });
  controlAdmissions.push(
    control.admitCreation('create', input, `admission-${controlAdmissions.length}`).then((admitted) => admitted.input.contract),
  );
  return f;
}
const controlAdmissions = [];
const allEvents = (db, aggregateType) =>
  db
    .prepare('SELECT event_type, payload_json FROM execution_events WHERE aggregate_type = ? ORDER BY position')
    .all(aggregateType)
    .map((row) => ({ type: row.event_type, payload: JSON.parse(row.payload_json) }));
const memoryEvents = (env) => allEvents(env.db, 'agent_memory').map((event) => `${event.type}:${event.payload.memory_id}`);

test('admission: environment capabilities do not weaken the control, and a task without check_ids is refused', (t) => {
  const f = project(t, JOURNEY);
  const unlinked = structuredClone(f.contract);
  delete unlinked.acceptance[0].check_ids;
  assert.throws(() => parseCreationInput('create', { contract: unlinked, responses: [] }, { admission: true }), {
    reason: 'ENGINEERING_ACCEPTANCE_UNCOVERED',
  });
  assert.ok(admittedTask(t, JOURNEY));
});

test('journey: an admitted task uses LSP, memory and a display session; a second task receives the governed memory as data', async (t) => {
  // The store's deletion approval is derived from the person's approval at the runtime, never seeded by the test.
  const env = memoryHost({ derive: true });
  const trusted = (id, content) =>
    env.store.write(memoryEntry(env, { memory_id: id, content, ...TRUSTED }), { rules: ALLOW, actor: OPERATOR });
  trusted('note-1', 'Return the sum of two integers with plain addition in the deploy pipeline.');
  trusted('note-2', 'The sum of two integers never overflows in this project.');

  const lspCalls = [];
  const terminal = fakeTerminal();
  const gate = createApprovalGate();
  // An approval the person gave for another action (Escape) of the same session, in the same gate.
  const foreignRequest = gate.request({
    session_id: 'session-1',
    seq: 2,
    action: 'key',
    args: { key: 'Escape' },
    screenshot_digest: sha256(PNG),
  });
  gate.approve(foreignRequest.request_id, { approver: 'owner-1' });
  let actions = 0;
  const approve = async (request) => {
    if (request.tool === 'memory.delete' && request.input?.memory_id === 'note-2') return null;
    if (request.layer === 'computer_action') {
      actions += 1;
      // The first action arrives with an approval the person gave for another one; the second is approved for itself.
      return actions === 1
        ? { approved: true, approver: 'owner-1', request_id: foreignRequest.request_id }
        : { approved: true, approver: 'owner-1' };
    }
    return { approved: true, approver: 'owner-1' };
  };
  const hostFor = () => ({
    ...env.host,
    memory: { ...env.host.memory, actor: { kind: 'host', id: 'agent-memory' } },
    factories: { lsp: lspFactoryFor(lspCalls), computer: computerFactory(terminal) },
    approvalGate: gate,
    approve,
  });
  // LSP: a diagnostics answer, written to the ledger by the service itself through the sink.
  const lspFactoryFor = (calls) => {
    const base = lspFactory(calls);
    return (context) => {
      const service = base(context);
      return {
        async run(input) {
          const result = await service.run(input);
          return { ...result, action: 'diagnostics', result: { diagnostics: [] } };
        },
      };
    };
  };
  const learned = memoryEntry(env, {
    memory_id: 'learned-1',
    content: 'The sum of two integers is probably exact.',
    origin: 'agent',
    trust: 'untrusted',
    source_ref: 'agent://session/1',
  });
  const forged = { ...learned, memory_id: 'forged-1', origin: 'operator', trust: 'trusted' };

  const first = admittedTask(t, JOURNEY);
  const result = await execute(
    t,
    first,
    [
      { name: 'environment.lsp.diagnostics', input: DIAGNOSTICS },
      { name: 'memory.write', input: learned },
      { name: 'memory.write', input: forged },
      { name: 'memory.retrieve', input: { project_id: 'proj-1', query: 'sum integers', limit: 5 } },
      { name: 'memory.delete', input: { project_id: 'proj-1', memory_id: 'note-2' } },
      { name: 'memory.delete', input: { project_id: 'proj-1', memory_id: 'note-1', reason: 'obsolete' } },
      { name: 'environment.computer.start', input: START },
      { name: 'environment.computer.screenshot', input: { session_id: 'session-1' } },
      { name: 'environment.computer.act', input: { session_id: 'session-1', action: 'key', key: 'Return' } },
      { name: 'environment.computer.act', input: { session_id: 'session-1', action: 'key', key: 'Return' } },
    ],
    hostFor(),
  );
  assert.equal(result.status, 'completed', JSON.stringify(result));

  // What the model was refused, by whom, and why.
  assert.deepEqual(toolErrors(result), [
    'memory.write:AGENT_MEMORY_ORIGIN_ACTOR_MISMATCH',
    'memory.delete:EXECUTION_APPROVAL_REQUIRED',
    'environment.computer.act:ENV_COMPUTER_APPROVAL_MISMATCH',
  ]);
  assert.equal(
    terminal.state.lines.filter((line) => line.action === 'key').length,
    1,
    'only the properly approved action reached the display',
  );
  const retrieved = outcomeOf(result, 'memory.retrieve')[0].result;
  assert.deepEqual(retrieved.map((item) => item.source_ref).sort(), ['memory://proj-1/note-1', 'memory://proj-1/note-2']);
  assert.ok(retrieved.every((item) => item.authority === 'data' && item.provenance.trust === 'untrusted'));

  // The task ledger (real SQLite): the environment session and the approval trail.
  const types = environmentEvents(result);
  for (const type of [
    'environment.lsp.completed',
    'environment.computer.session_opened',
    'environment.computer.screenshot',
    'environment.computer.action_executed',
    'environment.computer.session_closed',
  ])
    assert.ok(types.includes(type), `${type} in ${types}`);
  // (The gate here is the test's own, to present a foreign approval; the sink-backed approval trail is proved in
  // test-engineering-environment.js.)
  // The memory ledger: the seeds, the model's untrusted note, the deletion of note-1 only. The forged one never landed.
  assert.deepEqual(memoryEvents(env), [
    'memory.written:note-1',
    'memory.written:note-2',
    'memory.written:learned-1',
    'memory.deleted:note-1',
  ]);

  // The second task: governed memory arrives as quoted data; deleted and untrusted entries do not.
  const second = admittedTask(t, ['memory.retrieve']);
  const next = await execute(t, second, [], { ...env.host });
  assert.equal(next.status, 'completed', JSON.stringify(next));
  const blocks = ledgerRows(next, "SELECT payload_json FROM execution_events WHERE aggregate_type = 'agent_session' ORDER BY position")
    .map((row) => JSON.parse(JSON.parse(row.payload_json).session_event_json))
    .find((event) => event.event_type === 'context.assembled')
    .payload.request.messages.map((message) => message.content)
    .filter((content) => content.startsWith('[HSEOS MEMORY_DATA'));
  assert.equal(blocks.length, 1, blocks.join('\n'));
  assert.match(blocks[0], /source="memory:\/\/proj-1\/note-2"/);
  assert.match(blocks[0], /authority=data/);
  assert.ok(!blocks[0].includes('plain addition'), 'the deleted note is gone');
  assert.ok(!blocks[0].includes('probably exact'), 'the untrusted note stays out');

  // The control: a task that did not declare the capability is denied, and its service is never reached.
  const calls = [];
  const control = admittedTask(t, ['memory.retrieve']);
  const denied = await execute(t, control, [{ name: 'environment.lsp.diagnostics', input: DIAGNOSTICS }], {
    ...env.host,
    factories: { lsp: lspFactory(calls) },
  });
  assert.equal(denied.reason, 'session-failed:tool_failed');
  assert.deepEqual(calls, []);
  assert.deepEqual(environmentEvents(denied), []);
});

// ---------------------------------------------------------------------------------------------------------------
// The same capabilities over MCP: tools/list, tools/call and the elicitation flow, with the host built from the wiring.
// ---------------------------------------------------------------------------------------------------------------

const CAPABLE = {
  [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
  [CLIENT_INFO_META_KEY]: { name: 'journey-client', version: '1.0.0' },
  [CLIENT_CAPABILITIES_META_KEY]: { elicitation: {} },
};
const ACCEPT = { confirm: { action: 'accept', content: { approved: true } } };

async function withEnv(patch, fn) {
  const saved = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  Object.assign(process.env, patch);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w4-proof-'));
  const calls = [];
  try {
    await withEnv({ NODE_ENV: 'test', HSEOS_GOVERNED_EXECUTION_FIXTURE: '1' }, async () => {
      let wired;
      const handle = startNativeMcpServer({
        serverId: 'swarm',
        tools: new Map([['list_runs', { name: 'list_runs', description: 'd', inputSchema: { type: 'object' } }]]),
        invokeTool: async () => ({ runs: [] }),
        mode: 'http',
        port: 0,
        dbPath: path.join(dir, 'project.db'),
        log: () => {},
        environmentHost: (wiring) => {
          wired = wiring;
          const sink = createEnvironmentLedgerSink({
            ledger: wiring.ledger,
            project_id: 'alpha',
            actor: { type: 'host', id: 'env-host' },
            session_id: 'session-1',
          });
          return {
            project_id: 'alpha',
            lsp: {
              async run(input) {
                calls.push(['lsp', input]);
                sink({ type: 'environment.lsp.completed', action: input.action });
                return {
                  contract: 'environment.lsp.v1',
                  status: 'ok',
                  action: 'diagnostics',
                  language: 'typescript',
                  result: { diagnostics: [] },
                  source: {
                    source_ref: 'environment.lsp.diagnostics',
                    authority: 'data',
                    provenance: {
                      origin: 'lsp',
                      source_ref: 'environment.lsp.diagnostics',
                      digest: `sha256:${'a'.repeat(64)}`,
                      retrieved_at: '2026-10-21T00:00:00.000Z',
                      trust: 'untrusted',
                      transform: [],
                    },
                  },
                  execution: {},
                };
              },
            },
            computer: {
              async start() {
                return { contract: 'environment.computer.v1', status: 'started', session_id: 'session-1' };
              },
              async screenshot() {
                return { contract: 'environment.computer.v1', status: 'ok', session_id: 'session-1' };
              },
              requestApproval(sessionId, action) {
                calls.push(['requestApproval', sessionId, action]);
                return {
                  status: 'pending',
                  request_id: 'req-1',
                  binding_digest: 'b'.repeat(64),
                  seq: 1,
                  screenshot_digest: 'a'.repeat(64),
                };
              },
              async act(sessionId, action, options) {
                calls.push(['act', sessionId, action, options]);
                return { contract: 'environment.computer.v1', status: 'ok', session_id: sessionId, seq: 1, action: action.action };
              },
              async stop() {
                return { contract: 'environment.computer.v1', status: 'stopped', session_id: 'session-1' };
              },
            },
            approvals: {
              approve: (requestId, who) => (calls.push(['approve', requestId, who]), { status: 'approved', request_id: requestId }),
            },
            memory: {
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
            },
          };
        },
      });
      try {
        await new Promise((resolve) => (handle.server.listening ? resolve() : handle.server.once('listening', resolve)));
        let id = 0;
        const rpc = (method, params) => handle.adapter.handle({ jsonrpc: '2.0', id: ++id, method, params });
        const call = (name, args, extra = {}) =>
          rpc('tools/call', { name, arguments: args, _meta: { ...CAPABLE, ...extra._meta }, ...extra.params });
        const list = () => rpc('tools/list', { _meta: CAPABLE });
        await fn({ call, list, calls, wired: () => wired, db: new Database(path.join(dir, 'project.db'), { readonly: true }) });
      } finally {
        await handle.close();
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const mcpEntry = (overrides = {}) => ({
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
const CLICK = { session_id: 'session-1', action: 'click', x: 10, y: 10 };
const approveVia = async (call, name, args, { argsOnRetry = args, key } = {}) => {
  const meta = { 'io.hseos/idempotencyKey': key };
  const pending = await call(name, args, { _meta: meta });
  assert.equal(pending.result?.resultType, 'input_required', JSON.stringify(pending));
  const retry = await call(name, argsOnRetry, {
    _meta: meta,
    params: { requestState: pending.result.requestState, inputResponses: ACCEPT },
  });
  return { pending, retry };
};

test('MCP journey: tools/list advertises what the host backs, and the same flow runs with human elicitation', async () => {
  await withServer(async ({ call, list, calls, db }) => {
    const names = new Set((await list()).result.tools.map((tool) => tool.name));
    for (const expected of ['environment.lsp.diagnostics', 'environment.computer.act', 'memory.write', 'memory.retrieve', 'memory.delete'])
      assert.ok(names.has(expected), expected);
    assert.ok(!names.has('environment.dap.run') && !names.has('environment.browser.run'), 'services the host lacks are not advertised');
    assert.match((await call('environment.dap.run', {})).error.message, /Unknown tool/, 'the control: an unbacked capability is denied');

    // LSP and memory write/retrieve need no approval; the service writes its event to the same ledger.
    const lsp = await call('environment.lsp.diagnostics', DIAGNOSTICS);
    assert.equal(lsp.result.structuredContent.ok, true, JSON.stringify(lsp));
    assert.equal((await call('memory.write', withDigest(mcpEntry()))).result.structuredContent.ok, true);
    const found = await call('memory.retrieve', { project_id: 'alpha', query: 'blue green', include_untrusted: true });
    assert.equal(found.result.structuredContent.data.result.length, 1);
    assert.equal(found.result.structuredContent.data.result[0].authority, 'data');

    // computer.act: asking does not act; an approval of one input is refused for another; a decline never resolves the gate.
    const meta = { 'io.hseos/idempotencyKey': 'act-1' };
    const pending = await call('environment.computer.act', CLICK, { _meta: meta });
    assert.equal(pending.result.resultType, 'input_required');
    for (const needle of ['click', '"x":10', 'session-1'])
      assert.ok(pending.result.inputRequests.confirm.params.message.includes(needle), needle);
    assert.equal(
      calls.some((entry) => entry[0] === 'act' || entry[0] === 'approve'),
      false,
    );
    const mismatch = await approveVia(call, 'environment.computer.act', CLICK, { argsOnRetry: { ...CLICK, x: 99 }, key: 'act-2' });
    assert.ok(mismatch.retry.error, 'the signed state is bound to the exact arguments');
    const declined = await call('environment.computer.act', CLICK, {
      _meta: { 'io.hseos/idempotencyKey': 'act-3' },
      params: {
        requestState: (await call('environment.computer.act', CLICK, { _meta: { 'io.hseos/idempotencyKey': 'act-3' } })).result
          .requestState,
        inputResponses: { confirm: { action: 'decline' } },
      },
    });
    assert.ok(declined.error);
    assert.equal(
      calls.some((entry) => entry[0] === 'act'),
      false,
      'nothing reached the display without a human acceptance',
    );
    const done = await approveVia(call, 'environment.computer.act', CLICK, { key: 'act-4' });
    assert.equal(done.retry.result.structuredContent.ok, true, JSON.stringify(done.retry));
    assert.equal(calls.filter((entry) => entry[0] === 'act').length, 1);

    // memory.delete: refused without the human, deleted after.
    const refused = await call('memory.delete', { project_id: 'alpha', memory_id: 'note-1' });
    assert.equal(refused.result.resultType, 'input_required', 'asking is not deleting');
    assert.equal(
      (await call('memory.retrieve', { project_id: 'alpha', query: 'blue green', include_untrusted: true })).result.structuredContent.data
        .result.length,
      1,
    );
    const deletion = await approveVia(
      call,
      'memory.delete',
      { project_id: 'alpha', memory_id: 'note-1', reason: 'obsolete' },
      { key: 'del-1' },
    );
    const shown = deletion.pending.result.inputRequests.confirm.params.message;
    assert.ok(
      shown.includes('note-1') && shown.includes('alpha') && shown.includes('deleting memory'),
      `the human is shown what is deleted: ${shown}`,
    );
    assert.equal(deletion.retry.result.structuredContent.ok, true, JSON.stringify(deletion.retry));
    assert.equal(
      (await call('memory.retrieve', { project_id: 'alpha', query: 'blue green', include_untrusted: true })).result.structuredContent.data
        .result.length,
      0,
    );

    // The shared SQLite ledger holds both aggregates.
    const environmentRows = allEvents(db, 'environment_session').map((event) => event.type);
    assert.deepEqual(environmentRows, ['environment.lsp.completed']);
    const memoryRows = allEvents(db, 'agent_memory').map((event) => `${event.type}:${event.payload.memory_id}`);
    assert.deepEqual(memoryRows, ['memory.written:note-1', 'memory.deleted:note-1']);
    db.close();
  });
});

test('the control admits a task that declares environment capabilities, but runs it without a host, so the capabilities are blocked', async (t) => {
  // Every task of the journey went through the control's admission.
  for (const contract of await Promise.all(controlAdmissions)) assert.ok(contract.environment?.capabilities.length > 0);
  // Creating and running through the control never supplies a host: a declared capability has no service behind it.
  const f = project(t, ['environment.lsp.diagnostics'], { limits: ROOMY });
  const control = new EngineeringControl({ workspaces: [f.root] });
  t.after(() => {
    const states = control.ledger
      .readGlobal({ limit: 1000, aggregate_type: 'control_task' })
      .filter((event) => event.payload.kind === 'registered')
      .map((event) => event.payload.state_directory);
    control.close();
    for (const state of [...states, control.state]) fs.rmSync(state, { recursive: true, force: true });
  });
  const id = randomUUID();
  const command = (action, sequence, input = {}) => ({
    schema_version: 1,
    command_id: randomUUID(),
    resource_id: id,
    action,
    expected_sequence: sequence,
    input,
  });
  const created = await control.execute(
    command('create', 0, { contract: f.contract, responses: [{ name: 'environment.lsp.diagnostics', input: DIAGNOSTICS }] }),
  );
  // Admitted and created, then blocked at once: nothing on the control path can provide the host the capabilities need.
  assert.equal(created.task_result, 'blocked', JSON.stringify(created));
  assert.equal(created.reason, 'ENGINEERING_ENVIRONMENT_HOST_REQUIRED');
});
