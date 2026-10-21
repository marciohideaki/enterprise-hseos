'use strict';

// Shared fixtures of the environment and memory capability tests: a scripted display terminal driven by the real
// computer service and approval gate, fake LSP services that write through the ledger sink, an engineering project
// whose contract opts into capabilities, readers of the task ledger, and a governed memory host over SQLite.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { runEngineeringTask } = require('../../tools/cli/lib/engineering-task-runtime');
const { openExecutionLedgerFileFixture } = require('../../tools/mcp-project-state/lib/execution-ledger-schema');
const computer = require('../../packages/agent-environment/computer');
const computerHost = require('../../packages/agent-environment/computer-host');
const { fixture } = require('./engineering-project');
const Database = require('better-sqlite3');
const memory = require('../../packages/agent-memory');
const { createGovernedMemory } = require('../../tools/cli/lib/memory-context-source');
const { ExecutionApprovalStore } = require('../../tools/mcp-project-state/lib/execution-approval-store');
const { ExecutionEventLedger } = require('../../tools/mcp-project-state/lib/execution-event-ledger');
const { applyExecutionLedgerFixtureSchema } = require('../../tools/mcp-project-state/lib/execution-ledger-schema');
const { createMemoryDeleteApprovals } = require('../../tools/cli/lib/engineering-task-extensions');
const { runMigrations } = require('../../tools/mcp-project-state/lib/migrations');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const PNG = computerHost.encodePng(640, 400, Buffer.alloc(640 * 400 * 3));
const SHOT = (seq) => ({
  event: 'result',
  seq,
  ok: true,
  action: 'screenshot',
  width: 640,
  height: 400,
  bytes: PNG.length,
  sha256: sha256(PNG),
  png_base64: PNG.toString('base64'),
});
const LSP_OK = {
  contract: 'environment.lsp.v1',
  status: 'ok',
  action: 'hover',
  language: 'typescript',
  result: { hover: 'function greet(): string' },
  source: {
    source_ref: 'environment.lsp.hover',
    authority: 'data',
    provenance: {
      origin: 'lsp',
      source_ref: 'environment.lsp.hover',
      digest: `sha256:${'a'.repeat(64)}`,
      retrieved_at: '2026-10-21T00:00:00.000Z',
      trust: 'untrusted',
      transform: [],
    },
  },
  execution: {},
};
const HOVER = { action: 'hover', language: 'typescript', file: 'index.js', position: { line: 0, character: 1 } };
const START = { target: { command: '/usr/bin/xmessage', args: ['hi'] }, timeout_ms: 10_000 };

/** A scripted terminal: the real computer service and the real approval gate run; only the display host is faked. */
function fakeTerminal() {
  const state = { lines: [], terminated: 0, stopped: 0 };
  const start = (launch) => {
    let resolveCompletion;
    const completion = new Promise((resolve) => (resolveCompletion = resolve));
    const send = (event) => {
      const text = `${JSON.stringify(event)}\n`;
      launch.onOutput({ kind: 'output', stream: 'stdout', data: Buffer.from(text).toString('base64') });
    };
    state.finish = () => resolveCompletion({ status: 'succeeded', descendants_terminated: true });
    setImmediate(() => send({ event: 'ready', display: { width: 640, height: 400 }, sockets: [], target_window: true }));
    return {
      ready: Promise.resolve({}),
      completion,
      group: '/fake/group',
      async command(_action, input) {
        const line = JSON.parse(Buffer.from(input.data, 'base64').toString('utf8'));
        state.lines.push(line);
        if (line.op === 'stop') {
          state.stopped += 1;
          state.finish();
          return { kind: 'ack' };
        }
        send(
          line.action === 'screenshot'
            ? SHOT(line.seq)
            : { event: 'result', seq: line.seq, ok: true, action: line.action, target_alive: true },
        );
        return { kind: 'ack' };
      },
      async terminate() {
        state.terminated += 1;
        state.finish();
        return { status: 'terminated', descendants_terminated: true };
      },
    };
  };
  return { state, start };
}

function computerFactory(terminal) {
  return ({ ledger, approvals }) =>
    computer.createComputerService({
      policy: { profile: 'P1' },
      toolchain: { status: 'ready' },
      approvals,
      mediaStore: { put: (bytes) => ({ digest: sha256(bytes), bytes: bytes.length, artifact_ref: `artifact://sha256/${sha256(bytes)}` }) },
      startTerminal: terminal.start,
      ledger,
      newId: () => 'session-1',
      waits: { start: 2000, action: 2000, stop: 2000 },
      denyDisplays: [':0'],
    });
}

function lspFactory(calls) {
  return ({ ledger }) => ({
    async run(input) {
      calls.push(input);
      ledger({ type: 'environment.lsp.completed', contract: 'environment.lsp.v1', action: input.action, language: input.language });
      return LSP_OK;
    },
  });
}

function project(t, capabilities, { limits = {} } = {}) {
  const f = fixture(t);
  if (capabilities) f.contract.environment = { capabilities };
  Object.assign(f.contract.limits, limits);
  f.save();
  return f;
}

async function execute(t, f, responses, environmentHost) {
  const file = path.join(f.directory, 'responses.json');
  fs.writeFileSync(file, JSON.stringify(responses));
  const result = await runEngineeringTask({
    taskContract: f.filename,
    scriptedResponses: file,
    ...(environmentHost ? { environmentHost } : {}),
  });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  return result;
}

function ledgerRows(result, sql, ...params) {
  const handle = openExecutionLedgerFileFixture(result.state);
  try {
    return handle.db.prepare(sql).all(...params);
  } finally {
    handle.close();
  }
}
const environmentEvents = (result) =>
  ledgerRows(result, "SELECT event_type FROM execution_events WHERE aggregate_type = 'environment_session' ORDER BY position").map(
    (row) => row.event_type,
  );
const executionEvents = (result) =>
  ledgerRows(result, "SELECT event_type, payload_json FROM execution_events WHERE aggregate_type = 'execution' ORDER BY position");

const grant =
  (calls = []) =>
  async (request) => {
    calls.push(request);
    return { approved: true, approver: 'owner-1' };
  };

const reasonOf = (result) => `${result.task_result}/${result.reason}`;
/** The tool outcomes the model saw: `<tool>:<error code>` for each call that failed. */
const toolErrors = (result) =>
  ledgerRows(result, "SELECT payload_json FROM execution_events WHERE aggregate_type = 'agent_session' ORDER BY position")
    .map((row) => JSON.parse(JSON.parse(row.payload_json).session_event_json).payload.outcome)
    .filter((outcome) => outcome?.error)
    .map((outcome) => `${outcome.name}:${outcome.error.code}`);

const MEMORY_POLICY = 'hseos-operational-v1';
const STAMP = '2026-10-21T12:00:00.000Z';
const ALLOW = [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }];
const OPERATOR = { kind: 'operator', id: 'owner' };
const MEMORY = ['memory.write', 'memory.retrieve', 'memory.delete'];

function memoryHost({ rules = ALLOW, operator = OPERATOR, derive = false } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, path.join(__dirname, '..', '..', 'tools', 'mcp-project-state', 'migrations'), { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  db.exec(
    fs.readFileSync(
      path.join(__dirname, '..', '..', 'tools', 'mcp-project-state', 'migrations-pending-activation', '007-execution-approvals.sql'),
      'utf8',
    ),
  );
  const ledger = new ExecutionEventLedger(db);
  const approvalStore = new ExecutionApprovalStore(db);
  const state = { approvalId: null };
  // With `derive`, the store's deletion approval comes from the person's approval at the runtime, not from the test.
  const deleteApprovals = derive
    ? createMemoryDeleteApprovals({ approvalStore, policyVersion: MEMORY_POLICY, now: () => Date.parse(STAMP) })
    : null;
  const store = createGovernedMemory({
    ledger,
    now: () => Date.parse(STAMP),
    approvalVerifier: memory.createExecutionApprovalVerifier({
      approvalStore,
      resolveApprovalId: deleteApprovals ? deleteApprovals.resolveApprovalId : () => state.approvalId,
      policyVersion: MEMORY_POLICY,
      now: () => Date.parse(STAMP),
    }),
  });
  const entry = (overrides = {}) => ({
    scope: { project_id: 'proj-1' },
    memory_id: 'note-1',
    content: 'the deploy pipeline uses blue green rollouts',
    origin: 'operator',
    trust: 'trusted',
    classification: 'internal',
    source_ref: 'doc://runbook/deploy',
    ttl_seconds: 3600,
    ...overrides,
  });
  const approveDeletion = (memoryId) => {
    const operation = memory.memoryDeleteOperation('proj-1', memoryId);
    state.approvalId = `appr-${memoryId}`;
    approvalStore.issue({
      approval_id: state.approvalId,
      operation_id: operation.operation_id,
      authorizer: { id: 'owner', type: 'operator' },
      resource_scope: operation.resource_scope,
      issued_at: STAMP,
      expires_at: '2026-10-21T13:00:00.000Z',
      decision: 'approved',
      policy_version: MEMORY_POLICY,
      evidence_ref: 'hseos://test/approval',
    });
  };
  const host = { project_id: 'proj-1', memory: { store, rules, operator, ...(deleteApprovals ? { deleteApprovals } : {}) } };
  return {
    db,
    ledger,
    store,
    entry,
    approveDeletion,
    host,
    seed: (overrides) => store.write(entry(overrides), { rules: ALLOW, actor: OPERATOR }),
  };
}

const retrieveCall = (input = {}) => ({
  name: 'memory.retrieve',
  input: { project_id: 'proj-1', query: 'deploy pipeline', limit: 3, ...input },
});
const outcomeOf = (result, name) =>
  ledgerRows(result, "SELECT payload_json FROM execution_events WHERE aggregate_type = 'agent_session' ORDER BY position")
    .map((row) => JSON.parse(JSON.parse(row.payload_json).session_event_json).payload.outcome)
    .filter((outcome) => outcome?.name === name);

module.exports = {
  sha256,
  PNG,
  SHOT,
  LSP_OK,
  HOVER,
  START,
  fakeTerminal,
  computerFactory,
  lspFactory,
  project,
  execute,
  ledgerRows,
  environmentEvents,
  executionEvents,
  grant,
  reasonOf,
  toolErrors,
  MEMORY_POLICY,
  STAMP,
  ALLOW,
  OPERATOR,
  MEMORY,
  memoryHost,
  retrieveCall,
  outcomeOf,
};
