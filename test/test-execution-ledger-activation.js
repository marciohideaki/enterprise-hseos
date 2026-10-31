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
  currentCommit,
  openOperationalStateDatabase,
  planExecutionLedgerActivation,
  restoreExecutionLedgerBackup,
  verifyActivationCriterion,
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
  fs.writeFileSync(path.join(decisions, 'ADR-9001-accepted.md'), '# ADR-9001: ok\n\n## Status\n\nAccepted — 2026-10-22\n');
  fs.writeFileSync(
    path.join(decisions, 'ADR-9002-legacy.md'),
    '# ADR-9002 — legacy format\n\n**Status:** Accepted (human-approved 2026-08-21)\n',
  );
  fs.writeFileSync(
    path.join(decisions, 'ADR-9003-proposed.md'),
    '# ADR-9003: later\n\n## Status\n\nProposed — 2026-10-22. Aguarda decisão.\n',
  );
  fs.writeFileSync(path.join(decisions, 'ADR-9004-superseded.md'), '# ADR-9004\n\n**Status:** Superseded by ADR-9001\n');
  fs.writeFileSync(path.join(decisions, 'ADR-0048-criterion.md'), '# ADR-0048: criterion\n\n## Status\n\nAccepted — 2026-10-22\n');
  fs.writeFileSync(path.join(decisions, 'ADR-0047-unrelated.md'), '# ADR-0047: unrelated\n\n## Status\n\nAccepted — 2026-10-11\n');
  const criterionAdrs = ['ADR-0048', 'ADR-9001', 'ADR-9002', 'ADR-9003', 'ADR-9004', 'ADR-9999'];
  return {
    root,
    decisions,
    backups: path.join(root, 'backups'),
    internal: { decisionsDirectory: decisions, criterionAdrs },
    defaultCriterion: { decisionsDirectory: decisions },
  };
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
  assert.equal(result.receipt.backup_sha256, result.receipt.original_sha256_before, 'the backup is a byte copy of the original');
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
  assert.equal(sha256(databasePath), original, 'rollback returns the bytes of the original database');
  assert.equal(restored.restored_sha256, activation.receipt.original_sha256_before);
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

test('rollback refuses when the receipt of the original database disagrees with the backup', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  const receipt = { ...activation.receipt, original_sha256_before: '0'.repeat(64) };
  fs.writeFileSync(activation.receipt_path, JSON.stringify(receipt));
  const activatedSha = sha256(databasePath);

  await rejectsWithCode(
    restoreExecutionLedgerBackup(databasePath, { backupPath: activation.backup_path, expectedSha256: activation.receipt.backup_sha256 }),
    'EXECUTION_ACTIVATION_BACKUP_CONTENT_MISMATCH',
  );
  assert.equal(sha256(databasePath), activatedSha);
});

async function activatedSandbox(t) {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const original = sha256(databasePath);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  return { sandbox, databasePath, original, activation };
}

function runActivationCli(cwd, ...args) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'cli', 'hseos-cli.js'), 'execution-activation', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: os.tmpdir() },
  });
}

test('rollback reports receipt_verified true when the receipt is present', async (t) => {
  const { databasePath, activation } = await activatedSandbox(t);
  const restored = await restoreExecutionLedgerBackup(databasePath, {
    backupPath: activation.backup_path,
    expectedSha256: activation.receipt.backup_sha256,
  });
  assert.equal(restored.receipt_verified, true);
});

test('rollback refuses a missing receipt unless the operator allows it', async (t) => {
  const { databasePath, original, activation } = await activatedSandbox(t);
  fs.rmSync(activation.receipt_path);
  const activatedSha = sha256(databasePath);
  const options = { backupPath: activation.backup_path, expectedSha256: activation.receipt.backup_sha256 };

  await rejectsWithCode(restoreExecutionLedgerBackup(databasePath, options), 'EXECUTION_ACTIVATION_RECEIPT_REQUIRED');
  assert.equal(sha256(databasePath), activatedSha, 'a refused rollback leaves the activated database untouched');

  const restored = await restoreExecutionLedgerBackup(databasePath, { ...options, allowMissingReceipt: true });
  assert.equal(restored.receipt_verified, false);
  assert.equal(restored.content_matches_original, null);
  assert.equal(sha256(databasePath), original);
});

test('rollback refuses a receipt without original_sha256_before', async (t) => {
  const { databasePath, activation } = await activatedSandbox(t);
  const { original_sha256_before: omitted, ...receipt } = activation.receipt;
  assert.ok(omitted);
  fs.writeFileSync(activation.receipt_path, JSON.stringify(receipt));
  await rejectsWithCode(
    restoreExecutionLedgerBackup(databasePath, { backupPath: activation.backup_path, expectedSha256: activation.receipt.backup_sha256 }),
    'EXECUTION_ACTIVATION_RECEIPT_REQUIRED',
  );
});

test('allowing a missing receipt does not relax the other rollback checks', async (t) => {
  const { databasePath, activation } = await activatedSandbox(t);
  fs.rmSync(activation.receipt_path);
  await rejectsWithCode(
    restoreExecutionLedgerBackup(databasePath, {
      backupPath: activation.backup_path,
      expectedSha256: '0'.repeat(64),
      allowMissingReceipt: true,
    }),
    'EXECUTION_ACTIVATION_BACKUP_HASH_MISMATCH',
  );
});

test('allowing a missing receipt still refuses a present receipt that contradicts the backup', async (t) => {
  const { sandbox, databasePath, activation } = await activatedSandbox(t);
  fs.writeFileSync(activation.receipt_path, JSON.stringify({ ...activation.receipt, original_sha256_before: '0'.repeat(64) }));
  const activatedSha = sha256(databasePath);

  await rejectsWithCode(
    restoreExecutionLedgerBackup(databasePath, {
      backupPath: activation.backup_path,
      expectedSha256: activation.receipt.backup_sha256,
      allowMissingReceipt: true,
    }),
    'EXECUTION_ACTIVATION_BACKUP_CONTENT_MISMATCH',
  );
  assert.equal(sha256(databasePath), activatedSha);

  const viaCli = runActivationCli(
    sandbox.root,
    'rollback',
    '--db',
    databasePath,
    '--backup',
    activation.backup_path,
    '--expected-sha256',
    activation.receipt.backup_sha256,
    '--allow-missing-receipt',
    '--json',
  );
  assert.notEqual(viaCli.status, 0);
  assert.match(viaCli.stderr, /EXECUTION_ACTIVATION_BACKUP_CONTENT_MISMATCH/);
  assert.equal(sha256(databasePath), activatedSha);
});

test('allowing a missing receipt still refuses a backup that fails integrity_check or has the wrong user_version', async (t) => {
  const corrupt = await activatedSandbox(t);
  fs.rmSync(corrupt.activation.receipt_path);
  corruptIndexConsistency(corrupt.activation.backup_path);
  await rejectsWithCode(
    restoreExecutionLedgerBackup(corrupt.databasePath, {
      backupPath: corrupt.activation.backup_path,
      expectedSha256: sha256(corrupt.activation.backup_path),
      allowMissingReceipt: true,
    }),
    'EXECUTION_ACTIVATION_INTEGRITY_FAILED',
  );

  const stale = await activatedSandbox(t);
  fs.rmSync(stale.activation.receipt_path);
  const handle = new Database(stale.activation.backup_path);
  handle.pragma('user_version = 2');
  handle.close();
  const activatedSha = sha256(stale.databasePath);
  await rejectsWithCode(
    restoreExecutionLedgerBackup(stale.databasePath, {
      backupPath: stale.activation.backup_path,
      expectedSha256: sha256(stale.activation.backup_path),
      allowMissingReceipt: true,
    }),
    'EXECUTION_ACTIVATION_SCHEMA_VERSION_MISMATCH',
  );
  assert.equal(sha256(stale.databasePath), activatedSha);
});

test('rollback honours an explicit receipt path and still cross-checks it', async (t) => {
  const { sandbox, databasePath, original, activation } = await activatedSandbox(t);
  const moved = path.join(sandbox.root, 'elsewhere.receipt.json');
  fs.renameSync(activation.receipt_path, moved);
  const options = { backupPath: activation.backup_path, expectedSha256: activation.receipt.backup_sha256 };

  fs.writeFileSync(moved, JSON.stringify({ ...activation.receipt, original_sha256_before: '0'.repeat(64) }));
  await rejectsWithCode(
    restoreExecutionLedgerBackup(databasePath, { ...options, receiptPath: moved }),
    'EXECUTION_ACTIVATION_BACKUP_CONTENT_MISMATCH',
  );

  fs.writeFileSync(moved, JSON.stringify(activation.receipt));
  const restored = await restoreExecutionLedgerBackup(databasePath, { ...options, receiptPath: moved });
  assert.equal(restored.receipt_verified, true);
  assert.equal(sha256(databasePath), original);
});

test('the CLI rollback requires the receipt and accepts an explicit --receipt', async (t) => {
  const { sandbox, databasePath, original, activation } = await activatedSandbox(t);
  const moved = path.join(sandbox.root, 'moved.receipt.json');
  fs.renameSync(activation.receipt_path, moved);
  const base = [
    'rollback',
    '--db',
    databasePath,
    '--backup',
    activation.backup_path,
    '--expected-sha256',
    activation.receipt.backup_sha256,
    '--json',
  ];

  const refused = runActivationCli(sandbox.root, ...base);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /EXECUTION_ACTIVATION_RECEIPT_REQUIRED/);
  assert.equal(userVersion(databasePath), ACTIVATED_VERSION);

  fs.writeFileSync(moved, JSON.stringify({ ...activation.receipt, original_sha256_before: '0'.repeat(64) }));
  const contradicted = runActivationCli(sandbox.root, ...base, '--receipt', moved);
  assert.notEqual(contradicted.status, 0);
  assert.match(contradicted.stderr, /EXECUTION_ACTIVATION_BACKUP_CONTENT_MISMATCH/);

  fs.writeFileSync(moved, JSON.stringify(activation.receipt));
  const verified = runActivationCli(sandbox.root, ...base, '--receipt', moved);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).receipt_verified, true);
  assert.equal(sha256(databasePath), original);
});

test('the CLI rollback with --allow-missing-receipt restores and reports receipt_verified false', async (t) => {
  // One rollback per sandbox: the preserved-database name carries a one-second stamp.
  const { sandbox, databasePath, original, activation } = await activatedSandbox(t);
  fs.rmSync(activation.receipt_path);
  const rolledBack = runActivationCli(
    sandbox.root,
    'rollback',
    '--db',
    databasePath,
    '--backup',
    activation.backup_path,
    '--expected-sha256',
    activation.receipt.backup_sha256,
    '--allow-missing-receipt',
    '--json',
  );
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.equal(JSON.parse(rolledBack.stdout).receipt_verified, false);
  assert.equal(sha256(databasePath), original);
});

test('the backup directory receives no SQLite sidecars from the verification', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  await activateExecutionLedger(databasePath, { adr: 'ADR-9001', backupDir: sandbox.backups, now: NOW, internal: sandbox.internal });
  assert.deepEqual(
    fs.readdirSync(sandbox.backups).filter((name) => /-(wal|shm)$/.test(name)),
    [],
  );
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
  fs.mkdirSync(path.join(sandbox.root, 'old'));
  const databasePath = path.join(sandbox.root, 'old', 'old.db');
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

  // An Accepted ADR that does not define the criterion never opens the gate.
  const unrelated = run('apply', '--db', databasePath, '--adr', 'ADR-0047', '--backup-dir', sandbox.backups, '--json');
  assert.notEqual(unrelated.status, 0);
  assert.match(unrelated.stderr, /EXECUTION_ACTIVATION_ADR_NOT_CRITERION/);

  // The real ADR-0048 is Accepted (owner acceptance, 2026-10-22): the CLI plan no longer reports the ADR gate as a blocker.
  const accepted = run('plan', '--db', databasePath, '--adr', 'ADR-0048', '--backup-dir', sandbox.backups, '--json');
  const acceptedPlan = JSON.parse(accepted.stdout).plan;
  assert.equal(acceptedPlan.adr_status, 'Accepted');
  assert.ok(!acceptedPlan.blockers.some((blocker) => blocker.code === 'EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED'));
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);

  // A Proposed ADR-0048 (fixture; the CLI has no decisions-directory option, so this goes through the library) keeps the gate shut.
  const proposedDirectory = path.join(sandbox.root, 'decisions-proposed');
  fs.mkdirSync(proposedDirectory);
  fs.writeFileSync(path.join(proposedDirectory, 'ADR-0048-criterion.md'), '# ADR-0048: criterion\n\n## Status\n\nProposed — 2026-10-22\n');
  const unaccepted = planExecutionLedgerActivation(databasePath, {
    adr: 'ADR-0048',
    backupDir: sandbox.backups,
    internal: { decisionsDirectory: proposedDirectory },
  });
  assert.equal(unaccepted.ready, false);
  assert.ok(unaccepted.blockers.some((blocker) => blocker.code === 'EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED'));
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);

  // The mechanism itself is exercised through the library; the CLI rollback reads the verified backup.
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-0048',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
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
  assert.equal(JSON.parse(rolledBack.stdout).post_activation_writes_preserved_at.includes('.activated-'), true);
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);

  const unknown = run('explode', '--db', databasePath);
  assert.notEqual(unknown.status, 0);
});

test('the real CLI applies ADR-0048 to a disposable database and rolls it back byte for byte', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const before = dumpOperational(databasePath);
  const original = sha256(databasePath);
  const repositoryRoot = path.join(__dirname, '..');
  const run = (...args) =>
    spawnSync(process.execPath, [path.join(repositoryRoot, 'tools', 'cli', 'hseos-cli.js'), 'execution-activation', ...args], {
      cwd: sandbox.root,
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: os.tmpdir() },
    });

  const applied = run('apply', '--db', databasePath, '--adr', 'ADR-0048', '--backup-dir', sandbox.backups, '--json');
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);

  assert.equal(userVersion(databasePath), ACTIVATED_VERSION);
  assert.deepEqual(dumpOperational(databasePath), before, 'every original row survives the activation');
  assert.ok(fs.existsSync(result.backup_path), 'the backup file exists');
  assert.equal(sha256(result.backup_path), original, 'the backup is a byte copy of the original');
  assert.equal(result.receipt.backup_sha256, original);
  assert.equal(result.receipt.original_sha256_before, original);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.receipt_path, 'utf8')), result.receipt);
  assert.equal(result.receipt.adr, 'ADR-0048');
  assert.equal(result.receipt.adr_status, 'Accepted');
  assert.equal(result.receipt.commit, currentCommit());
  assert.equal(result.receipt.user_version_after, ACTIVATED_VERSION);

  const legacy = new Database(databasePath);
  try {
    assert.throws(
      () => assertOperationalSchemaBoundary(legacy),
      (error) => error.code === 'EXECUTION_ACTIVATION_PENDING',
    );
  } finally {
    legacy.close(); // an open handle would make the rollback refuse the database as in use
  }

  const again = run('apply', '--db', databasePath, '--adr', 'ADR-0048', '--backup-dir', sandbox.backups, '--json');
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /EXECUTION_ACTIVATION_ALREADY_ACTIVATED/);
  assert.equal(userVersion(databasePath), ACTIVATED_VERSION);

  const rolledBack = run('rollback', '--db', databasePath, '--backup', result.backup_path, '--expected-sha256', original, '--json');
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.equal(sha256(databasePath), original, 'rollback returns the bytes of the original database');
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);
  assert.deepEqual(dumpOperational(databasePath), before);
});

test('only the criterion ADR list opens the gate, even for an unrelated Accepted ADR', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const before = sha256(databasePath);
  for (const adr of ['ADR-0047', 'ADR-9001']) {
    await rejectsWithCode(
      activateExecutionLedger(databasePath, { adr, backupDir: sandbox.backups, now: NOW, internal: sandbox.defaultCriterion }),
      'EXECUTION_ACTIVATION_ADR_NOT_CRITERION',
    );
    const plan = planExecutionLedgerActivation(databasePath, { adr, internal: sandbox.defaultCriterion });
    assert.ok(plan.blockers.some((blocker) => blocker.code === 'EXECUTION_ACTIVATION_ADR_NOT_CRITERION'));
  }
  assert.equal(sha256(databasePath), before);
  const result = await activateExecutionLedger(databasePath, {
    adr: 'ADR-0048',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.defaultCriterion,
  });
  assert.equal(result.receipt.adr, 'ADR-0048');
  assert.equal(result.receipt.adr_status, 'Accepted');
  assert.equal(result.receipt.adr_sha256, sha256(path.join(sandbox.decisions, 'ADR-0048-criterion.md')));
  assert.equal(typeof result.receipt.unscannable_processes, 'number');
});

test('the ADR status parser accepts only an unambiguous Accepted status line', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const heading = (line) => `# ADR\n\n## Status\n\n${line}\n\n## Context\n\ntext\n`;
  const inline = (line) => `# ADR\n\n**Status:** ${line}\n**Date:** 2026-10-22\n`;
  const cases = [
    ['heading Accepted', heading('Accepted'), true],
    ['heading Accepted with date', heading('Accepted — 2026-10-22'), true],
    ['heading Accepted with en dash', heading('Accepted – 2026-10-22'), true],
    ['inline Accepted human-approved', inline('Accepted (human-approved 2026-08-21)'), true],
    ['both forms, same line', `${inline('Accepted')}\n## Status\n\nAccepted\n`, true],
    ['pending suffix with hyphen', heading('Accepted-pending owner sign-off'), false],
    ['pending after comma', heading('Accepted, pending revalidation'), false],
    ['superseded arrow', heading('Accepted → superseded by ADR-0001'), false],
    ['superseded after dash', heading('Accepted — superseded by ADR-0001'), false],
    ['Proposed', heading('Proposed'), false],
    ['Accepted with conditions', heading('Accepted with conditions'), false],
    ['awaiting signature', heading('Accepted — awaiting owner signature'), false],
    ['aguarda ratificacao', heading('Accepted (aguarda ratificação do owner)'), false],
    ['conditional', heading('Accepted (conditional)'), false],
    ['not yet approved', heading('Accepted - not yet approved'), false],
    ['date followed by prose', heading('Accepted — 2026-10-22. Awaiting signature'), false],
    ['approved by plus awaiting', heading('Accepted — approved by owner, awaiting merge of the follow-up change request'), false],
    ['whole status section commented out', '# ADR\n\n<!--\n## Status\n\nAccepted — 2026-10-22\n-->\n\n## Context\n\ntext\n', false],
    ['status line commented out', '# ADR\n\n## Status\n\n<!-- Accepted -->\n\n## Context\n\ntext\n', false],
    ['owner-approved with date', heading('Accepted — owner-approved 2026-10-22'), true],
    ['approved by name', heading('Accepted (approved by Marcio Hideaki 2026-10-22)'), true],
    ['Acceptedish', heading('Acceptedish'), false],
    ['Not Accepted', heading('Not Accepted'), false],
    ['lowercase', heading('accepted'), false],
    ['Proposed mentioning Accepted', heading('Proposed — aguarda ser Accepted'), false],
    ['Proposed with fenced Accepted below', `${heading('Proposed')}\n\`\`\`\n**Status:** Accepted\n\`\`\`\n`, false],
    ['Proposed with table Accepted below', `${heading('Proposed')}\n| a | b |\n| **Status:** Accepted | x |\n`, false],
    ['Proposed with quoted Accepted below', `${heading('Proposed')}\n> **Status:** Accepted\n`, false],
    ['no status', '# ADR\n\nbody only\n', false],
    ['conflicting heading and inline', `${heading('Proposed')}\n**Status:** Accepted\n`, 'EXECUTION_ACTIVATION_ADR_STATUS_AMBIGUOUS'],
  ];
  const criterionAdrs = [];
  for (const [index, [, text]] of cases.entries()) {
    const id = `ADR-${String(9500 + index)}`;
    criterionAdrs.push(id);
    fs.writeFileSync(path.join(sandbox.decisions, `${id}-case.md`), text);
  }
  for (const [index, [label, , expected]] of cases.entries()) {
    const adr = `ADR-${String(9500 + index)}`;
    const plan = planExecutionLedgerActivation(databasePath, {
      adr,
      backupDir: sandbox.backups,
      internal: { decisionsDirectory: sandbox.decisions, criterionAdrs },
    });
    const codes = plan.blockers.map((blocker) => blocker.code);
    if (expected === true) {
      assert.equal(plan.adr_status, 'Accepted', label);
      assert.deepEqual(codes, [], label);
    } else {
      assert.equal(plan.ready, false, label);
      assert.ok(codes.includes(typeof expected === 'string' ? expected : 'EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED'), `${label}: ${codes}`);
    }
  }
});

test('the real Accepted ADR layouts of the repository satisfy the parser', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const decisions = path.join(__dirname, '..', '.enterprise', '.specs', 'decisions');
  // ADR-0047 is deliberately absent: its status paragraph carries trailing prose, which the exact-form rule refuses.
  for (const adr of ['ADR-0022', 'ADR-0023']) {
    const plan = planExecutionLedgerActivation(databasePath, { adr, internal: { decisionsDirectory: decisions, criterionAdrs: [adr] } });
    assert.equal(plan.adr_status, 'Accepted', adr);
  }
});

test('plan resolves the database through symlinked directories before looking for holders', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const aliasDirectory = path.join(sandbox.root, 'alias');
  fs.symlinkSync(path.dirname(databasePath), aliasDirectory);
  const reader = new Database(databasePath);
  t.after(() => reader.open && reader.close());
  reader.exec('BEGIN');
  reader.prepare('SELECT count(*) FROM state').get();
  const plan = planExecutionLedgerActivation(path.join(aliasDirectory, path.basename(databasePath)), {
    adr: 'ADR-9001',
    internal: sandbox.internal,
  });
  assert.ok(plan.blockers.some((blocker) => blocker.code === 'EXECUTION_ACTIVATION_DATABASE_LOCKED'));
  assert.equal(typeof plan.unscannable_processes, 'number');
});

test('the backup directory must be a real directory outside the database directory and is private', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const base = { adr: 'ADR-9001', now: NOW, internal: sandbox.internal };
  const realBackups = path.join(sandbox.root, 'real-backups');
  fs.mkdirSync(realBackups);
  const linkedBackups = path.join(sandbox.root, 'linked-backups');
  fs.symlinkSync(realBackups, linkedBackups);

  await rejectsWithCode(
    activateExecutionLedger(databasePath, { ...base, backupDir: linkedBackups }),
    'EXECUTION_ACTIVATION_BACKUP_DIR_INVALID',
  );
  await rejectsWithCode(
    activateExecutionLedger(databasePath, { ...base, backupDir: path.dirname(databasePath) }),
    'EXECUTION_ACTIVATION_BACKUP_DIR_INVALID',
  );
  await rejectsWithCode(
    activateExecutionLedger(databasePath, { ...base, backupDir: path.join(path.dirname(databasePath), 'inside') }),
    'EXECUTION_ACTIVATION_BACKUP_DIR_INVALID',
  );
  assert.equal(userVersion(databasePath), OPERATIONAL_SCHEMA_VERSION);

  const result = await activateExecutionLedger(databasePath, { ...base, backupDir: path.join(sandbox.root, 'fresh', 'backups') });
  const mode = (file) => fs.statSync(file).mode & 0o777;
  assert.equal(mode(result.backup_path), 0o600);
  assert.equal(mode(result.receipt_path), 0o600);
  assert.equal(mode(path.dirname(result.backup_path)), 0o700);
});

test('rollback refuses a database that is not activated', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  const other = makeV4Database(sandbox.root, 'other.db');
  const before = sha256(other);
  await rejectsWithCode(
    restoreExecutionLedgerBackup(other, { backupPath: activation.backup_path, expectedSha256: activation.receipt.backup_sha256 }),
    'EXECUTION_ACTIVATION_ROLLBACK_NOT_ACTIVATED',
  );
  assert.equal(sha256(other), before);
});

test('rollback refuses a corrupted receipt', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  const activatedSha = sha256(databasePath);
  for (const content of ['{not json', '[]', JSON.stringify({ original_sha256_before: 'zz' })]) {
    fs.writeFileSync(activation.receipt_path, content);
    await rejectsWithCode(
      restoreExecutionLedgerBackup(databasePath, { backupPath: activation.backup_path, expectedSha256: activation.receipt.backup_sha256 }),
      'EXECUTION_ACTIVATION_RECEIPT_INVALID',
    );
  }
  assert.equal(sha256(databasePath), activatedSha);
});

test('rollback leaves no SQLite sidecars next to the restored database and reports where later writes remain', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-9001',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  const restored = await restoreExecutionLedgerBackup(databasePath, {
    backupPath: activation.backup_path,
    expectedSha256: activation.receipt.backup_sha256,
    now: NOW,
  });
  assert.deepEqual(fs.readdirSync(path.dirname(databasePath)).sort(), ['project.db', 'project.db.activated-20261022T120000Z']);
  assert.equal(restored.post_activation_writes_preserved_at, restored.preserved_activated_path);
});

async function activatedCriterionFixture(t, { window = {} } = {}) {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const original = sha256(databasePath);
  const activation = await activateExecutionLedger(databasePath, {
    adr: 'ADR-0048',
    backupDir: sandbox.backups,
    now: NOW,
    internal: sandbox.internal,
  });
  const windowPath = path.join(sandbox.root, 'window.json');
  fs.writeFileSync(
    windowPath,
    JSON.stringify({
      operator: 'owner',
      stopped_consumers: ['hseos-state-tracking', 'hseos-swarm'],
      original_sha256_before: original,
      recorded_at: '2026-10-22T11:59:00.000Z',
      ...window,
    }),
  );
  return {
    sandbox,
    databasePath,
    activation,
    windowPath,
    options: { adr: 'ADR-0048', receiptPath: activation.receipt_path, windowPath, internal: sandbox.internal },
  };
}

const NOT_VERIFIABLE = [
  'contract_suites_on_activated_db',
  'rehearsal_evidence_archived',
  'modern_journey_counts',
  'real_client_proof',
  'legacy_inside_modern_compat',
  'legacy_initialize_revisions',
  'data_loss_acknowledgement',
  'single_writer_proof',
  'reregistration_list',
];

/** Unmet conditions the rehearsal can verify; the NOT_VERIFIABLE ones are asserted separately and are always unmet. */
function unmet(verdict) {
  return verdict.conditions
    .filter((condition) => !condition.met && !NOT_VERIFIABLE.includes(condition.id))
    .map((condition) => condition.id);
}

test('with every verifiable condition met the gate still waits for the criterion items a rehearsal cannot check', async (t) => {
  const { databasePath, options } = await activatedCriterionFixture(t);
  const verdict = verifyActivationCriterion(databasePath, options);
  assert.equal(verdict.gate, 'g9-adr0048-activation-criterion');
  assert.deepEqual(unmet(verdict), []);
  assert.equal(verdict.satisfied, false);
  const pending = verdict.conditions.filter((condition) => !condition.met).map((condition) => condition.id);
  assert.deepEqual(pending, NOT_VERIFIABLE);
  for (const condition of verdict.conditions.filter((entry) => NOT_VERIFIABLE.includes(entry.id))) {
    assert.match(condition.reason, /^não verificável pelo ensaio: .+/);
    assert.ok(condition.adr_item);
  }
});

test('activation criterion stays pending with a reason when no proof exists', async (t) => {
  const sandbox = makeSandbox(t);
  const databasePath = makeV4Database(sandbox.root);
  const verdict = verifyActivationCriterion(databasePath, { internal: sandbox.internal });
  assert.equal(verdict.satisfied, false);
  assert.deepEqual(unmet(verdict), ['database_authorized', 'backup_integrity', 'supervised_window']);
  for (const condition of verdict.conditions.filter((entry) => !entry.met)) assert.ok(condition.reason.length > 0);
  assert.equal(verifyActivationCriterion(undefined, {}).satisfied, false);
});

test('activation criterion stays pending when exactly one condition is missing', async (t) => {
  const fixture = await activatedCriterionFixture(t);
  const { databasePath, options, sandbox, windowPath } = fixture;
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, { ...options, adr: 'ADR-0047' })), [
    'adr_accepted',
    'database_authorized',
    'backup_integrity',
    'supervised_window',
  ]);
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, { ...options, windowPath: undefined })), ['supervised_window']);
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, { ...options, receiptPath: undefined })), [
    'database_authorized',
    'backup_integrity',
    'supervised_window',
  ]);
  const byBackup = { ...options, receiptPath: undefined, backupPath: fixture.activation.backup_path };
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, byBackup)), []);
  const proposed = { ...options, internal: { ...sandbox.internal, decisionsDirectory: path.join(sandbox.root, 'none') } };
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, proposed)), ['adr_accepted']);
  fs.writeFileSync(path.join(sandbox.decisions, 'ADR-0048-criterion.md'), '# ADR-0048\n\n## Status\n\nProposed — 2026-10-22\n');
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, options)), ['adr_accepted']);
  fs.writeFileSync(windowPath, '[]');
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, options)), ['adr_accepted', 'supervised_window']);
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, { ...options, inspectDatabase: false })), [
    'adr_accepted',
    'database_authorized',
    'backup_integrity',
    'supervised_window',
  ]);
});

test('activation criterion rejects a window that is unbound, anonymous, empty or recorded after the apply', async (t) => {
  for (const window of [
    { original_sha256_before: '0'.repeat(64) },
    { original_sha256_before: 'zz' },
    { operator: ' ' },
    { stopped_consumers: [] },
    { stopped_consumers: ['ok', ''] },
    { recorded_at: '2026-10-22T12:00:01.000Z' },
    { recorded_at: 'not a date' },
    { recorded_at: '2026-10-22T12:00:00.000Z' },
    { recorded_at: 1 },
    { recorded_at: Date.parse('2026-10-22T11:00:00.000Z') },
  ]) {
    const { databasePath, options } = await activatedCriterionFixture(t, { window });
    assert.deepEqual(unmet(verifyActivationCriterion(databasePath, options)), ['supervised_window'], JSON.stringify(window));
  }
});

test('activation criterion rejects a receipt of another database, another ADR or a plain v4 database', async (t) => {
  const { sandbox, databasePath, options, activation } = await activatedCriterionFixture(t);
  const receipt = JSON.parse(fs.readFileSync(activation.receipt_path, 'utf8'));
  const write = (patch) => fs.writeFileSync(activation.receipt_path, JSON.stringify({ ...receipt, ...patch }));
  write({ adr: 'ADR-9001' });
  assert.ok(unmet(verifyActivationCriterion(databasePath, options)).includes('database_authorized'));
  write({ database_path: path.join(sandbox.root, 'missing.db') });
  assert.ok(unmet(verifyActivationCriterion(databasePath, options)).includes('database_authorized'));
  write({ database_path: makeV4Database(sandbox.root, 'other.db') });
  assert.ok(unmet(verifyActivationCriterion(databasePath, options)).includes('database_authorized'));
  write({ database_path: undefined });
  assert.ok(unmet(verifyActivationCriterion(databasePath, options)).includes('database_authorized'));
  fs.writeFileSync(activation.receipt_path, '[]');
  assert.ok(unmet(verifyActivationCriterion(databasePath, options)).includes('database_authorized'));
  fs.writeFileSync(activation.receipt_path, '{not json');
  assert.ok(unmet(verifyActivationCriterion(databasePath, options)).includes('database_authorized'));
  const garbage = path.join(sandbox.root, 'garbage.db');
  fs.writeFileSync(garbage, 'this is not a sqlite database');
  assert.ok(unmet(verifyActivationCriterion(garbage, options)).includes('database_authorized'));
  write({});
  assert.ok(unmet(verifyActivationCriterion(makeV4Database(sandbox.root, 'plain.db'), options)).includes('database_authorized'));
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, options)), []);
});

test('a hand-made receipt cannot stand in for the apply: no backup, deleted backup or tampered backup keep it pending', async (t) => {
  const { sandbox, databasePath, options, activation } = await activatedCriterionFixture(t);
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, options)), []);

  // Tampered backup: the digest in the receipt no longer matches.
  const original = fs.readFileSync(activation.backup_path);
  fs.appendFileSync(activation.backup_path, Buffer.from('tampered'));
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, options)), ['backup_integrity']);

  // A backup with the right digest that is not a healthy v4 database (digest recomputed in a forged receipt).
  const receipt = JSON.parse(fs.readFileSync(activation.receipt_path, 'utf8'));
  fs.writeFileSync(activation.backup_path, 'not a sqlite database');
  const garbageSha = sha256(activation.backup_path);
  fs.writeFileSync(activation.receipt_path, JSON.stringify({ ...receipt, backup_sha256: garbageSha, original_sha256_before: garbageSha }));
  assert.ok(unmet(verifyActivationCriterion(databasePath, options)).includes('backup_integrity'));
  fs.writeFileSync(activation.receipt_path, JSON.stringify(receipt));

  // A readable backup whose pages are damaged, with a receipt that records the damaged digest.
  const damaged = Buffer.from(original);
  damaged.fill(0xff, 4096 * 2, 4096 * 3);
  fs.writeFileSync(activation.backup_path, damaged);
  const damagedSha = sha256(activation.backup_path);
  fs.writeFileSync(activation.receipt_path, JSON.stringify({ ...receipt, backup_sha256: damagedSha, original_sha256_before: damagedSha }));
  const damagedVerdict = verifyActivationCriterion(databasePath, options);
  assert.match(
    damagedVerdict.conditions.find((condition) => condition.id === 'backup_integrity').reason,
    /integrity_check failed|cannot be opened/,
  );
  fs.writeFileSync(activation.receipt_path, JSON.stringify(receipt));

  // Deleted backup.
  fs.rmSync(activation.backup_path);
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, options)), ['backup_integrity']);

  // Backup restored to a symlink is refused as well.
  const elsewhere = path.join(sandbox.root, 'elsewhere.db');
  fs.writeFileSync(elsewhere, original);
  fs.symlinkSync(elsewhere, activation.backup_path);
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, options)), ['backup_integrity']);
  fs.rmSync(activation.backup_path);
  fs.copyFileSync(elsewhere, activation.backup_path);
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, options)), []);
});

test('a receipt written by hand with no backup at all, elsewhere, or with incoherent fields never passes', async (t) => {
  const { sandbox, databasePath, options, activation } = await activatedCriterionFixture(t);
  const receipt = JSON.parse(fs.readFileSync(activation.receipt_path, 'utf8'));
  const forged = (patch, name = 'forged.receipt.json') => {
    const file = path.join(sandbox.root, name);
    fs.writeFileSync(file, JSON.stringify({ ...receipt, ...patch }));
    return { ...options, receiptPath: file };
  };
  // No backup anywhere: the receipt sits at the path of the backup it invents.
  const invented = path.join(sandbox.root, 'invented-backup.db');
  fs.writeFileSync(`${invented}.receipt.json`, JSON.stringify({ ...receipt, backup_path: invented }));
  assert.deepEqual(unmet(verifyActivationCriterion(databasePath, { ...options, receiptPath: `${invented}.receipt.json` })), [
    'backup_integrity',
  ]);
  // A real backup but a receipt that is not beside it.
  assert.ok(unmet(verifyActivationCriterion(databasePath, forged({}))).includes('database_authorized'));
  // Fields that the apply always writes coherently.
  for (const [index, patch] of [
    { user_version_after: 5 },
    { user_version_before: 17 },
    { applied_migrations: [] },
    { original_sha256_before: 'abc' },
    { backup_path: '' },
    { started_at: '2026-10-22T13:00:00.000Z' },
    { finished_at: 'never' },
  ].entries()) {
    const file = activation.receipt_path;
    fs.writeFileSync(file, JSON.stringify({ ...receipt, ...patch }));
    assert.ok(unmet(verifyActivationCriterion(databasePath, options)).includes('database_authorized'), `patch ${index}`);
  }
  fs.writeFileSync(activation.receipt_path, JSON.stringify(receipt));
  // A symlinked receipt is not followed.
  const link = path.join(sandbox.root, 'link.receipt.json');
  fs.symlinkSync(activation.receipt_path, link);
  assert.ok(unmet(verifyActivationCriterion(databasePath, { ...options, receiptPath: link })).includes('database_authorized'));
});
