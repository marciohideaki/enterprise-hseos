'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const Database = require('better-sqlite3');

const {
  OPERATIONAL_SCHEMA_VERSION,
  activateExecutionLedger,
  assertOperationalSchemaBoundary,
  openOperationalStateDatabase,
  planExecutionLedgerActivation,
  restoreExecutionLedgerBackup,
} = require('../tools/mcp-project-state/lib/operational-state-db');

const ACTIVATED_VERSION = 17;
const NOW = () => Date.parse('2026-10-22T12:00:00.000Z');

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function makeSandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-ledger-activation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decisions = path.join(root, 'decisions');
  fs.mkdirSync(decisions);
  fs.writeFileSync(path.join(decisions, 'ADR-9001-accepted.md'), '# ADR-9001: ok\n\n## Status\n\nAccepted — 2026-10-22. Owner approved.\n');
  fs.writeFileSync(
    path.join(decisions, 'ADR-9002-legacy.md'),
    '# ADR-9002 — legacy format\n\n**Status:** Accepted (human-approved 2026-08-21)\n',
  );
  fs.writeFileSync(
    path.join(decisions, 'ADR-9003-proposed.md'),
    '# ADR-9003: later\n\n## Status\n\nProposed — 2026-10-22. Aguarda decisão.\n',
  );
  fs.writeFileSync(path.join(decisions, 'ADR-9004-superseded.md'), '# ADR-9004\n\n**Status:** Superseded by ADR-9001\n');
  return { root, decisions, backups: path.join(root, 'backups'), internal: { decisionsDirectory: decisions } };
}

function makeV4Database(root, name = 'project.db') {
  const databasePath = path.join(root, 'state', name);
  const db = openOperationalStateDatabase(databasePath);
  db.prepare("INSERT INTO state (key, value) VALUES ('phase', 'closeout')").run();
  db.prepare("INSERT INTO tasks (id, owner, description) VALUES ('T1', 'SWARM', 'real row')").run();
  db.prepare("INSERT INTO state_history (key, old_value, new_value, changed_by) VALUES ('phase', 'a', 'b', 'test')").run();
  db.prepare("INSERT INTO as_runs (id, workflow_id, project) VALUES ('run-1', 'dev-squad', 'enterprise-hseos')").run();
  assert.equal(db.pragma('user_version', { simple: true }), OPERATIONAL_SCHEMA_VERSION);
  db.close();
  return databasePath;
}

/** Row-level dump of the operational (001-004) tables, independent of file bytes. */
function dumpOperational(databasePath) {
  const db = new Database(databasePath, { readonly: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'execution_%' AND sql NOT LIKE 'CREATE VIRTUAL%' ORDER BY name",
      )
      .all()
      .map(({ name }) => name);
    const rows = (name) => {
      try {
        return db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
      } catch {
        return db.prepare(`SELECT * FROM "${name}"`).all(); // WITHOUT ROWID shadow tables
      }
    };
    return Object.fromEntries(tables.map((name) => [name, rows(name)]));
  } catch (error) {
    db.close();
    throw error;
  } finally {
    if (db.open) db.close();
  }
}

function executionTables(databasePath) {
  const db = new Database(databasePath, { readonly: true });
  try {
    return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'execution_%'").all();
  } finally {
    db.close();
  }
}

function userVersion(databasePath) {
  const db = new Database(databasePath, { readonly: true });
  try {
    return db.pragma('user_version', { simple: true });
  } finally {
    db.close();
  }
}

async function rejectsWithCode(promiseOrFn, code) {
  await assert.rejects(
    async () => (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn),
    (error) => {
      assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
      return true;
    },
  );
}

/** Corrupts a table row without touching its index so PRAGMA integrity_check fails while SQLite still opens the file. */
function corruptIndexConsistency(databasePath) {
  const db = new Database(databasePath);
  db.exec('DROP TABLE IF EXISTS canary; CREATE TABLE canary (v TEXT); CREATE INDEX canary_v ON canary (v)');
  db.prepare('INSERT INTO canary (v) VALUES (?)').run('canary-needle-AAAA');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  const bytes = fs.readFileSync(databasePath);
  const needle = Buffer.from('canary-needle-AAAA');
  const first = bytes.indexOf(needle);
  assert.ok(first > 0, 'canary row must be present in the file');
  Buffer.from('canary-needle-BBBB').copy(bytes, first);
  fs.writeFileSync(databasePath, bytes);
  const check = new Database(databasePath, { readonly: true });
  try {
    assert.notEqual(check.pragma('integrity_check', { simple: true }), 'ok', 'fixture must fail integrity_check');
  } finally {
    check.close();
  }
}

test('apply keeps every original row, reaches v17 and the legacy boundary refuses the activated database', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const before = dumpOperational(databasePath);

  const result = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });

  assert.equal(result.dry_run, false);
  assert.equal(userVersion(databasePath), ACTIVATED_VERSION);
  assert.ok(executionTables(databasePath).length >= 7);
  assert.deepEqual(dumpOperational(databasePath), before);
  assert.equal(result.receipt.user_version_before, OPERATIONAL_SCHEMA_VERSION);
  assert.equal(result.receipt.user_version_after, ACTIVATED_VERSION);
  assert.equal(result.receipt.adr, 'ADR-9001');
  assert.equal(result.receipt.adr_status, 'Accepted');
  assert.equal(result.receipt.started_at, '2026-10-22T12:00:00.000Z');
  assert.equal(result.receipt.finished_at, '2026-10-22T12:00:00.000Z');
  assert.equal(result.receipt.applied_migrations.length, 13);
  assert.match(result.receipt.applied_migrations[0], /^005-/);
  assert.match(result.receipt.applied_migrations[12], /^017-/);
  assert.match(result.receipt.original_sha256_before, /^[0-9a-f]{64}$/);
  assert.match(result.receipt.backup_sha256, /^[0-9a-f]{64}$/);
  assert.equal(sha256(result.backup_path), result.receipt.backup_sha256);
  assert.ok(path.basename(result.backup_path).startsWith('20261022T120000Z-'));
  assert.deepEqual(JSON.parse(fs.readFileSync(result.receipt_path, 'utf8')), result.receipt);

  const legacy = new Database(databasePath);
  t.after(() => legacy.close());
  assert.throws(
    () => assertOperationalSchemaBoundary(legacy),
    (error) => error.code === 'EXECUTION_ACTIVATION_PENDING',
  );
  assert.throws(
    () => openOperationalStateDatabase(databasePath),
    (error) => error.code === 'EXECUTION_ACTIVATION_PENDING',
  );
});

test('both ADR status layouts used in the repository are accepted', async (t) => {
  const sandbox = makeSandbox(t);
  for (const adr of ['ADR-9001', 'ADR-9002']) {
    const databasePath = makeV4Database(sandbox.root, `${adr}.db`);
    const plan = planExecutionLedgerActivation(databasePath, { adr, internal: sandbox.internal });
    assert.equal(plan.adr_status, 'Accepted');
  }
});

test('rollback restores v4, preserves the activated database and matches the pre-activation content', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const before = dumpOperational(databasePath);
  const original = sha256(databasePath);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  assert.equal(activation.receipt.original_sha256_before, original);

  const restored = await restoreExecutionLedgerBackup(databasePath, {
    backupPath: activation.backup_path,
    expectedSha256: activation.receipt.backup_sha256,
    now: NOW,
  });

  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);
  assert.equal(executionTables(databasePath).length, 0);
  assert.deepEqual(dumpOperational(databasePath), before);
  assert.equal(sha256(databasePath), activation.receipt.backup_sha256);
  assert.equal(restored.content_matches_original, true);
  assert.equal(userVersion(restored.preserved_activated_path), ACTIVATED_VERSION);
  assert.match(path.basename(restored.preserved_activated_path), /^project\.db\.activated-20261022T120000Z$/);
  const legacy = openOperationalStateDatabase(databasePath);
  legacy.close();
});

test('rollback refuses a backup whose sha256 differs from the expected digest', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  const activatedSha = sha256(databasePath);
  fs.appendFileSync(activation.backup_path, Buffer.from('tampered'));

  await rejectsWithCode(
    restoreExecutionLedgerBackup(databasePath, { backupPath: activation.backup_path, expectedSha256: activation.receipt.backup_sha256 }),
    'EXECUTION_ACTIVATION_BACKUP_HASH_MISMATCH',
  );
  assert.equal(sha256(databasePath), activatedSha, 'the activated database must not be touched');
  assert.equal(userVersion(databasePath), ACTIVATED_VERSION);
});

test('rollback refuses a missing expected digest', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  await rejectsWithCode(
    restoreExecutionLedgerBackup(databasePath, { backupPath: activation.backup_path }),
    'EXECUTION_ACTIVATION_BACKUP_HASH_REQUIRED',
  );
});

test('rollback refuses a backup that fails integrity_check even when its digest matches', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  corruptIndexConsistency(activation.backup_path);
  const activatedSha = sha256(databasePath);

  await rejectsWithCode(
    restoreExecutionLedgerBackup(databasePath, { backupPath: activation.backup_path, expectedSha256: sha256(activation.backup_path) }),
    'EXECUTION_ACTIVATION_INTEGRITY_FAILED',
  );
  assert.equal(sha256(databasePath), activatedSha);
});

test('apply refuses a database that fails integrity_check and writes no backup', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  corruptIndexConsistency(databasePath);
  const before = sha256(databasePath);

  await rejectsWithCode(
    activateExecutionLedger(databasePath, { adr: 'ADR-9001', backupDir: sandbox.backups, now: NOW, internal: sandbox.internal }),
    'EXECUTION_ACTIVATION_INTEGRITY_FAILED',
  );
  assert.equal(sha256(databasePath), before);
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);
});

test('apply refuses ADR Proposed, Superseded, unknown, malformed and missing identifiers', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const before = sha256(databasePath);
  for (const adr of ['ADR-9003', 'ADR-9004', 'ADR-9999', '../ADR-9001', 'ADR-9001/../x', '']) {
    await rejectsWithCode(
      activateExecutionLedger(databasePath, { adr, backupDir: sandbox.backups, now: NOW, internal: sandbox.internal }),
      'EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED',
    );
  }
  await rejectsWithCode(
    activateExecutionLedger(databasePath, { backupDir: sandbox.backups, now: NOW, internal: sandbox.internal }),
    'EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED',
  );
  assert.equal(sha256(databasePath), before);
  assert.equal(fs.existsSync(sandbox.backups), false, 'no backup directory is created before the gate passes');
});

test('apply refuses without a backup directory', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  await rejectsWithCode(
    activateExecutionLedger(databasePath, { adr: 'ADR-9001', now: NOW, internal: sandbox.internal }),
    'EXECUTION_ACTIVATION_BACKUP_DIR_REQUIRED',
  );
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);
});

test('apply refuses a missing database, a symlink and a hardlink', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const options = { adr: 'ADR-9001', backupDir: sandbox.backups, now: NOW, internal: sandbox.internal };

  await rejectsWithCode(activateExecutionLedger(path.join(sandbox.root, 'absent.db'), options), 'EXECUTION_ACTIVATION_DB_NOT_FOUND');

  const symlinkPath = path.join(sandbox.root, 'symlink.db');
  fs.symlinkSync(databasePath, symlinkPath);
  await rejectsWithCode(activateExecutionLedger(symlinkPath, options), 'EXECUTION_ACTIVATION_DB_NOT_REGULAR');

  const hardlinkPath = path.join(sandbox.root, 'hardlink.db');
  fs.linkSync(databasePath, hardlinkPath);
  await rejectsWithCode(activateExecutionLedger(hardlinkPath, options), 'EXECUTION_ACTIVATION_DB_NOT_REGULAR');
  await rejectsWithCode(activateExecutionLedger(databasePath, options), 'EXECUTION_ACTIVATION_DB_NOT_REGULAR');
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);
});

test('apply refuses while another connection holds a write transaction, then succeeds after release', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const options = { adr: 'ADR-9001', backupDir: sandbox.backups, now: NOW, internal: sandbox.internal };
  const holder = new Database(databasePath);
  holder.exec('BEGIN IMMEDIATE');
  t.after(() => holder.open && holder.close());

  await rejectsWithCode(activateExecutionLedger(databasePath, options), 'EXECUTION_ACTIVATION_DATABASE_LOCKED');
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);

  holder.exec('ROLLBACK');
  holder.close();
  const result = await activateExecutionLedger(databasePath, options);
  assert.equal(result.receipt.user_version_after, ACTIVATED_VERSION);
});

test('apply refuses while another connection holds an open read transaction', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const reader = new Database(databasePath);
  t.after(() => reader.open && reader.close());
  reader.exec('BEGIN');
  reader.prepare('SELECT count(*) FROM state').get();

  await rejectsWithCode(
    activateExecutionLedger(databasePath, { adr: 'ADR-9001', backupDir: sandbox.backups, now: NOW, internal: sandbox.internal }),
    'EXECUTION_ACTIVATION_DATABASE_LOCKED',
  );
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);
});

test('dry run and plan report the migrations and write nothing', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const before = sha256(databasePath);
  const entries = fs.readdirSync(path.dirname(databasePath)).sort();

  const plan = planExecutionLedgerActivation(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  assert.equal(plan.ready, true);
  assert.equal(plan.migrations_to_apply.length, 13);
  assert.equal(plan.user_version, OPERATIONAL_SCHEMA_VERSION);
  assert.equal(plan.target_user_version, ACTIVATED_VERSION);
  assert.ok(plan.backup_path.startsWith(sandbox.backups));

  const dry = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    dryRun: true,
    internal: sandbox.internal,
  });
  assert.equal(dry.dry_run, true);
  assert.equal(dry.plan.ready, true);
  assert.equal(sha256(databasePath), before);
  assert.deepEqual(fs.readdirSync(path.dirname(databasePath)).sort(), entries);
  assert.equal(fs.existsSync(sandbox.backups), false);
});

test('plan reports blockers instead of throwing for an unaccepted ADR', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const plan = planExecutionLedgerActivation(databasePath, { adr: 'ADR-9003', internal: sandbox.internal });
  assert.equal(plan.ready, false);
  assert.ok(plan.blockers.some((blocker) => blocker.code === 'EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED'));
});

test('a failure in the middle of the migrations leaves the original database intact and keeps the backup', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const migrations = path.join(sandbox.root, 'migrations');
  fs.mkdirSync(migrations);
  fs.writeFileSync(path.join(migrations, '005-first.sql'), 'CREATE TABLE execution_events (id INTEGER PRIMARY KEY);\n');
  fs.writeFileSync(
    path.join(migrations, '006-broken.sql'),
    'CREATE TABLE execution_other (id INTEGER PRIMARY KEY); INSERT INTO not_a_table VALUES (1);\n',
  );
  const before = sha256(databasePath);
  const dump = dumpOperational(databasePath);

  await rejectsWithCode(
    activateExecutionLedger(databasePath, {
      adr: 'ADR-9001',
      backupDir: sandbox.backups,
      now: NOW,
      internal: { ...sandbox.internal, migrationsDirectory: migrations },
    }),
    'EXECUTION_ACTIVATION_MIGRATION_FAILED',
  );

  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);
  assert.equal(executionTables(databasePath).length, 0);
  assert.deepEqual(dumpOperational(databasePath), dump);
  assert.equal(sha256(databasePath), before);
  const backups = fs.readdirSync(sandbox.backups).filter((name) => name.endsWith('.db'));
  assert.equal(backups.length, 1, 'the backup stays after a failed activation');
});

test('a second apply on an activated database refuses with a clear error', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const options = { adr: 'ADR-9001', backupDir: sandbox.backups, now: NOW, internal: sandbox.internal };
  await activateExecutionLedger(databasePath, options);
  const activated = sha256(databasePath);

  await rejectsWithCode(activateExecutionLedger(databasePath, options), 'EXECUTION_ACTIVATION_ALREADY_ACTIVATED');
  assert.equal(sha256(databasePath), activated);
});

test('apply refuses a database that is not at schema v4', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = path.join(sandbox.root, 'old.db');
  const old = new Database(databasePath);
  old.exec('CREATE TABLE state (key TEXT)');
  old.pragma('user_version = 2');
  old.close();
  await rejectsWithCode(
    activateExecutionLedger(databasePath, { adr: 'ADR-9001', backupDir: sandbox.backups, now: NOW, internal: sandbox.internal }),
    'EXECUTION_ACTIVATION_SCHEMA_VERSION_MISMATCH',
  );
});

test('the CLI companion plans, applies and rolls back with --json and refuses apply without --adr', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const repositoryRoot = path.join(__dirname, '..');
  const cliEnv = { ...process.env, TMPDIR: os.tmpdir() };
  const run = (...args) =>
    spawnSync(process.execPath, [path.join(repositoryRoot, 'tools', 'cli', 'hseos-cli.js'), 'execution-activation', ...args], {
      cwd: sandbox.root,
      encoding: 'utf8',
      env: cliEnv,
    });

  const refused = run('apply', '--db', databasePath, '--backup-dir', sandbox.backups, '--json');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED/);
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);

  const blocked = run('plan', '--db', databasePath, '--adr', 'ADR-9999', '--json');
  assert.equal(blocked.status, 2);
  assert.equal(JSON.parse(blocked.stdout).plan.ready, false);

  // ADR-0047 is Accepted in this repository, so the default decisions directory resolves it.
  const planned = JSON.parse(run('plan', '--db', databasePath, '--adr', 'ADR-0047', '--backup-dir', sandbox.backups, '--json').stdout);
  assert.equal(planned.plan.ready, true);
  assert.equal(planned.plan.migrations_to_apply.length, 13);
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);

  const applied = run('apply', '--db', databasePath, '--adr', 'ADR-0047', '--backup-dir', sandbox.backups, '--json');
  assert.equal(applied.status, 0, applied.stderr);
  const activation = JSON.parse(applied.stdout);
  assert.equal(userVersion(databasePath), ACTIVATED_VERSION);

  const rolledBack = run(
    'rollback',
    '--db',
    databasePath,
    '--backup',
    activation.backup_path,
    '--expected-sha256',
    activation.receipt.backup_sha256,
    '--json',
  );
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);

  const unknown = run('explode', '--db', databasePath);
  assert.notEqual(unknown.status, 0);
});
