'use strict';

// Activation classification and refusals of the operational state database: a database is either plainly legacy or
// fully activated, and every in-between state must stop the server instead of degrading into a guess.

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  activateExecutionLedger,
  assertPendingFixturePath,
  openOperationalStateDatabase,
  planExecutionLedgerActivation,
  resolveGovernedExecutionMode,
  restoreExecutionLedgerBackup,
} = require('../tools/mcp-project-state/lib/operational-state-db');

const NOW = () => Date.parse('2026-10-22T12:00:00.000Z');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-state-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decisions = path.join(root, 'decisions');
  fs.mkdirSync(decisions);
  fs.writeFileSync(path.join(decisions, 'ADR-0048-criterion.md'), '# ADR-0048: criterion\n\n## Status\n\nAccepted — 2026-10-22\n');
  return { root, decisions, backups: path.join(root, 'backups'), databasePath: path.join(root, 'state', 'project.db') };
}

function makeV4(box) {
  const db = openOperationalStateDatabase(box.databasePath);
  db.prepare("INSERT INTO state (key, value) VALUES ('phase', 'closeout')").run();
  db.close();
}

async function activate(box) {
  makeV4(box);
  return activateExecutionLedger(box.databasePath, {
    adr: 'ADR-0048',
    backupDir: box.backups,
    now: NOW,
    internal: { decisionsDirectory: box.decisions },
  });
}

function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const NO_FIXTURE = { NODE_ENV: undefined, HSEOS_GOVERNED_EXECUTION_FIXTURE: undefined };

function pending(error) {
  assert.equal(error.code, 'EXECUTION_ACTIVATION_PENDING');
  return true;
}

function mutate(databasePath, sql) {
  const db = new Database(databasePath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

test('the pending-fixture path is refused unless the explicit test gate is set', () => {
  const target = path.join(os.tmpdir(), 'hseos-gate-never-created', 'project.db');
  withEnv(NO_FIXTURE, () => {
    assert.throws(() => assertPendingFixturePath(target), /explicit test fixture gate/);
    assert.throws(() => openOperationalStateDatabase(target, { activatePendingFixture: true }), /explicit test fixture gate/);
  });
  withEnv({ NODE_ENV: 'test', HSEOS_GOVERNED_EXECUTION_FIXTURE: '0' }, () => {
    assert.throws(() => assertPendingFixturePath(target), /explicit test fixture gate/);
  });
  assert.equal(fs.existsSync(path.dirname(target)), false);
});

test('activatePendingFixture and openActivated cannot be combined', (t) => {
  const box = sandbox(t);
  assert.throws(
    () => openOperationalStateDatabase(box.databasePath, { activatePendingFixture: true, openActivated: true }),
    (error) => error instanceof TypeError && /mutually exclusive/.test(error.message),
  );
  assert.equal(fs.existsSync(box.databasePath), false);
});

test('mode resolution: fixture gate, absent database and v4 database are decided without opening an activated ledger', (t) => {
  const box = sandbox(t);
  withEnv({ NODE_ENV: 'test', HSEOS_GOVERNED_EXECUTION_FIXTURE: '1' }, () => {
    assert.deepEqual(resolveGovernedExecutionMode(box.databasePath), { mode: 'fixture', fixture: true, modern: true, user_version: null });
  });
  withEnv(NO_FIXTURE, () => {
    assert.deepEqual(resolveGovernedExecutionMode(box.databasePath), { mode: 'legacy', fixture: false, modern: false, user_version: null });
    makeV4(box);
    assert.deepEqual(resolveGovernedExecutionMode(box.databasePath), { mode: 'legacy', fixture: false, modern: false, user_version: 4 });
    // a legacy database cannot be opened as activated
    assert.throws(() => openOperationalStateDatabase(box.databasePath, { openActivated: true }), /not activated on this database/);
    assert.throws(() => openOperationalStateDatabase(box.databasePath, { openActivated: true }), pending);
  });
});

test('mode resolution: an activated database is modern and opens as activated while the legacy boundary refuses it', async (t) => {
  const box = sandbox(t);
  await activate(box);
  withEnv(NO_FIXTURE, () => {
    assert.deepEqual(resolveGovernedExecutionMode(box.databasePath), { mode: 'modern', fixture: false, modern: true, user_version: 17 });
    const db = openOperationalStateDatabase(box.databasePath, { openActivated: true });
    try {
      assert.equal(db.pragma('user_version', { simple: true }), 17);
      assert.equal(db.prepare(`SELECT value FROM state WHERE key = 'phase'`).get().value, 'closeout');
    } finally {
      db.close();
    }
    assert.throws(() => openOperationalStateDatabase(box.databasePath), pending);
  });
});

test('an inconsistent activation never degrades into either mode', async (t) => {
  const box = sandbox(t);
  await activate(box);
  const pristine = fs.readFileSync(box.databasePath);
  const reset = () => {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${box.databasePath}${suffix}`, { force: true });
    fs.writeFileSync(box.databasePath, pristine);
  };
  const refuses = (pattern) =>
    withEnv(NO_FIXTURE, () => {
      assert.throws(
        () => resolveGovernedExecutionMode(box.databasePath),
        (error) => pending(error) && pattern.test(error.message),
      );
      assert.throws(
        () => openOperationalStateDatabase(box.databasePath, { openActivated: true }),
        (error) => pending(error) && pattern.test(error.message),
      );
    });

  // schema reached by hand: right version and tables, but no marker written by the activation
  mutate(box.databasePath, 'PRAGMA application_id = 0');
  refuses(/no activation marker/);

  reset();
  mutate(box.databasePath, 'DROP TABLE execution_run_projection');
  refuses(/missing tables: execution_run_projection/);

  reset();
  mutate(box.databasePath, 'PRAGMA user_version = 9');
  refuses(/user_version 9, expected 4 or 17/);

  reset();
  mutate(box.databasePath, 'PRAGMA user_version = 99');
  refuses(/user_version 99/);

  // the legacy version with leftover execution tables is not "legacy"
  reset();
  mutate(box.databasePath, 'PRAGMA user_version = 4');
  refuses(/user_version 4, expected 4 or 17/);
});

test('an activated database that fails integrity_check is refused', async (t) => {
  const box = sandbox(t);
  await activate(box);
  mutate(
    box.databasePath,
    "CREATE TABLE canary (v TEXT); CREATE INDEX canary_v ON canary (v); INSERT INTO canary (v) VALUES ('canary-needle-AAAA')",
  );
  mutate(box.databasePath, 'PRAGMA wal_checkpoint(TRUNCATE)');
  const bytes = fs.readFileSync(box.databasePath);
  const first = bytes.indexOf(Buffer.from('canary-needle-AAAA'));
  assert.ok(first > 0);
  Buffer.from('canary-needle-BBBB').copy(bytes, first);
  fs.writeFileSync(box.databasePath, bytes);
  withEnv(NO_FIXTURE, () => {
    assert.throws(
      () => resolveGovernedExecutionMode(box.databasePath),
      (error) => pending(error) && /integrity_check/.test(error.message),
    );
  });
});

test('plan reports an unreadable database as a blocker instead of throwing', (t) => {
  const box = sandbox(t);
  fs.mkdirSync(path.dirname(box.databasePath), { recursive: true });
  fs.writeFileSync(box.databasePath, 'this is not a sqlite database, only text '.repeat(40));
  const plan = planExecutionLedgerActivation(box.databasePath, {
    adr: 'ADR-0048',
    backupDir: box.backups,
    now: NOW,
    internal: { decisionsDirectory: box.decisions },
  });
  assert.equal(plan.ready, false);
  assert.ok(plan.blockers.some((blocker) => blocker.code === 'EXECUTION_ACTIVATION_DB_UNREADABLE'));
});

test('apply refuses to overwrite a backup that already exists and leaves the database at v4', async (t) => {
  const box = sandbox(t);
  makeV4(box);
  const options = { adr: 'ADR-0048', backupDir: box.backups, now: NOW, internal: { decisionsDirectory: box.decisions } };
  const { plan } = await activateExecutionLedger(box.databasePath, { ...options, dryRun: true });
  fs.mkdirSync(path.dirname(plan.backup_path), { recursive: true });
  fs.writeFileSync(plan.backup_path, 'previous backup');
  await assert.rejects(activateExecutionLedger(box.databasePath, options), (error) => error.code === 'EXECUTION_ACTIVATION_BACKUP_EXISTS');
  assert.equal(fs.readFileSync(plan.backup_path, 'utf8'), 'previous backup');
  const db = new Database(box.databasePath, { readonly: true });
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 4);
  } finally {
    db.close();
  }
});

test('rollback refuses a backup that is missing, a symlink or a directory, before reading it', async (t) => {
  const box = sandbox(t);
  const { backup_path: backupPath } = await activate(box);
  const digest = createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex');
  const refuses = (backup) =>
    assert.rejects(
      restoreExecutionLedgerBackup(box.databasePath, { backupPath: backup, expectedSha256: digest }),
      (error) => error.code === 'EXECUTION_ACTIVATION_BACKUP_REQUIRED',
    );
  await refuses(path.join(box.root, 'absent.db'));
  const link = path.join(box.root, 'link.db');
  fs.symlinkSync(backupPath, link);
  await refuses(link);
  await refuses(box.backups);
  // none of the refusals touched the activated database
  const db = new Database(box.databasePath, { readonly: true });
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 17);
  } finally {
    db.close();
  }
});
