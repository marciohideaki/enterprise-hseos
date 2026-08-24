'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { createExecutionLedgerFileFixture, openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const {
  captureStateSnapshot,
  decodeStateSnapshot,
  promoteStateSnapshot,
  restoreStateSnapshot,
} = require('../tools/cli/lib/bound-kernel-state-snapshot');

function stateFixture(t, value) {
  const handle = createExecutionLedgerFileFixture();
  fs.writeFileSync(path.join(handle.directory, 'bound-kernel-agent.json'), JSON.stringify({ value }), { mode: 0o600 });
  fs.mkdirSync(path.join(handle.directory, 'workspace'), { mode: 0o700 });
  fs.writeFileSync(path.join(handle.directory, 'workspace', 'world-state.json'), JSON.stringify({ value }), { mode: 0o600 });
  handle.close();
  t.after(() => {
    if (fs.existsSync(handle.directory)) {
      const reopened = openExecutionLedgerFileFixture(handle.directory);
      reopened.cleanup();
    }
  });
  return handle.directory;
}

test('state snapshot round-trips the ledger, manifest and workspace with integrity', (t) => {
  const source = stateFixture(t, 'before');
  const snapshot = captureStateSnapshot(source);
  const restored = restoreStateSnapshot(snapshot);
  t.after(() => {
    if (fs.existsSync(restored)) openExecutionLedgerFileFixture(restored).cleanup();
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restored, 'bound-kernel-agent.json'), 'utf8')), { value: 'before' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restored, 'workspace', 'world-state.json'), 'utf8')), { value: 'before' });
  openExecutionLedgerFileFixture(restored).close();
});

test('state snapshot rejects digest tampering before materialization', (t) => {
  const source = stateFixture(t, 'safe');
  const snapshot = captureStateSnapshot(source);
  assert.throws(() => decodeStateSnapshot({ ...snapshot, sha256: '0'.repeat(64) }), /digest does not match/);
});

test('state snapshot promotion preserves the state path and validates before replacement', (t) => {
  const target = stateFixture(t, 'old');
  const replacement = stateFixture(t, 'new');
  const snapshot = captureStateSnapshot(replacement);
  const promoted = promoteStateSnapshot(snapshot, target, (candidate) => {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(candidate, 'bound-kernel-agent.json'), 'utf8')), { value: 'new' });
  });
  assert.equal(promoted, target);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'bound-kernel-agent.json'), 'utf8')), { value: 'new' });
});
