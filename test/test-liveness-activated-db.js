'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const Database = require('better-sqlite3');

const liveness = require('../tools/lib/agent-liveness');
const command = require('../tools/cli/commands/liveness');
const { activateExecutionLedger, openOperationalStateDatabase } = require('../tools/mcp-project-state/lib/operational-state-db');

const NOW = () => Date.parse('2026-10-22T12:00:00.000Z');
const NO_IO = { now: () => NOW(), sleep: async () => {}, notify: () => {}, reconcile: { listTmux: () => [], listPids: () => [] } };

function makeProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-liveness-activated-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.hseos', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, '.hseos', 'config', 'agent-liveness.yaml'), 'enabled: true\n');
  const decisions = path.join(root, 'decisions');
  fs.mkdirSync(decisions);
  fs.writeFileSync(path.join(decisions, 'ADR-0048-criterion.md'), '# ADR-0048: criterion\n\n## Status\n\nAccepted — 2026-10-22\n');
  return { root, decisions, databasePath: path.join(root, '.hseos', 'state', 'project.db') };
}

function seedV4(project) {
  openOperationalStateDatabase(project.databasePath).close();
}

async function activate(t) {
  const project = makeProject(t);
  seedV4(project);
  await activateExecutionLedger(project.databasePath, {
    adr: 'ADR-0048',
    backupDir: path.join(project.root, 'backups'),
    now: NOW,
    internal: { decisionsDirectory: project.decisions, criterionAdrs: ['ADR-0048'] },
  });
  return project;
}

function record(directory) {
  const db = liveness.openLivenessDb(directory, { write: true });
  try {
    return liveness.recordEvent(db, { session: 's1', agent: 'a1', kind: 'heartbeat', now: NOW() });
  } finally {
    db.close();
  }
}

test('an activated database opens for writing through the governed path and keeps its activation', async (t) => {
  const project = await activate(t);
  assert.ok(record(project.root).id > 0);
  const db = new Database(project.databasePath, { readonly: true });
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 17);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM as_liveness_events').get().n, 1);
  } finally {
    db.close();
  }
  const readonly = liveness.openLivenessDb(project.root);
  try {
    assert.equal(readonly.prepare('SELECT COUNT(*) AS n FROM as_liveness_events').get().n, 1);
  } finally {
    readonly.close();
  }
});

test('liveness watch --once succeeds on an activated database', async (t) => {
  const project = await activate(t);
  const result = await command._internal.run('watch', { directory: project.root, once: true }, NO_IO);
  assert.equal(result.code, 0);
});

test('a v4 database still opens through the legacy path', (t) => {
  const project = makeProject(t);
  seedV4(project);
  assert.ok(record(project.root).id > 0);
  const db = new Database(project.databasePath, { readonly: true });
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 4);
  } finally {
    db.close();
  }
});

test('a database with every execution table at v17 but no activation marker is refused', async (t) => {
  const project = await activate(t);
  const raw = new Database(project.databasePath);
  raw.pragma('application_id = 0');
  raw.close();
  assert.throws(() => liveness.openLivenessDb(project.root, { write: true }), { code: 'EXECUTION_ACTIVATION_PENDING' });
});

test('a pending or invalid database is still refused with EXECUTION_ACTIVATION_PENDING', (t) => {
  const pendingTables = makeProject(t);
  seedV4(pendingTables);
  const raw = new Database(pendingTables.databasePath);
  raw.exec('CREATE TABLE execution_events (id INTEGER PRIMARY KEY)');
  raw.close();
  assert.throws(() => liveness.openLivenessDb(pendingTables.root, { write: true }), { code: 'EXECUTION_ACTIVATION_PENDING' });

  const newerVersion = makeProject(t);
  seedV4(newerVersion);
  const bumped = new Database(newerVersion.databasePath);
  bumped.pragma('user_version = 17');
  bumped.close();
  assert.throws(() => liveness.openLivenessDb(newerVersion.root, { write: true }), { code: 'EXECUTION_ACTIVATION_PENDING' });
});
