'use strict';
const assert = require('node:assert/strict');
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
