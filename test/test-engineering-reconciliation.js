'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const { createEngineeringExample } = require('../tools/examples/engineering-task');
const { runEngineeringTask, inspectEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { RelationalSessionEventStore } = require('../packages/agent-session-store');

async function interruptedWrite(run, workflow = false, crashMode = 'write', project = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-reconcile-'));
  const example = project
    ? structuredClone(require('../tools/examples/project-task').createProjectExample('typescript-report', directory))
    : structuredClone(createEngineeringExample('addition'));
  example.contract.limits.max_tokens = 500_000;
  example.contract.limits.max_duration_ms = 120_000;
  fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(example.contract));
  fs.writeFileSync(path.join(directory, 'responses.json'), JSON.stringify(example.responses));
  let created;
  try {
    created = workflow
      ? await require('../tools/cli/lib/engineering-workflow-runtime').runEngineeringWorkflow({
          definition: {
            schema_version: 1,
            workflow_id: 'workflow:reconciliation',
            max_parallelism: 1,
            limits: { ...example.contract.limits, max_children: 1, max_workflow_steps: 1 },
            tasks: [{ id: 'addition', contract: example.contract, responses: example.responses, depends_on: [] }],
          },
          createOnly: true,
        })
      : await runEngineeringTask({
          taskContract: path.join(directory, 'task.json'),
          scriptedResponses: path.join(directory, 'responses.json'),
          createOnly: true,
        });
    const script = `
      const fs=require('node:fs'); const original=fs.renameSync;
      fs.renameSync=function(from,to) {const result=original(from,to); if(${JSON.stringify(crashMode)}==='write' && to.startsWith(${JSON.stringify(created.state + '/')} ) && to.includes('/workspace/')) process.kill(process.pid,'SIGKILL'); return result;};
      if (${JSON.stringify(crashMode)}==='model') {
        const {ScriptedModelProvider}=require(${JSON.stringify(path.resolve(__dirname, '../packages/model-providers'))});
        const originalStream=ScriptedModelProvider.prototype.stream;
        ScriptedModelProvider.prototype.stream=function(input) {const source=originalStream.call(this,input); return {async *[Symbol.asyncIterator]() {for await(const event of source) {yield event; process.kill(process.pid,'SIGKILL');}}};};
      }
      if (${JSON.stringify(crashMode)}==='command') {
        const executor=require(${JSON.stringify(path.resolve(__dirname, '../packages/agent-isolation-attestation/executor'))});
        const execute=executor.executeIsolatedCommand;
        executor.executeIsolatedCommand=async function(input) {const result=await execute(input); if(input.command.includes('./add.js') || input.command.includes('./scripts/check.ts')) process.kill(process.pid,'SIGKILL');return result;};
      }
      require(${JSON.stringify(path.resolve(__dirname, workflow ? '../tools/cli/lib/engineering-workflow-runtime' : '../tools/cli/lib/engineering-task-runtime'))}).${workflow ? 'inspectEngineeringWorkflow' : 'inspectEngineeringTask'}({state:${JSON.stringify(created.state)},action:'resume',expectedSequence:${created.current_sequence}}).catch(error=>{console.error(error);process.exitCode=1;});
    `;
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const [code, signal] = await once(child, 'close');
    assert.equal(signal, 'SIGKILL', `${code}: ${stderr}`);
    await run(created);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    if (created) fs.rmSync(created.state, { recursive: true, force: true });
  }
}

function session(directory, id) {
  const handle = openExecutionLedgerFileFixture(directory);
  try {
    return new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) }).replay(id);
  } finally {
    handle.close();
  }
}

test('a committed write interrupted before its receipt is reconciled without repeating the effect', () =>
  interruptedWrite(async (created) => {
    const preview = await inspectEngineeringTask({ state: created.state, action: 'reconcile' });
    assert.deepEqual(preview.questions, []);
    assert.equal(preview.reconciliation.verification.approved, true);
    const before = session(created.state, created.session_id);
    const result = await inspectEngineeringTask({ state: created.state, action: 'resume', expectedSequence: preview.current_sequence });
    assert.equal(result.task_result, 'approved', JSON.stringify(result));
    const after = session(created.state, created.session_id);
    assert.equal(Object.values(after.tool_invocations).filter((tool) => tool.name === 'engineering.write').length, 1);
    assert.equal(after.turn_order.length, 2);
    assert.deepEqual(after.spec, before.spec);
    assert.ok(after.reconciliation_reports.length === 1);
  }));

test('unexplained changes always ask, reject stale decisions, and continue only after explicit current-state confirmation', () =>
  interruptedWrite(async (created) => {
    const filename = path.join(created.state, 'workspace', 'add.js');
    fs.writeFileSync(filename, 'module.exports = (a,b) => a+b; // externally adjusted\n');
    const status = await inspectEngineeringTask({ state: created.state });
    const blocked = await inspectEngineeringTask({ state: created.state, action: 'resume', expectedSequence: status.current_sequence });
    assert.equal(blocked.task_result, 'blocked');
    assert.ok(blocked.questions.length > 0);
    const before = session(created.state, created.session_id);
    assert.equal(before.reconciliation_reports, undefined);
    await assert.rejects(
      inspectEngineeringTask({
        state: created.state,
        action: 'resume',
        expectedSequence: blocked.current_sequence,
        reconciliationDecision: {
          report_sha256: '0'.repeat(64),
          decision: 'continue-from-observed-state',
          answer: 'I recognize this change.',
        },
      }),
      /current reconciliation|stale/,
    );
    assert.deepEqual(session(created.state, created.session_id), before);
    const result = await inspectEngineeringTask({
      state: created.state,
      action: 'resume',
      expectedSequence: blocked.current_sequence,
      reconciliationDecision: {
        report_sha256: blocked.reconciliation.sha256,
        decision: 'continue-from-observed-state',
        answer: 'I made this adjustment and authorize using the inspected state.',
      },
    });
    assert.equal(result.task_result, 'approved', JSON.stringify(result));
    assert.equal(
      Object.values(session(created.state, created.session_id).tool_invocations).filter((tool) => tool.name === 'engineering.write').length,
      1,
    );
  }));

test('workflow recovery composes reconciliation without repeating the interrupted write', () =>
  interruptedWrite(async (created) => {
    const { inspectEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
    const preview = await inspectEngineeringWorkflow({ state: created.state, action: 'reconcile' });
    assert.deepEqual(preview.questions, []);
    assert.ok(preview.reconciliations.addition);
    const result = await inspectEngineeringWorkflow({ state: created.state, action: 'resume', expectedSequence: preview.current_sequence });
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.equal(result.tasks[0].result, 'approved');
    const child = session(created.state, created.tasks[0].session_id);
    assert.equal(Object.values(child.tool_invocations).filter((tool) => tool.name === 'engineering.write').length, 1);
    assert.ok(Object.values(result.budget).every((budget) => budget.spent <= budget.ceiling));
  }, true));

for (const crashMode of ['command', 'model']) {
  test(`interrupted ${crashMode} asks before abandoning the attempt and preserves its budget`, () =>
    interruptedWrite(
      async (created) => {
        const preview = await inspectEngineeringTask({ state: created.state, action: 'reconcile' });
        assert.ok(preview.questions.length > 0);
        const before = session(created.state, created.session_id);
        const blocked = await inspectEngineeringTask({
          state: created.state,
          action: 'resume',
          expectedSequence: preview.current_sequence,
        });
        assert.equal(blocked.task_result, 'blocked');
        assert.deepEqual(session(created.state, created.session_id), before);
        const result = await inspectEngineeringTask({
          state: created.state,
          action: 'resume',
          expectedSequence: preview.current_sequence,
          reconciliationDecision: {
            report_sha256: preview.reconciliation.sha256,
            decision: 'continue-from-observed-state',
            answer: 'Abandon the interrupted attempt; continue from the verified current state without replay.',
          },
        });
        assert.equal(result.task_result, 'approved', JSON.stringify(result));
        const after = session(created.state, created.session_id);
        assert.deepEqual(after.spec, before.spec);
        assert.equal(Object.values(after.tool_invocations).filter((tool) => tool.name === 'engineering.command').length, 1);
        assert.ok(result.token_accounting.total_tokens >= preview.reconciliation.token_accounting.total_tokens);
      },
      false,
      crashMode,
    ));
}

test('a project patch interrupted after its effect requires a decision and is never automatically repeated', () =>
  interruptedWrite(
    async (created) => {
      const preview = await inspectEngineeringTask({ state: created.state, action: 'reconcile' });
      assert.ok(preview.questions.some((question) => question.includes('patch')));
      assert.equal(preview.reconciliation.verification.approved, true);
      const blocked = await inspectEngineeringTask({ state: created.state, action: 'resume', expectedSequence: preview.current_sequence });
      assert.equal(blocked.reason, 'effect-reconciliation-required');
      const result = await inspectEngineeringTask({
        state: created.state,
        action: 'resume',
        expectedSequence: blocked.current_sequence,
        reconciliationDecision: {
          report_sha256: blocked.reconciliation.sha256,
          decision: 'continue-from-observed-state',
          answer: 'Continue using the observed files; do not repeat the uncertain patch.',
        },
      });
      assert.equal(result.task_result, 'approved', JSON.stringify(result));
      const state = session(created.state, created.session_id);
      assert.equal(Object.values(state.tool_invocations).filter((tool) => tool.name === 'engineering.patch').length, 1);
    },
    false,
    'write',
    true,
  ));

test('a completed patch receipt explains its change when a later command is interrupted', () =>
  interruptedWrite(
    async (created) => {
      const preview = await inspectEngineeringTask({ state: created.state, action: 'reconcile' });
      assert.equal(preview.reconciliation.verification.approved, true);
      assert.ok(preview.questions.length > 0);
      assert.ok(!preview.questions.some((question) => question.includes('mudou em relação aos efeitos')));
    },
    false,
    'command',
    true,
  ));
