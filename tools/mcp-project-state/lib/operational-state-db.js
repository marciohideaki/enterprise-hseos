'use strict';

const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { listMigrations, runMigrations } = require('./migrations');
const { PENDING_MIGRATIONS_DIR } = require('./execution-ledger-schema');

const DEFAULT_STATE_DB = path.join(process.cwd(), '.hseos', 'state', 'project.db');
const MIGRATIONS_DIRECTORY = path.join(__dirname, '..', 'migrations');
const OPERATIONAL_SCHEMA_VERSION = 4;
const JOURNAL_MODE_RETRY_MS = 5000;
const JOURNAL_MODE_RETRY_WAIT = new Int32Array(new SharedArrayBuffer(4));
const PENDING_TABLES = Object.freeze([
  'execution_approval_uses',
  'execution_approvals',
  'execution_event_schemas',
  'execution_events',
  'execution_projection_checkpoints',
  'execution_projection_generations',
  'execution_run_projection',
]);

function assertOperationalSchemaBoundary(db) {
  const version = db.pragma('user_version', { simple: true });
  const pendingTables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${PENDING_TABLES.map(() => '?').join(',')})`)
    .all(...PENDING_TABLES)
    .map(({ name }) => name);
  if (version > OPERATIONAL_SCHEMA_VERSION || pendingTables.length > 0) {
    const error = new Error(`Operational state requires schema v${OPERATIONAL_SCHEMA_VERSION}; pending execution schema is not activated`);
    error.code = 'EXECUTION_ACTIVATION_PENDING';
    throw error;
  }
}

function assertPendingFixturePath(databasePath) {
  if (process.env.NODE_ENV !== 'test' || process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE !== '1') {
    throw new Error('Pending execution migrations require the explicit test fixture gate');
  }
  const resolvedPath = path.resolve(databasePath);
  const temporaryRoot = `${fs.realpathSync(os.tmpdir())}${path.sep}`;
  if (!resolvedPath.startsWith(temporaryRoot)) throw new Error('Pending execution migrations require a temporary database');
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const realParent = `${fs.realpathSync(path.dirname(resolvedPath))}${path.sep}`;
  if (!realParent.startsWith(temporaryRoot)) throw new Error('Pending fixture parent resolves outside the temporary root');
  if (fs.existsSync(resolvedPath)) {
    const link = fs.lstatSync(resolvedPath);
    if (link.isSymbolicLink() || link.nlink !== 1) throw new Error('Pending fixture database cannot be a link');
    if (!`${fs.realpathSync(resolvedPath)}${path.sep}`.startsWith(temporaryRoot)) {
      throw new Error('Pending fixture database resolves outside the temporary root');
    }
  }
  return resolvedPath;
}

function enableWalJournalMode(db) {
  const deadline = Date.now() + JOURNAL_MODE_RETRY_MS;
  for (;;) {
    try {
      db.pragma('journal_mode = WAL');
      return;
    } catch (error) {
      if (error.code !== 'SQLITE_BUSY' || Date.now() >= deadline) throw error;
      // SQLite does not always honor busy_timeout while another process changes journal mode.
      Atomics.wait(JOURNAL_MODE_RETRY_WAIT, 0, 0, 25);
    }
  }
}

function openOperationalStateDatabase(
  databasePath = process.env.HSEOS_STATE_DB || DEFAULT_STATE_DB,
  { activatePendingFixture = false, log = () => {} } = {},
) {
  if (activatePendingFixture) databasePath = assertPendingFixturePath(databasePath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  try {
    db.pragma('busy_timeout = 5000');
    if (!activatePendingFixture) assertOperationalSchemaBoundary(db);
    enableWalJournalMode(db);
    db.pragma('foreign_keys = ON');
    db.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      depends_on TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS state_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `);
    runMigrations(db, MIGRATIONS_DIRECTORY, { log });
    if (activatePendingFixture) runMigrations(db, PENDING_MIGRATIONS_DIR, { log });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

const REPOSITORY_ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_DECISIONS_DIRECTORY = path.join(REPOSITORY_ROOT, '.enterprise', '.specs', 'decisions');
const ADR_IDENTIFIER = /^ADR-\d{4}$/;
const LOCK_BUSY_TIMEOUT_MS = 200;

class ExecutionActivationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExecutionActivationError';
    this.code = code;
    Object.assign(this, details);
  }
}

function activationBlocker(code, message) {
  return { code, message };
}

function utcStamp(instant) {
  return new Date(instant)
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Status keyword of an ADR in either layout used by the repository, or null when the ADR cannot be resolved. */
function readAdrStatus(adr, decisionsDirectory) {
  if (typeof adr !== 'string' || !ADR_IDENTIFIER.test(adr)) return null;
  if (!fs.existsSync(decisionsDirectory)) return null;
  const matches = fs.readdirSync(decisionsDirectory).filter((name) => name.startsWith(`${adr}-`) && name.endsWith('.md'));
  if (matches.length !== 1) return null;
  const text = fs.readFileSync(path.join(decisionsDirectory, matches[0]), 'utf8');
  const inline = text.match(/^\*\*Status:\*\*[ \t]*(.+)$/m);
  const heading = text.match(/^##[ \t]+Status[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*(\S.*)$/m);
  const line = (inline || heading || [])[1];
  const keyword = line && line.match(/^[A-Za-z]+/);
  return keyword ? keyword[0] : null;
}

/** Processes (Linux /proc) that hold the database or its WAL sidecars open, this process included. */
function findDatabaseHolders(databasePath) {
  const targets = new Set([databasePath, `${databasePath}-wal`, `${databasePath}-shm`]);
  const holders = [];
  let pids;
  try {
    pids = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  } catch {
    return holders;
  }
  for (const pid of pids) {
    let descriptors;
    try {
      descriptors = fs.readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const descriptor of descriptors) {
      let target;
      try {
        target = fs.readlinkSync(`/proc/${pid}/fd/${descriptor}`);
      } catch {
        continue;
      }
      if (targets.has(target)) {
        holders.push(Number(pid));
        break;
      }
    }
  }
  return holders;
}

function lockedError(databasePath, detail) {
  return new ExecutionActivationError(
    'EXECUTION_ACTIVATION_DATABASE_LOCKED',
    `Database is in use and cannot be locked exclusively: ${databasePath} (${detail})`,
  );
}

function integrityCheck(db) {
  return db.pragma('integrity_check', { simple: true });
}

/** Digest of schema and rows, stable across the byte-level header changes that db.backup() makes. */
function logicalDigest(db) {
  const hash = createHash('sha256');
  hash.update(`user_version=${db.pragma('user_version', { simple: true })}\n`);
  const objects = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  for (const object of objects) {
    hash.update(`${JSON.stringify(object)}\n`);
    const virtual = /^\s*CREATE\s+VIRTUAL/i.test(object.sql || '');
    if (object.type !== 'table' || virtual) continue;
    const quoted = `"${object.name.replaceAll('"', '""')}"`;
    let rows;
    try {
      rows = db.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).all();
    } catch {
      rows = db.prepare(`SELECT * FROM ${quoted}`).all();
    }
    for (const row of rows) hash.update(`${JSON.stringify(row)}\n`);
  }
  return hash.digest('hex');
}

function executionTableNames(db) {
  return db
    .prepare(String.raw`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'execution\_%' ESCAPE '\' ORDER BY name`)
    .all()
    .map(({ name }) => name);
}

function activationInternals(internal = {}) {
  return {
    decisionsDirectory: internal.decisionsDirectory || DEFAULT_DECISIONS_DIRECTORY,
    migrationsDirectory: internal.migrationsDirectory || PENDING_MIGRATIONS_DIR,
  };
}

function inspectDatabaseFile(databasePath, blockers) {
  let link;
  try {
    link = fs.lstatSync(databasePath);
  } catch {
    blockers.push(activationBlocker('EXECUTION_ACTIVATION_DB_NOT_FOUND', `Database does not exist: ${databasePath}`));
    return null;
  }
  if (link.isSymbolicLink() || !link.isFile() || link.nlink !== 1) {
    blockers.push(activationBlocker('EXECUTION_ACTIVATION_DB_NOT_REGULAR', `Database must be a regular, unlinked file: ${databasePath}`));
    return null;
  }
  return link;
}

/**
 * Read-only activation plan. Never writes; reports blockers instead of throwing.
 * `opts.internal` exists for tests (alternative ADR and migration directories).
 */
function planExecutionLedgerActivation(databasePath, opts = {}) {
  const { adr, backupDir, now = Date.now, internal } = opts;
  const { decisionsDirectory, migrationsDirectory } = activationInternals(internal);
  const resolved = path.resolve(databasePath);
  const blockers = [];
  const adrStatus = readAdrStatus(adr, decisionsDirectory);
  if (adrStatus !== 'Accepted') {
    blockers.push(
      activationBlocker(
        'EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED',
        `Activation requires an ADR with status Accepted; ${adr || '(none)'} is ${adrStatus || 'missing or unresolvable'}`,
      ),
    );
  }
  if (!backupDir) blockers.push(activationBlocker('EXECUTION_ACTIVATION_BACKUP_DIR_REQUIRED', 'A backup directory is required'));
  const migrations = listMigrations(migrationsDirectory);
  const targetVersion = migrations.length > 0 ? migrations.at(-1).version : OPERATIONAL_SCHEMA_VERSION;
  let userVersion = null;
  if (inspectDatabaseFile(resolved, blockers)) {
    let db;
    const sidecars = [`${resolved}-wal`, `${resolved}-shm`].filter((file) => !fs.existsSync(file));
    try {
      db = new Database(resolved, { readonly: true, fileMustExist: true });
      userVersion = db.pragma('user_version', { simple: true });
      const tables = executionTableNames(db);
      if (userVersion > OPERATIONAL_SCHEMA_VERSION || tables.length > 0) {
        blockers.push(
          activationBlocker(
            'EXECUTION_ACTIVATION_ALREADY_ACTIVATED',
            `Database already has the execution ledger (user_version ${userVersion}, ${tables.length} execution tables)`,
          ),
        );
      } else if (userVersion !== OPERATIONAL_SCHEMA_VERSION) {
        blockers.push(
          activationBlocker(
            'EXECUTION_ACTIVATION_SCHEMA_VERSION_MISMATCH',
            `Activation requires user_version ${OPERATIONAL_SCHEMA_VERSION}; found ${userVersion}`,
          ),
        );
      }
    } catch (error) {
      blockers.push(activationBlocker('EXECUTION_ACTIVATION_DB_UNREADABLE', `Database cannot be opened: ${error.message}`));
    } finally {
      if (db) db.close();
      // A read-only open of a WAL database creates its sidecars; the plan must leave the directory as found.
      if (findDatabaseHolders(resolved).length === 0) for (const file of sidecars) fs.rmSync(file, { force: true });
    }
    const holders = findDatabaseHolders(resolved);
    if (holders.length > 0)
      blockers.push(activationBlocker('EXECUTION_ACTIVATION_DATABASE_LOCKED', `Database is open in process(es): ${holders.join(', ')}`));
  }
  const stamp = utcStamp(now());
  return {
    ready: blockers.length === 0,
    blockers,
    database_path: resolved,
    adr: adr || null,
    adr_status: adrStatus,
    user_version: userVersion,
    target_user_version: targetVersion,
    migrations_to_apply: migrations
      .filter((migration) => migration.version > OPERATIONAL_SCHEMA_VERSION)
      .map((migration) => migration.name),
    backup_path: backupDir ? path.join(path.resolve(backupDir), `${stamp}-${path.basename(resolved)}`) : null,
    receipt_path: backupDir ? path.join(path.resolve(backupDir), `${stamp}-${path.basename(resolved)}.receipt.json`) : null,
  };
}

function currentCommit() {
  try {
    return (
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

async function backupSnapshot(databasePath, backupPath) {
  const reader = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    await reader.backup(backupPath);
  } finally {
    reader.close();
  }
}

function lockForActivation(databasePath) {
  const db = new Database(databasePath, { fileMustExist: true });
  try {
    db.pragma(`busy_timeout = ${LOCK_BUSY_TIMEOUT_MS}`);
    const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)');
    if (checkpoint && checkpoint.busy) throw lockedError(databasePath, 'WAL checkpoint blocked by another connection');
    db.exec('BEGIN IMMEDIATE');
    return db;
  } catch (error) {
    db.close();
    if (error instanceof ExecutionActivationError) throw error;
    if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') throw lockedError(databasePath, error.code);
    throw error;
  }
}

/**
 * Activates the execution ledger (migrations 005-017) on an existing schema-v4 database.
 * Steps: gate checks, exclusive lock, WAL checkpoint, verified backup, single-transaction migration, receipt.
 * Any failure rolls the transaction back and leaves the original database untouched; the backup is kept.
 */
async function activateExecutionLedger(databasePath, opts = {}) {
  const { backupDir, now = Date.now, dryRun = false, internal } = opts;
  const { migrationsDirectory } = activationInternals(internal);
  const plan = planExecutionLedgerActivation(databasePath, opts);
  if (dryRun) return { dry_run: true, plan };
  if (!plan.ready) {
    const [first] = plan.blockers;
    throw new ExecutionActivationError(first.code, first.message, { blockers: plan.blockers });
  }
  const startedAt = new Date(now()).toISOString();
  fs.mkdirSync(path.resolve(backupDir), { recursive: true, mode: 0o700 });
  if (fs.existsSync(plan.backup_path)) {
    throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_EXISTS', `Backup already exists: ${plan.backup_path}`);
  }
  const db = lockForActivation(plan.database_path);
  try {
    const version = db.pragma('user_version', { simple: true });
    if (version !== OPERATIONAL_SCHEMA_VERSION || executionTableNames(db).length > 0) {
      throw new ExecutionActivationError('EXECUTION_ACTIVATION_ALREADY_ACTIVATED', 'Database changed while acquiring the lock');
    }
    if (integrityCheck(db) !== 'ok') {
      throw new ExecutionActivationError('EXECUTION_ACTIVATION_INTEGRITY_FAILED', 'integrity_check failed on the original database');
    }
    const originalSha256 = sha256File(plan.database_path);
    const originalLogical = logicalDigest(db);
    await backupSnapshot(plan.database_path, plan.backup_path);
    const backupCheck = new Database(plan.backup_path, { readonly: true, fileMustExist: true });
    try {
      if (integrityCheck(backupCheck) !== 'ok') {
        throw new ExecutionActivationError('EXECUTION_ACTIVATION_INTEGRITY_FAILED', 'integrity_check failed on the backup');
      }
      if (logicalDigest(backupCheck) !== originalLogical) {
        throw new ExecutionActivationError(
          'EXECUTION_ACTIVATION_BACKUP_CONTENT_MISMATCH',
          'Backup content differs from the original database',
        );
      }
    } finally {
      backupCheck.close();
    }
    const backupSha256 = sha256File(plan.backup_path);

    let applied;
    try {
      ({ applied } = runMigrations(db, migrationsDirectory, { log: () => {}, externalTransaction: true }));
    } catch (error) {
      throw new ExecutionActivationError(
        'EXECUTION_ACTIVATION_MIGRATION_FAILED',
        `Migration failed, original database kept: ${error.message}`,
        { cause: error },
      );
    }
    const versionAfter = db.pragma('user_version', { simple: true });
    if (versionAfter !== plan.target_user_version) {
      throw new ExecutionActivationError(
        'EXECUTION_ACTIVATION_MIGRATION_FAILED',
        `Expected user_version ${plan.target_user_version}; found ${versionAfter}`,
      );
    }
    if (integrityCheck(db) !== 'ok') {
      throw new ExecutionActivationError('EXECUTION_ACTIVATION_INTEGRITY_FAILED', 'integrity_check failed after the migrations');
    }
    const receipt = {
      adr: plan.adr,
      adr_status: plan.adr_status,
      commit: currentCommit(),
      database_path: plan.database_path,
      backup_path: plan.backup_path,
      original_sha256_before: originalSha256,
      original_logical_sha256: originalLogical,
      backup_sha256: backupSha256,
      user_version_before: version,
      user_version_after: versionAfter,
      applied_migrations: applied,
      started_at: startedAt,
      finished_at: new Date(now()).toISOString(),
    };
    fs.writeFileSync(plan.receipt_path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    try {
      db.exec('COMMIT');
    } catch (error) {
      fs.rmSync(plan.receipt_path, { force: true });
      throw error;
    }
    return { dry_run: false, plan, receipt, receipt_path: plan.receipt_path, backup_path: plan.backup_path };
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Restores a verified backup over an activated database. The activated database is preserved next to it
 * (ADR-0022: the ledger is never deleted during rollback) and the swap is an atomic rename.
 */
async function restoreExecutionLedgerBackup(databasePath, opts = {}) {
  const { backupPath, expectedSha256, receiptPath, now = Date.now } = opts;
  const resolved = path.resolve(databasePath);
  if (!backupPath) throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_REQUIRED', 'A backup path is required');
  if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_HASH_REQUIRED', 'The expected sha256 of the backup is required');
  }
  const backup = path.resolve(backupPath);
  let backupLink;
  try {
    backupLink = fs.lstatSync(backup);
  } catch {
    throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_REQUIRED', `Backup does not exist: ${backup}`);
  }
  if (backupLink.isSymbolicLink() || !backupLink.isFile()) {
    throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_REQUIRED', `Backup must be a regular file: ${backup}`);
  }
  if (sha256File(backup) !== expectedSha256) {
    throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_HASH_MISMATCH', 'Backup sha256 does not match the expected digest');
  }
  const blockers = [];
  if (!inspectDatabaseFile(resolved, blockers)) throw new ExecutionActivationError(blockers[0].code, blockers[0].message);
  const receiptFile = receiptPath ? path.resolve(receiptPath) : `${backup}.receipt.json`;
  const receipt = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, 'utf8')) : null;

  const check = new Database(backup, { readonly: true, fileMustExist: true });
  let contentMatchesOriginal = null;
  try {
    if (integrityCheck(check) !== 'ok') {
      throw new ExecutionActivationError('EXECUTION_ACTIVATION_INTEGRITY_FAILED', 'integrity_check failed on the backup');
    }
    const backupVersion = check.pragma('user_version', { simple: true });
    if (backupVersion !== OPERATIONAL_SCHEMA_VERSION) {
      throw new ExecutionActivationError(
        'EXECUTION_ACTIVATION_SCHEMA_VERSION_MISMATCH',
        `Backup must be at user_version ${OPERATIONAL_SCHEMA_VERSION}; found ${backupVersion}`,
      );
    }
    if (receipt && receipt.original_logical_sha256) {
      contentMatchesOriginal = logicalDigest(check) === receipt.original_logical_sha256;
      if (!contentMatchesOriginal) {
        throw new ExecutionActivationError(
          'EXECUTION_ACTIVATION_BACKUP_CONTENT_MISMATCH',
          'Backup content differs from the receipt of the original database',
        );
      }
    }
  } finally {
    check.close();
  }

  const holders = findDatabaseHolders(resolved);
  if (holders.length > 0) throw lockedError(resolved, `open in process(es): ${holders.join(', ')}`);
  lockForActivation(resolved).close();
  for (const sidecar of [`${resolved}-wal`, `${resolved}-shm`]) {
    if (fs.existsSync(sidecar)) {
      if (sidecar.endsWith('-wal') && fs.statSync(sidecar).size > 0) throw lockedError(resolved, 'WAL sidecar still holds data');
      fs.rmSync(sidecar, { force: true });
    }
  }

  const stamp = utcStamp(now());
  const preserved = `${resolved}.activated-${stamp}`;
  const temporary = `${resolved}.restore-${process.pid}.tmp`;
  if (fs.existsSync(preserved))
    throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_EXISTS', `Preserved database already exists: ${preserved}`);
  try {
    fs.copyFileSync(backup, temporary, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(temporary, 'r+');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (sha256File(temporary) !== expectedSha256) {
      throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_HASH_MISMATCH', 'Restored copy does not match the expected digest');
    }
    fs.linkSync(resolved, preserved);
    fs.renameSync(temporary, resolved);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }

  const restoredSha256 = sha256File(resolved);
  const verify = new Database(resolved, { readonly: true, fileMustExist: true });
  let restoredVersion;
  try {
    restoredVersion = verify.pragma('user_version', { simple: true });
  } finally {
    verify.close();
  }
  if (restoredSha256 !== expectedSha256 || restoredVersion !== OPERATIONAL_SCHEMA_VERSION) {
    throw new ExecutionActivationError('EXECUTION_ACTIVATION_RESTORE_VERIFICATION_FAILED', 'Restored database failed verification', {
      preserved_activated_path: preserved,
    });
  }
  return {
    restored: true,
    database_path: resolved,
    backup_path: backup,
    preserved_activated_path: preserved,
    restored_sha256: restoredSha256,
    user_version: restoredVersion,
    content_matches_original: contentMatchesOriginal,
  };
}

module.exports = {
  activateExecutionLedger,
  assertOperationalSchemaBoundary,
  assertPendingFixturePath,
  DEFAULT_STATE_DB,
  MIGRATIONS_DIRECTORY,
  OPERATIONAL_SCHEMA_VERSION,
  openOperationalStateDatabase,
  planExecutionLedgerActivation,
  restoreExecutionLedgerBackup,
};
