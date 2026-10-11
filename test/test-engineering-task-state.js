'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { EngineeringTaskState, engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const { createExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const contract = require('./fixtures/engineering-task/addition.json');

function fixture(check) {
  const handle = createExecutionLedgerFileFixture();
  const task = new EngineeringTaskState(handle.db, randomUUID());
  try {
    const creation = {
      kind: 'created',
      contract,
      contract_sha256: engineeringDigest(contract),
      session_id: 'session:fixture',
      deadline: Date.now() + 1000,
      responses: [],
    };
    check(task, creation);
  } finally {
    handle.cleanup();
  }
}

test('invalid creation never poisons the durable stream', () =>
  fixture((task, creation) => {
    assert.throws(() => task.append({ ...creation, contract_sha256: 'wrong' }, 0));
    assert.equal(task.read().version, 0);
    task.append(creation, 0);
    assert.equal(task.read().version, 1);
  }));

test('snapshots require complete unique scope and accurate content digests', () =>
  fixture((task, creation) => {
    task.append(creation, 0);
    task.append({ kind: 'execution_started' }, 1);
    const missing = { path: 'add.js', content: null, sha256: null };
    for (const files of [[], [missing, missing], [{ ...missing, path: '../private' }], [{ ...missing, content: 'changed' }]]) {
      assert.throws(() => task.append({ kind: 'snapshot', files, files_sha256: engineeringDigest(files) }, 2));
      assert.equal(task.read().version, 2);
    }
    task.append({ kind: 'snapshot', files: [missing], files_sha256: engineeringDigest([missing]) }, 2);
    assert.equal(task.read().snapshot.files.length, 1);
  }));

test('approval requires versioned proof bound to contract, artifacts, session and isolation', () =>
  fixture((task, creation) => {
    task.append(creation, 0);
    task.append({ kind: 'execution_started' }, 1);
    const files = [{ path: 'add.js', content: null, sha256: null }];
    task.append({ kind: 'snapshot', files, files_sha256: engineeringDigest(files) }, 2);
    const event = { kind: 'result', result: 'approved', reason: 'criteria-satisfied', evidence: {} };
    assert.throws(() => task.append(event, 3));
    assert.equal(task.read().version, 3);
    task.append({ kind: 'cancellation_requested' }, 3);
    assert.throws(() =>
      task.append(
        {
          ...event,
          evidence: {
            schema_version: 1,
            approved: true,
            contract_sha256: creation.contract_sha256,
            session_id: creation.session_id,
            files_sha256: engineeringDigest(files),
            verifier_sha256: contract.verifier.sha256,
            isolation_digest: '0'.repeat(64),
            workspace_access: 'read_only',
            descendants_terminated: true,
          },
        },
        4,
      ),
    );
    task.append({ kind: 'result', result: 'not_executed', reason: 'cancelled', evidence: {} }, 4);
    assert.throws(() => task.append({ kind: 'execution_started' }, 5));
  }));
test('approval is refused without a passing entry for every declared acceptance command', () => {
  const { fixture: project } = require('./helpers/engineering-project');
  const { projectVerifierDigest } = require('../tools/cli/lib/engineering-project-verifier');
  const { readEngineeringTask } = require('../tools/cli/lib/engineering-task-contract');
  const f = project({ after() {} }, { files: { 'index.js': 'module.exports = (n) => n + 1;\n', 'check.js': 'process.exit(0);' } });
  Object.assign(f.contract.verifier, { command_checks: [{ command_id: 'check' }], protected_paths: ['check.js'] });
  f.contract.commands = [{ id: 'check', runtime: 'node', entrypoint: 'check.js', args: [] }];
  f.contract.scope.write = ['index.js'];
  f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
  f.save();
  const declared = readEngineeringTask(f.filename).contract;
  const handle = createExecutionLedgerFileFixture();
  try {
    const attempt = (checks) => {
      const task = new EngineeringTaskState(handle.db, randomUUID());
      const creation = {
        kind: 'created',
        contract: declared,
        contract_sha256: engineeringDigest(declared),
        session_id: 'session:fixture',
        deadline: Date.now() + 1000,
        responses: [],
      };
      task.append(creation, 0);
      task.append({ kind: 'execution_started' }, 1);
      const files = declared.scope.read.map((name) => ({ path: name, content: null, sha256: null }));
      task.append({ kind: 'snapshot', files, files_sha256: engineeringDigest(files) }, 2);
      const evidence = {
        schema_version: 1,
        approved: true,
        contract_sha256: creation.contract_sha256,
        session_id: creation.session_id,
        files_sha256: engineeringDigest(files),
        verifier_sha256: declared.verifier.sha256,
        isolation_digest: '0'.repeat(64),
        workspace_access: 'read_only',
        descendants_terminated: true,
        ...(checks ? { command_checks: checks } : {}),
      };
      task.append({ kind: 'result', result: 'approved', reason: 'criteria-satisfied', evidence }, 3);
      return task.read().result;
    };
    const check = { command_id: 'check', status: 'succeeded', exit_code: 0 };
    assert.throws(() => attempt());
    assert.throws(() => attempt([]));
    assert.throws(() => attempt([{ ...check, exit_code: 1 }]));
    assert.throws(() => attempt([{ ...check, status: 'failed' }]));
    assert.throws(() => attempt([{ ...check, command_id: 'other' }]));
    assert.equal(attempt([check]).result, 'approved');
  } finally {
    handle.cleanup();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
test('cancellation acquires the writer lock before reading evidence across connections', () =>
  fixture((task, creation) => {
    const path = require('node:path');
    const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
    const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
    task.append(creation, 0);
    task.append({ kind: 'execution_started' }, 1);
    const other = openExecutionLedgerFileFixture(path.dirname(task.ledger.db.name));
    try {
      other.db.pragma('busy_timeout = 0');
      const ledger = new ExecutionEventLedger(other.db),
        id = randomUUID();
      const request = {
        aggregate_type: 'control_task',
        aggregate_id: id,
        expected_version: 0,
        events: [
          {
            event_id: randomUUID(),
            event_type: 'ControlCommandRecorded',
            schema_version: 1,
            occurred_at: new Date().toISOString(),
            correlation_id: id,
            causation_id: id,
            actor: { type: 'hseos', id: 'competing-writer' },
            operation_id: null,
            payload: { kind: 'fixture-concurrent-write' },
            evidence_refs: [],
          },
        ],
      };
      const read = task.read.bind(task);
      let competingError;
      task.read = () => {
        const state = read();
        try {
          ledger.append(request);
        } catch (error) {
          competingError = error;
        }
        return state;
      };
      task.append({ kind: 'cancellation_requested' }, 2);
      task.read = read;
      assert.equal(competingError?.code, 'SQLITE_BUSY');
      assert.equal(task.read().cancellation, true);
      assert.equal(ledger.append(request).current_version, 1);
      assert.throws(() => task.append({ kind: 'uncertainty', question: 'stale' }, 2), /concurrency conflict/);
    } finally {
      other.close();
    }
  }));
