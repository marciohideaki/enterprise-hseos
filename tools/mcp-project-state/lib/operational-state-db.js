'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrations } = require('./migrations');
const { PENDING_MIGRATIONS_DIR } = require('./execution-ledger-schema');

const DEFAULT_STATE_DB = path.join(process.cwd(), '.hseos', 'state', 'project.db');
const MIGRATIONS_DIRECTORY = path.join(__dirname, '..', 'migrations');
const OPERATIONAL_SCHEMA_VERSION = 4;
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
    db.pragma('journal_mode = WAL');
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

module.exports = {
  assertOperationalSchemaBoundary,
  assertPendingFixturePath,
  DEFAULT_STATE_DB,
  MIGRATIONS_DIRECTORY,
  OPERATIONAL_SCHEMA_VERSION,
  openOperationalStateDatabase,
};
