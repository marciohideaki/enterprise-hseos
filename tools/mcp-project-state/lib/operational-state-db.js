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
// Written (inside the activation transaction) by activateExecutionLedger and checked before a server or CLI opens the
// database as activated: a schema migrated by hand reaches the same user_version and tables but carries no marker.
const ACTIVATION_APPLICATION_ID = 0x48_53_4f_53;
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
    const error = new Error(
      `Operational state requires schema v${OPERATIONAL_SCHEMA_VERSION}; pending execution schema is not activated. ` +
        'If this database was activated, this legacy server cannot open it: re-register the MCP server on the governed (modern) release.',
    );
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
  { activatePendingFixture = false, openActivated = false, log = () => {} } = {},
) {
  if (activatePendingFixture && openActivated) throw new TypeError('activatePendingFixture and openActivated are mutually exclusive');
  if (activatePendingFixture) databasePath = assertPendingFixturePath(databasePath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  try {
    db.pragma('busy_timeout = 5000');
    if (openActivated) assertActivatedExecutionLedger(db);
    else if (!activatePendingFixture) assertOperationalSchemaBoundary(db);
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
// Only the ADR that defines the activation criterion opens the gate. A later ADR that supersedes the criterion
// must be added here explicitly; an unrelated Accepted ADR never satisfies the gate.
const ACTIVATION_CRITERION_ADRS = Object.freeze(['ADR-0048']);
// Positive list: the status line is exactly `Accepted`, or `Accepted` plus one approval complement and nothing else.
const APPROVAL_DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const APPROVAL_COMPLEMENT = String.raw`(?:${APPROVAL_DATE}|(?:human|owner)-approved(?: ${APPROVAL_DATE})?|approved by [A-Za-z0-9 ._@-]{1,40}?(?: ${APPROVAL_DATE})?)`;
const ACCEPTED_STATUS_LINE = new RegExp(String.raw`^Accepted(?: [—–-] ${APPROVAL_COMPLEMENT}| \(${APPROVAL_COMPLEMENT}\))?$`);
const REJECTED_STATUS_WORDS = /pending|superseded|deprecated|rejected|proposed|withdrawn|awaiting|aguarda|conditional|not yet/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;

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

/** Status lines of an ADR: the first line under `## Status` and any `**Status:**` line, outside code, tables and quotes. */
function extractStatusLines(text) {
  const found = new Set();
  const lines = text
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim());
  let fenced = false;
  const usable = [];
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      usable.push(null);
    } else usable.push(fenced || line.startsWith('|') || line.startsWith('>') ? null : line);
  }
  for (const [index, line] of usable.entries()) {
    if (line === null) continue;
    const inline = line.match(/^\*\*Status:\*\*\s*(.+)$/);
    if (inline) found.add(inline[1].trim());
    if (/^##\s+Status$/.test(line)) {
      const next = usable.slice(index + 1).find((candidate) => candidate !== '');
      if (typeof next === 'string' && !next.startsWith('#')) found.add(next);
    }
  }
  return [...found];
}

/** Resolves an ADR file by identifier and reports its status line, or null when it cannot be resolved. */
function readAdr(adr, decisionsDirectory) {
  if (typeof adr !== 'string' || !ADR_IDENTIFIER.test(adr) || !fs.existsSync(decisionsDirectory)) return null;
  const matches = fs.readdirSync(decisionsDirectory).filter((name) => name.startsWith(`${adr}-`) && name.endsWith('.md'));
  if (matches.length !== 1) return null;
  const file = path.join(decisionsDirectory, matches[0]);
  const bytes = fs.readFileSync(file);
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), statusLines: extractStatusLines(bytes.toString('utf8')) };
}

function isAcceptedStatusLine(line) {
  return ACCEPTED_STATUS_LINE.test(line) && !REJECTED_STATUS_WORDS.test(line);
}

/** Processes (Linux /proc) that hold the database or its WAL sidecars open, this process included. */
function findDatabaseHolders(databasePath) {
  const targets = new Set([databasePath, `${databasePath}-wal`, `${databasePath}-shm`]);
  const result = { holders: [], unscannable: 0, unavailable: false };
  if (process.platform !== 'linux') return result;
  let pids;
  try {
    pids = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  } catch {
    result.unavailable = true;
    return result;
  }
  const gone = new Set(['ENOENT', 'ESRCH']);
  for (const pid of pids) {
    let descriptors;
    try {
      descriptors = fs.readdirSync(`/proc/${pid}/fd`);
    } catch (error) {
      if (!gone.has(error.code)) result.unscannable += 1;
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
        result.holders.push(Number(pid));
        break;
      }
    }
  }
  return result;
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

/** Runs `inspect` on a private read-only copy so verifying a backup never creates sidecars beside it. */
function withVerificationCopy(file, inspect) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-ledger-verify-'));
  let db;
  try {
    const copy = path.join(directory, 'verify.db');
    fs.copyFileSync(file, copy);
    db = new Database(copy, { readonly: true, fileMustExist: true });
    return inspect(db);
  } finally {
    if (db) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function executionTableNames(db) {
  return db
    .prepare(String.raw`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'execution\_%' ESCAPE '\' ORDER BY name`)
    .all()
    .map(({ name }) => name);
}

function activationTargetVersion() {
  const migrations = listMigrations(PENDING_MIGRATIONS_DIR);
  return migrations.length > 0 ? migrations.at(-1).version : OPERATIONAL_SCHEMA_VERSION;
}

function activationInconsistent(detail, userVersion) {
  const error = new Error(
    `Governed execution ledger is inconsistent (${detail}); refusing to start in either mode. ` +
      'Restore the activation backup (restoreExecutionLedgerBackup) or finish the activation before starting the server.',
  );
  error.code = 'EXECUTION_ACTIVATION_PENDING';
  error.user_version = userVersion;
  return error;
}

/**
 * Classifies an open database: `legacy` (v4 without execution tables) or `activated` (target user_version, every
 * execution table and a clean integrity_check). Anything in between, or a newer version, throws and never degrades.
 */
function classifyExecutionActivation(db) {
  const version = db.pragma('user_version', { simple: true });
  const present = new Set(executionTableNames(db));
  if (version <= OPERATIONAL_SCHEMA_VERSION && present.size === 0) return { state: 'legacy', user_version: version };
  const target = activationTargetVersion();
  if (version !== target)
    throw activationInconsistent(`user_version ${version}, expected ${OPERATIONAL_SCHEMA_VERSION} or ${target}`, version);
  const missing = PENDING_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) throw activationInconsistent(`missing tables: ${missing.join(', ')}`, version);
  if (db.pragma('application_id', { simple: true }) !== ACTIVATION_APPLICATION_ID) {
    throw activationInconsistent('schema present but not activated through activateExecutionLedger (no activation marker)', version);
  }
  const integrity = integrityCheck(db);
  if (integrity !== 'ok') throw activationInconsistent(`integrity_check: ${integrity}`, version);
  return { state: 'activated', user_version: version };
}

function assertActivatedExecutionLedger(db) {
  if (classifyExecutionActivation(db).state !== 'activated') {
    const error = new Error('Governed execution ledger is not activated on this database');
    error.code = 'EXECUTION_ACTIVATION_PENDING';
    throw error;
  }
}

/**
 * Picks the MCP/CLI mode for a state database. The fixture gate keeps its own path; otherwise an absent or v4 database
 * is `legacy`, an activated one is `modern`, and an inconsistent one throws EXECUTION_ACTIVATION_PENDING.
 */
function resolveGovernedExecutionMode(databasePath = process.env.HSEOS_STATE_DB || DEFAULT_STATE_DB) {
  if (process.env.NODE_ENV === 'test' && process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE === '1') {
    return { mode: 'fixture', fixture: true, modern: true, user_version: null };
  }
  const resolved = path.resolve(databasePath);
  if (!fs.existsSync(resolved)) return { mode: 'legacy', fixture: false, modern: false, user_version: null };
  const db = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    const { state, user_version: version } = classifyExecutionActivation(db);
    return { mode: state === 'activated' ? 'modern' : 'legacy', fixture: false, modern: state === 'activated', user_version: version };
  } finally {
    db.close();
  }
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

/** Real path of the backup directory, refusing a symlink leaf; ancestors that do not exist yet are kept as-is. */
function resolveBackupDirectory(backupDir, blockers) {
  const resolved = path.resolve(backupDir);
  const invalid = (reason) => {
    blockers.push(activationBlocker('EXECUTION_ACTIVATION_BACKUP_DIR_INVALID', `Backup directory ${resolved} is invalid: ${reason}`));
    return null;
  };
  let probe = resolved;
  const tail = [];
  for (;;) {
    let entry;
    try {
      entry = fs.lstatSync(probe);
    } catch (error) {
      if (error.code !== 'ENOENT') return invalid(error.code);
      tail.unshift(path.basename(probe));
      probe = path.dirname(probe);
      continue;
    }
    if (probe === resolved && entry.isSymbolicLink()) return invalid('it is a symlink');
    if (!entry.isDirectory() && !entry.isSymbolicLink()) return invalid(`${probe} is not a directory`);
    break;
  }
  return path.join(fs.realpathSync(probe), ...tail);
}

function checkBackupOutsideDatabase(backupDirectory, databasePath, blockers) {
  const databaseDirectory = path.dirname(databasePath);
  if (backupDirectory === databaseDirectory || backupDirectory.startsWith(`${databaseDirectory}${path.sep}`)) {
    blockers.push(
      activationBlocker(
        'EXECUTION_ACTIVATION_BACKUP_DIR_INVALID',
        `Backup directory ${backupDirectory} must be outside the database directory`,
      ),
    );
  }
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Read-only activation plan. Never writes; reports blockers instead of throwing.
 * `opts.internal` exists for tests (alternative ADR and migration directories).
 */
function planExecutionLedgerActivation(databasePath, opts = {}) {
  const { adr, backupDir, now = Date.now, internal } = opts;
  const { decisionsDirectory, migrationsDirectory } = activationInternals(internal);
  let resolved = path.resolve(databasePath);
  const blockers = [];
  const criterion = internal && internal.criterionAdrs ? internal.criterionAdrs : ACTIVATION_CRITERION_ADRS;
  let adrStatus = null;
  let adrSha256 = null;
  if (typeof adr !== 'string' || !ADR_IDENTIFIER.test(adr)) {
    blockers.push(
      activationBlocker(
        'EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED',
        `Activation requires an ADR identifier (ADR-NNNN); got ${adr || '(none)'}`,
      ),
    );
  } else if (criterion.includes(adr)) {
    const record = readAdr(adr, decisionsDirectory);
    if (!record) {
      blockers.push(activationBlocker('EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED', `${adr} was not found in the decisions directory`));
    } else if (record.statusLines.length > 1) {
      blockers.push(
        activationBlocker(
          'EXECUTION_ACTIVATION_ADR_STATUS_AMBIGUOUS',
          `${adr} declares conflicting status lines: ${record.statusLines.join(' | ')}`,
        ),
      );
    } else if (record.statusLines.length === 1 && isAcceptedStatusLine(record.statusLines[0])) {
      adrStatus = 'Accepted';
      adrSha256 = record.sha256;
    } else {
      adrStatus = record.statusLines[0] ? record.statusLines[0].slice(0, 80) : null;
      blockers.push(
        activationBlocker(
          'EXECUTION_ACTIVATION_ADR_NOT_ACCEPTED',
          `Activation requires an ADR with status Accepted; ${adr} is ${adrStatus || 'without a status'}`,
        ),
      );
    }
  } else {
    blockers.push(
      activationBlocker(
        'EXECUTION_ACTIVATION_ADR_NOT_CRITERION',
        `${adr} does not define the activation criterion; accepted criterion ADRs: ${criterion.join(', ')}`,
      ),
    );
  }
  let backupDirectory = null;
  if (backupDir) backupDirectory = resolveBackupDirectory(backupDir, blockers);
  else blockers.push(activationBlocker('EXECUTION_ACTIVATION_BACKUP_DIR_REQUIRED', 'A backup directory is required'));
  const migrations = listMigrations(migrationsDirectory);
  const targetVersion = migrations.length > 0 ? migrations.at(-1).version : OPERATIONAL_SCHEMA_VERSION;
  let userVersion = null;
  let unscannable = 0;
  if (inspectDatabaseFile(resolved, blockers)) {
    resolved = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
    if (backupDirectory) checkBackupOutsideDatabase(backupDirectory, resolved, blockers);
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
      if (findDatabaseHolders(resolved).holders.length === 0) for (const file of sidecars) fs.rmSync(file, { force: true });
    }
    const scan = findDatabaseHolders(resolved);
    unscannable = scan.unscannable;
    if (scan.unavailable) {
      blockers.push(
        activationBlocker(
          'EXECUTION_ACTIVATION_PROC_SCAN_UNAVAILABLE',
          'Cannot enumerate processes to prove the database is not open elsewhere',
        ),
      );
    }
    if (scan.holders.length > 0) {
      blockers.push(
        activationBlocker('EXECUTION_ACTIVATION_DATABASE_LOCKED', `Database is open in process(es): ${scan.holders.join(', ')}`),
      );
    }
  }
  const stamp = utcStamp(now());
  return {
    ready: blockers.length === 0,
    blockers,
    database_path: resolved,
    adr: adr || null,
    adr_status: adrStatus,
    adr_sha256: adrSha256,
    unscannable_processes: unscannable,
    user_version: userVersion,
    target_user_version: targetVersion,
    migrations_to_apply: migrations
      .filter((migration) => migration.version > OPERATIONAL_SCHEMA_VERSION)
      .map((migration) => migration.name),
    backup_path: backupDirectory ? path.join(backupDirectory, `${stamp}-${path.basename(resolved)}`) : null,
    receipt_path: backupDirectory ? path.join(backupDirectory, `${stamp}-${path.basename(resolved)}.receipt.json`) : null,
  };
}

const ACTIVATION_CRITERION_GATE = 'g9-adr0048-activation-criterion';

// ADR-0048 item -> condition. Verified from evidence on disk: Decision 6 (adr_accepted, database_authorized), 2(b2)
// (backup_integrity) and 7 (supervised_window). The rest is evidence a human archives and the rehearsal cannot check:
// it stays pending, always, so the gate is never satisfied by less than the whole criterion.
const UNVERIFIABLE_CRITERION = Object.freeze([
  ['contract_suites_on_activated_db', '2(a)', 'the modern-server contract suites passing over an existing activated database'],
  ['rehearsal_evidence_archived', '2(b)', 'archived evidence that the rehearsal on a copy concluded (it cannot attest to itself)'],
  ['modern_journey_counts', '2(c)', 'archived modern journey with tool counts checked against the expected catalog'],
  ['real_client_proof', '2(d)', 'archived tools/list and tools/call proof with the installed Codex and the negotiated protocol version'],
  ['legacy_inside_modern_compat', '2(e)', 'evidence that legacy-inside-modern compatibility stays active'],
  ['legacy_initialize_revisions', '2(f)', 'evidence that the legacy initialize revisions are negotiated without running approval tools'],
  ['data_loss_acknowledgement', '5', 'the owner acknowledgement of the loss of post-activation writes, declared before the apply'],
  ['single_writer_proof', '7', 'the green single-writer invariant test and the frozen legacy writes before the apply'],
  ['reregistration_list', '7', 'the closed nominal list of clients, CLIs and hooks re-registered on the modern server'],
]);

function criterionCondition(id, item, reason) {
  return { id, adr_item: item, met: reason === null, reason };
}

function parseJsonObject(bytes) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function readJsonObject(file) {
  try {
    return parseJsonObject(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function isRegularFile(file) {
  try {
    const link = fs.lstatSync(file);
    return link.isFile() && !link.isSymbolicLink();
  } catch {
    return false;
  }
}

function adrCriterionReason(adr, internal) {
  const { decisionsDirectory } = activationInternals(internal);
  const criterion = internal && internal.criterionAdrs ? internal.criterionAdrs : ACTIVATION_CRITERION_ADRS;
  if (!criterion.includes(adr)) return `${adr} does not define the activation criterion`;
  const record = readAdr(adr, decisionsDirectory);
  if (!record) return `${adr} was not found in the decisions directory`;
  if (record.statusLines.length !== 1 || !isAcceptedStatusLine(record.statusLines[0])) return `${adr} is not unambiguously Accepted`;
  return null;
}

const RECEIPT_VERSIONS = new Set([1, 2]);

/** Version 1 receipts (no `receipt_version`, no `window`) stay readable; a window needs the version that defines it. */
function receiptWindowProblem(receipt) {
  if (receipt.receipt_version !== undefined && !RECEIPT_VERSIONS.has(receipt.receipt_version)) {
    return 'activation receipt has an unsupported receipt_version';
  }
  if (receipt.window === undefined) return null;
  const { window } = receipt;
  if (receipt.receipt_version !== 2 || window === null || typeof window !== 'object' || Array.isArray(window)) {
    return 'activation receipt window is not a version 2 {path, sha256} reference';
  }
  if (typeof window.path !== 'string' || window.path === '' || !SHA256_HEX.test(String(window.sha256))) {
    return 'activation receipt window is not a version 2 {path, sha256} reference';
  }
  return null;
}

function receiptShapeProblem(receipt, activatedVersion) {
  if (!SHA256_HEX.test(String(receipt.original_sha256_before)) || !SHA256_HEX.test(String(receipt.backup_sha256))) {
    return 'activation receipt carries no sha256 for the original database and its backup';
  }
  if (typeof receipt.backup_path !== 'string' || receipt.backup_path === '') return 'activation receipt names no backup';
  if (receipt.user_version_before !== OPERATIONAL_SCHEMA_VERSION || receipt.user_version_after !== activatedVersion) {
    return 'activation receipt versions disagree with the activated database';
  }
  if (!Array.isArray(receipt.applied_migrations) || receipt.applied_migrations.length === 0)
    return 'activation receipt applied no migrations';
  const versionProblem = receiptWindowProblem(receipt);
  if (versionProblem) return versionProblem;
  const started = typeof receipt.started_at === 'string' ? Date.parse(receipt.started_at) : Number.NaN;
  const finished = typeof receipt.finished_at === 'string' ? Date.parse(receipt.finished_at) : Number.NaN;
  if (Number.isNaN(started) || Number.isNaN(finished) || started > finished) return 'activation receipt has no coherent apply interval';
  return null;
}

/**
 * The database must carry the activation marker and the receipt must be the one the apply writes beside its backup,
 * for this very file and at the version the database now has. A hand-made file that skips any of that does not pass.
 */
function loadApplyReceipt(databasePath, adr, receiptPath) {
  if (typeof databasePath !== 'string' || !fs.existsSync(databasePath)) return { reason: 'no database to inspect' };
  let activatedVersion;
  let db;
  try {
    db = new Database(path.resolve(databasePath), { readonly: true, fileMustExist: true });
    const classification = classifyExecutionActivation(db);
    if (classification.state !== 'activated') return { reason: 'database is not activated through the apply command' };
    activatedVersion = classification.user_version;
  } catch (error) {
    return { reason: `database cannot be classified as activated: ${error.message}` };
  } finally {
    if (db) db.close();
  }
  if (typeof receiptPath !== 'string' || !isRegularFile(receiptPath)) return { reason: 'no activation receipt was provided' };
  const receipt = readJsonObject(receiptPath);
  if (!receipt) return { reason: 'activation receipt is not a JSON object' };
  if (receipt.adr !== adr || receipt.adr_status !== 'Accepted') {
    return { reason: `activation receipt was not written by an apply of ${adr} Accepted` };
  }
  if (typeof receipt.database_path !== 'string' || !fs.existsSync(receipt.database_path)) {
    return { reason: 'activation receipt names no existing database' };
  }
  if (fs.realpathSync(receipt.database_path) !== fs.realpathSync(databasePath))
    return { reason: 'activation receipt belongs to another database' };
  const shape = receiptShapeProblem(receipt, activatedVersion);
  if (shape) return { reason: shape };
  if (path.resolve(receiptPath) !== `${path.resolve(receipt.backup_path)}.receipt.json`) {
    return { reason: 'activation receipt is not at the path the apply writes, beside its backup' };
  }
  return { receipt, reason: null };
}

/** 2(b2): the backup the receipt names exists, has the recorded digest, is the original database and passes integrity_check. */
function backupReason(receipt) {
  if (!receipt) return 'backup cannot be verified without a valid activation receipt';
  if (!isRegularFile(receipt.backup_path)) return 'the backup named by the receipt does not exist as a regular file';
  const digest = sha256File(receipt.backup_path);
  if (digest !== receipt.backup_sha256 || digest !== receipt.original_sha256_before) {
    return 'the backup sha256 differs from the digest recorded in the receipt';
  }
  try {
    return withVerificationCopy(receipt.backup_path, (copy) => {
      if (integrityCheck(copy) !== 'ok') return 'integrity_check failed on the backup';
      if (copy.pragma('user_version', { simple: true }) !== OPERATIONAL_SCHEMA_VERSION) return 'the backup is not a schema-v4 database';
      return null;
    });
  } catch (error) {
    return `the backup cannot be opened: ${error.message}`;
  }
}

const ISO_INSTANT_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The window record must bind the pre-apply database digest, name who stopped which consumers, and precede the apply. */
function windowRecordProblem(record, originalSha256, startedAt) {
  if (typeof record.operator !== 'string' || record.operator.trim() === '') return 'supervised-window record names no operator';
  const stopped = record.stopped_consumers;
  if (!Array.isArray(stopped) || stopped.length === 0 || stopped.some((name) => typeof name !== 'string' || name.trim() === '')) {
    return 'supervised-window record lists no stopped consumers by name';
  }
  if (!SHA256_HEX.test(String(record.original_sha256_before)) || record.original_sha256_before !== originalSha256) {
    return 'supervised-window record is not bound to the database digest in the receipt';
  }
  const stamp = record.recorded_at;
  const recorded = typeof stamp === 'string' && ISO_INSTANT_WITH_ZONE.test(stamp) ? Date.parse(stamp) : Number.NaN;
  if (Number.isNaN(recorded) || recorded >= Date.parse(startedAt)) {
    return 'supervised-window record has no valid ISO 8601 instant with an explicit zone, strictly before the apply started';
  }
  return null;
}

/**
 * A receipt that carries `window` binds the window file by digest: the file supplied to the gate (or, without one, the
 * path the receipt recorded) must still have that digest, so a window rewritten after the apply no longer passes.
 */
function windowReason(windowPath, receipt) {
  const bound = receipt && receipt.window ? receipt.window : null;
  const file = typeof windowPath === 'string' ? windowPath : bound && bound.path;
  if (typeof file !== 'string' || !isRegularFile(file)) return 'no supervised-window record was provided';
  const bytes = fs.readFileSync(file);
  const record = parseJsonObject(bytes);
  if (!record) return 'supervised-window record is not a JSON object';
  if (!receipt) return 'supervised-window record cannot be bound without a valid activation receipt';
  if (bound && createHash('sha256').update(bytes).digest('hex') !== bound.sha256) {
    return 'supervised-window record differs from the digest bound in the receipt';
  }
  return windowRecordProblem(record, receipt.original_sha256_before, receipt.started_at);
}

/** Reads and validates the window named at apply. Returns the record and the digest of the exact bytes it was read from. */
function readApplyWindow(windowPath, originalSha256, startedAt) {
  const invalid = (reason) =>
    new ExecutionActivationError('EXECUTION_ACTIVATION_WINDOW_INVALID', `Supervised window ${windowPath}: ${reason}`);
  const resolved = path.resolve(windowPath);
  if (!isRegularFile(resolved)) throw invalid('no supervised-window record was provided');
  const bytes = fs.readFileSync(resolved);
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw invalid('supervised-window record is not a JSON object');
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record))
    throw invalid('supervised-window record is not a JSON object');
  const problem = windowRecordProblem(record, originalSha256, startedAt);
  if (problem) throw invalid(problem);
  return { path: resolved, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * Read-only check of the ADR-0048 activation criterion for one database. Each condition carries the ADR item it
 * answers; the gate is satisfied only when every one is met. The items a rehearsal cannot verify are always pending
 * with a reason, so today the gate never closes on its own: a missing proof is never inferred. Never writes and never
 * throws on missing evidence. `inspectDatabase: false` skips opening the database (the rehearsal must not touch the
 * live file) and leaves the authorization pending. `backupPath` names the default receipt (`<backup>.receipt.json`).
 */
function verifyActivationCriterion(databasePath, opts = {}) {
  const { adr = 'ADR-0048', backupPath, windowPath, internal, inspectDatabase = true } = opts;
  const receiptPath = opts.receiptPath || (typeof backupPath === 'string' ? `${backupPath}.receipt.json` : undefined);
  const loaded = inspectDatabase
    ? loadApplyReceipt(databasePath, adr, receiptPath)
    : { reason: 'database not inspected: a pre-activation rehearsal can only prove authorization on the activated database' };
  const conditions = [
    criterionCondition('adr_accepted', '6', adrCriterionReason(adr, internal)),
    criterionCondition('database_authorized', '1, 6', loaded.reason),
    criterionCondition('backup_integrity', '2(b2)', backupReason(loaded.receipt)),
    criterionCondition('supervised_window', '7', windowReason(windowPath, loaded.receipt)),
    ...UNVERIFIABLE_CRITERION.map(([id, item, missing]) => criterionCondition(id, item, `não verificável pelo ensaio: ${missing}`)),
  ];
  return { gate: ACTIVATION_CRITERION_GATE, satisfied: conditions.every((condition) => condition.met), adr, conditions };
}

/**
 * The commit of the code that is running. Only a checkout rooted exactly at REPOSITORY_ROOT answers for it: an
 * immutable release has no .git, and git would otherwise resolve an unrelated ancestor repository. A release directory
 * is named after the commit it was built from, so that name is the identity there.
 */
function currentCommit() {
  const git = (...args) =>
    execFileSync('git', args, { cwd: REPOSITORY_ROOT, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
      .toString()
      .trim();
  try {
    if (fs.realpathSync(git('rev-parse', '--show-toplevel')) === fs.realpathSync(REPOSITORY_ROOT)) return git('rev-parse', 'HEAD') || null;
  } catch {
    // Not a checkout: fall through to the release identity.
  }
  const releaseName = path.basename(fs.realpathSync(REPOSITORY_ROOT));
  return /^[\da-f]{40}$/.test(releaseName) ? releaseName : null;
}

/**
 * Byte copy of the checkpointed database. The caller holds BEGIN IMMEDIATE on another connection, so no writer can
 * change the file and the truncated WAL leaves nothing pending; the copy is therefore the exact original bytes.
 */
function backupBytes(databasePath, backupPath) {
  fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backupPath, 0o600);
  const descriptor = fs.openSync(backupPath, 'r+');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
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
  const { backupDir, now = Date.now, dryRun = false, internal, windowPath } = opts;
  const { migrationsDirectory } = activationInternals(internal);
  const plan = planExecutionLedgerActivation(databasePath, opts);
  if (dryRun) return { dry_run: true, plan };
  if (!plan.ready) {
    const [first] = plan.blockers;
    throw new ExecutionActivationError(first.code, first.message, { blockers: plan.blockers });
  }
  const startedAt = new Date(now()).toISOString();
  // The window is judged before anything is written: an invalid record refuses the apply with the database untouched.
  const preLockSha256 = windowPath === undefined ? null : sha256File(plan.database_path);
  const windowRef = windowPath === undefined ? null : readApplyWindow(windowPath, preLockSha256, startedAt);
  const createdBackupDir = fs.mkdirSync(path.dirname(plan.backup_path), { recursive: true, mode: 0o700 });
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
    if (windowRef && originalSha256 !== preLockSha256) {
      // The checkpoint folded a WAL into the file, so the digest the window binds is stale. Nothing else is written yet.
      if (createdBackupDir) fs.rmSync(createdBackupDir, { recursive: true, force: true });
      throw new ExecutionActivationError(
        'EXECUTION_ACTIVATION_WINDOW_INVALID',
        'Database changed after the supervised window was validated',
      );
    }
    for (const sidecar of [`${plan.database_path}-wal`, `${plan.database_path}-shm`]) {
      if (sidecar.endsWith('-wal') && fs.existsSync(sidecar) && fs.statSync(sidecar).size > 0) {
        throw lockedError(plan.database_path, 'WAL sidecar still holds data after the checkpoint');
      }
    }
    backupBytes(plan.database_path, plan.backup_path);
    fsyncDirectory(path.dirname(plan.backup_path));
    const backupSha256 = sha256File(plan.backup_path);
    if (backupSha256 !== originalSha256 || sha256File(plan.database_path) !== originalSha256) {
      fs.rmSync(plan.backup_path, { force: true });
      throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_HASH_MISMATCH', 'Backup bytes differ from the original database');
    }
    withVerificationCopy(plan.backup_path, (backupCheck) => {
      if (integrityCheck(backupCheck) !== 'ok') {
        throw new ExecutionActivationError('EXECUTION_ACTIVATION_INTEGRITY_FAILED', 'integrity_check failed on the backup');
      }
    });

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
      receipt_version: 2,
      adr: plan.adr,
      adr_status: plan.adr_status,
      adr_sha256: plan.adr_sha256,
      unscannable_processes: plan.unscannable_processes,
      commit: currentCommit(),
      database_path: plan.database_path,
      backup_path: plan.backup_path,
      original_sha256_before: originalSha256,
      backup_sha256: backupSha256,
      user_version_before: version,
      user_version_after: versionAfter,
      applied_migrations: applied,
      started_at: startedAt,
      finished_at: new Date(now()).toISOString(),
      ...(windowRef ? { window: windowRef } : {}),
    };
    fs.writeFileSync(plan.receipt_path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    try {
      db.pragma(`application_id = ${ACTIVATION_APPLICATION_ID}`);
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

function readReceipt(receiptFile) {
  if (!fs.existsSync(receiptFile)) return null;
  const invalid = (reason) =>
    new ExecutionActivationError('EXECUTION_ACTIVATION_RECEIPT_INVALID', `Receipt ${receiptFile} is invalid: ${reason}`);
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  } catch (error) {
    throw invalid(error.message);
  }
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) throw invalid('not an object');
  if (receipt.original_sha256_before !== undefined && !SHA256_HEX.test(String(receipt.original_sha256_before))) {
    throw invalid('original_sha256_before is not a sha256');
  }
  const windowProblem = receiptWindowProblem(receipt);
  if (windowProblem) throw invalid(windowProblem);
  return receipt;
}

/**
 * Restores a verified backup over an activated database. The activated database is preserved next to it
 * (ADR-0022: the ledger is never deleted during rollback) and the swap is an atomic rename.
 */
async function restoreExecutionLedgerBackup(databasePath, opts = {}) {
  const { backupPath, expectedSha256, receiptPath, allowMissingReceipt = false, now = Date.now } = opts;
  let resolved = path.resolve(databasePath);
  if (!backupPath) throw new ExecutionActivationError('EXECUTION_ACTIVATION_BACKUP_REQUIRED', 'A backup path is required');
  if (typeof expectedSha256 !== 'string' || !SHA256_HEX.test(expectedSha256)) {
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
  resolved = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
  const receiptFile = receiptPath ? path.resolve(receiptPath) : `${backup}.receipt.json`;
  const receipt = readReceipt(receiptFile);

  let contentMatchesOriginal = null;
  withVerificationCopy(backup, (check) => {
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
  });
  const receiptVerified = Boolean(receipt && receipt.original_sha256_before);
  if (!receiptVerified && allowMissingReceipt !== true) {
    throw new ExecutionActivationError(
      'EXECUTION_ACTIVATION_RECEIPT_REQUIRED',
      `No activation receipt with original_sha256_before at ${receiptFile}; pass --receipt <path> to point at it or --allow-missing-receipt to restore without verifying the original content`,
    );
  }
  if (receiptVerified) {
    contentMatchesOriginal = receipt.original_sha256_before === expectedSha256;
    if (!contentMatchesOriginal) {
      throw new ExecutionActivationError(
        'EXECUTION_ACTIVATION_BACKUP_CONTENT_MISMATCH',
        'Backup sha256 differs from the original database recorded in the receipt',
      );
    }
  }

  const scan = findDatabaseHolders(resolved);
  if (scan.unavailable) {
    throw new ExecutionActivationError(
      'EXECUTION_ACTIVATION_PROC_SCAN_UNAVAILABLE',
      'Cannot enumerate processes to prove the database is not open elsewhere',
    );
  }
  if (scan.holders.length > 0) throw lockedError(resolved, `open in process(es): ${scan.holders.join(', ')}`);
  const lock = lockForActivation(resolved);
  let activated;
  try {
    activated = lock.pragma('user_version', { simple: true }) > OPERATIONAL_SCHEMA_VERSION || executionTableNames(lock).length > 0;
  } finally {
    lock.close();
  }
  if (!activated) {
    throw new ExecutionActivationError(
      'EXECUTION_ACTIVATION_ROLLBACK_NOT_ACTIVATED',
      'Rollback applies only to a database with the execution ledger activated',
    );
  }
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
    fsyncDirectory(path.dirname(resolved));
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }

  const restoredSha256 = sha256File(resolved);
  // Verified on a private copy: a read-only open of a WAL database would leave sidecars next to the restored file.
  const restoredVersion = withVerificationCopy(resolved, (verify) => verify.pragma('user_version', { simple: true }));
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
    post_activation_writes_preserved_at: preserved,
    content_matches_original: contentMatchesOriginal,
    receipt_verified: receiptVerified,
  };
}

module.exports = {
  ACTIVATION_CRITERION_GATE,
  activateExecutionLedger,
  assertOperationalSchemaBoundary,
  assertPendingFixturePath,
  currentCommit,
  DEFAULT_STATE_DB,
  MIGRATIONS_DIRECTORY,
  OPERATIONAL_SCHEMA_VERSION,
  openOperationalStateDatabase,
  planExecutionLedgerActivation,
  resolveGovernedExecutionMode,
  restoreExecutionLedgerBackup,
  verifyActivationCriterion,
};
