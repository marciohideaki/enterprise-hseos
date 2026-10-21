'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const memory = require('../packages/agent-memory');
const { createApprovalGate } = require('../tools/cli/lib/environment-approval');
const { containsCredential } = require('../tools/cli/lib/campaign-evidence-store');
const { ExecutionApprovalStore } = require('../tools/mcp-project-state/lib/execution-approval-store');

const checker = () => import(pathToFileURL(path.join(__dirname, 'journeys', 'environment-ledger.mjs')).href);
const DIGEST = 'c'.repeat(64);
const PROJECT = 'w5-journey';
const bind = { session_id: 's1', seq: 1, action: 'click', args: { x: 1, y: 2, button: 1 }, screenshot_digest: DIGEST };

// Drives real services and sinks into a real ledger, the way the journey does, and returns the rows read back from it.
async function populate({ only = null } = {}) {
  const { openJourneyLedger } = await checker();
  const journey = openJourneyLedger();
  const run = (capability, fn) => (only === null || only.includes(capability) ? fn() : undefined);
  run('lsp', () => {
    const sink = journey.sink('lsp-A');
    sink({ type: 'environment.lsp.completed', action: 'hover' });
    sink({ type: 'environment.lsp.refused', code: 'ENV_LSP_PATH_OUTSIDE' });
  });
  run('dap', () => journey.sink('dap-A')({ type: 'environment.dap.completed' }));
  run('browser', () => journey.sink('browser-A')({ type: 'environment.browser.completed' }));
  run('computer', () => {
    const sink = journey.sink('computer-1');
    const gate = createApprovalGate({ ledger: sink });
    sink({ type: 'environment.computer.session_opened' });
    sink({ type: 'environment.computer.screenshot' });
    sink({ type: 'environment.computer.refused', code: 'ENV_COMPUTER_APPROVAL_REQUIRED' });
    const asked = gate.request(bind);
    gate.approve(asked.request_id, { approver: 'operator' });
    gate.consume(asked.request_id, bind);
    sink({ type: 'environment.computer.action_executed', session_id: 's1', seq: 1, action: 'click' });
    sink({ type: 'environment.computer.session_closed' });
  });
  run('memory', () => {
    const approvalStore = new ExecutionApprovalStore(journey.db);
    let approvalId = null;
    const store = new memory.MemoryStore({
      ledger: journey.ledger,
      scanCredential: (text) => containsCredential(text),
      approvalVerifier: memory.createExecutionApprovalVerifier({ approvalStore, resolveApprovalId: () => approvalId }),
    });
    const content = 'journey note about the deploy';
    store.write(
      {
        scope: { project_id: 'w5-journey' },
        memory_id: 'journey-note',
        content,
        source_digest: memory.sha256Text(content),
        origin: 'operator',
        trust: 'trusted',
        classification: 'internal',
        source_ref: 'doc://journey',
        ttl_seconds: 3600,
      },
      { rules: [{ id: 'allow', source: 'project', stage: 'allow', decision: 'allow' }], actor: { kind: 'operator', id: 'owner' } },
    );
    const operation = memory.memoryDeleteOperation('w5-journey', 'journey-note');
    approvalId = 'journey-approval';
    approvalStore.issue({
      approval_id: approvalId,
      operation_id: operation.operation_id,
      authorizer: { id: 'owner', type: 'operator' },
      resource_scope: operation.resource_scope,
      issued_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      decision: 'approved',
      policy_version: 'hseos-operational-v1',
      evidence_ref: 'hseos://journey/approval',
    });
    store.forget({ project_id: 'w5-journey', memory_id: 'journey-note' }, { actor: { kind: 'operator', id: 'owner' } });
  });
  return journey;
}

const rulesOf = (verdict) => new Set(verdict.violations.map((entry) => entry.rule));

test('rows read back from a real ledger satisfy the journey assertion', async () => {
  const { assertEnvironmentLedger, REQUIRED_EVENTS } = await checker();
  const journey = await populate();
  try {
    const verdict = assertEnvironmentLedger(journey.rows(), { projectId: PROJECT });
    assert.deepEqual(verdict.violations, []);
    assert.equal(verdict.ok, true);
    for (const type of Object.values(REQUIRED_EVENTS).flat()) assert.ok(verdict.types.includes(type), type);
  } finally {
    journey.close();
  }
});

test('an empty ledger, or one missing a capability, fails and names the missing events', async () => {
  const { assertEnvironmentLedger } = await checker();
  assert.equal(assertEnvironmentLedger([], { projectId: PROJECT }).ok, false);
  for (const skipped of ['lsp', 'dap', 'browser', 'computer', 'memory']) {
    const journey = await populate({ only: ['lsp', 'dap', 'browser', 'computer', 'memory'].filter((name) => name !== skipped) });
    try {
      const verdict = assertEnvironmentLedger(journey.rows(), { projectId: PROJECT });
      assert.equal(verdict.ok, false, skipped);
      assert.ok(rulesOf(verdict).has('required_events'), skipped);
      // Limiting the check to the capabilities that ran is explicit, and then it passes.
      const partial = assertEnvironmentLedger(journey.rows(), {
        projectId: PROJECT,
        capabilities: ['lsp', 'dap', 'browser', 'computer', 'memory'].filter((name) => name !== skipped),
      });
      assert.equal(partial.ok, true, `${skipped}: ${JSON.stringify(partial.violations)}`);
    } finally {
      journey.close();
    }
  }
});

test('adversarial rows are rejected for their own rule', async () => {
  const { assertEnvironmentLedger } = await checker();
  const journey = await populate();
  try {
    const rows = journey.rows();
    const find = (copy, type, outcome) =>
      copy.find((row) => row.event_type === type && (outcome === undefined || row.payload.outcome === outcome));
    const outcomeRow = (outcome) => (copy) => find(copy, 'environment.computer.approval_outcome', outcome);
    const drop = (copy, row) => copy.splice(copy.indexOf(row), 1);
    // A second action that ran after the first one, with no approval of its own.
    const secondAction = (copy) => {
      const first = find(copy, 'environment.computer.action_executed');
      copy.push({ ...structuredClone(first), position: 10_000, payload: { ...first.payload, seq: 2 } });
    };
    const cases = [
      ['aggregate', (copy) => (find(copy, 'memory.written').aggregate_type = 'environment_session')],
      ['project_scope', (copy) => delete find(copy, 'environment.lsp.completed').payload.project_id],
      ['project_scope', (copy) => (find(copy, 'environment.lsp.completed').payload.project_id = 'another-project')],
      ['project_scope', (copy) => (find(copy, 'memory.deleted').aggregate_id = 'another-project')],
      ['memory_delete_approval', (copy) => delete find(copy, 'memory.deleted').payload.approval_id],
      ['memory_delete_order', (copy) => (find(copy, 'memory.deleted').payload.memory_id = 'another-note')],
      ['memory_delete_order', (copy) => (find(copy, 'memory.deleted').position = find(copy, 'memory.written').position - 1)],
      ['computer_approval_order', (copy) => drop(copy, outcomeRow('requested')(copy))],
      ['computer_approval_order', (copy) => drop(copy, outcomeRow('approved')(copy))],
      ['computer_approval_order', (copy) => drop(copy, outcomeRow('consumed')(copy))],
      ['computer_approval_order', (copy) => (outcomeRow('consumed')(copy).payload.request_id = 'another-request')],
      ['computer_approval_order', (copy) => (find(copy, 'environment.computer.action_executed').position = 0)],
      ['computer_approval_order', secondAction],
      // A valid request for another step, action, session or digest does not authorise this action: each of these leaves
      // the one real approval chain untouched and moves only the action (or one outcome) away from it.
      ['computer_approval_order', (copy) => (find(copy, 'environment.computer.action_executed').payload.seq = 2)],
      ['computer_approval_order', (copy) => (find(copy, 'environment.computer.action_executed').payload.action = 'move')],
      ['computer_approval_order', (copy) => (find(copy, 'environment.computer.action_executed').payload.session_id = 's2')],
      ['computer_approval_order', (copy) => (outcomeRow('approved')(copy).payload.binding_digest = 'd'.repeat(64))],
      ['computer_approval_order', (copy) => (outcomeRow('consumed')(copy).payload.binding_digest = 'd'.repeat(64))],
      // A write of the same memory id in another stream does not satisfy this stream's delete.
      ['memory_delete_order', (copy) => (find(copy, 'memory.written').aggregate_id = 'another-project')],
      // The same step executed twice spends one approval twice.
      [
        'computer_approval_order',
        (copy) => {
          const first = find(copy, 'environment.computer.action_executed');
          copy.push({ ...structuredClone(first), position: 10_001 });
        },
      ],
    ];
    for (const [rule, mutate] of cases) {
      const copy = structuredClone(rows);
      mutate(copy);
      const verdict = assertEnvironmentLedger(copy, { projectId: PROJECT });
      assert.equal(verdict.ok, false, `${rule}: ${mutate}`);
      assert.ok(rulesOf(verdict).has(rule), `${rule}: ${JSON.stringify(verdict.violations)}`);
    }
    // The second action does reuse a request, which is what the rule names.
    const reused = structuredClone(rows);
    secondAction(reused);
    assert.match(JSON.stringify(assertEnvironmentLedger(reused, { projectId: PROJECT }).violations), /no requested outcome|reuses/);
    assert.equal(assertEnvironmentLedger(rows, { projectId: PROJECT }).ok, true, 'the untouched rows still pass');
    assert.throws(() => assertEnvironmentLedger(rows), TypeError, 'the project of the sink is required');
  } finally {
    journey.close();
  }
});
