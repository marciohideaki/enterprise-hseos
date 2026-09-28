'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');

const PENDING_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations-pending-activation');
const BASE_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const FIXTURE_PREFIX = 'hseos-ledger-fixture-';
const FIXTURE_MARKER = '.hseos-ledger-fixture.json';
const FIXTURE_DATABASE = 'ledger.sqlite';
const fixtureIdentities = new WeakMap();

class ExecutionLedgerActivationError extends Error {
  constructor(databaseName) {
    super(`Execution ledger schema activation is limited to temporary fixtures: ${databaseName}`);
    this.name = 'ExecutionLedgerActivationError';
    this.code = 'EXECUTION_LEDGER_OPERATIONAL_MIGRATION_REQUIRES_APPROVAL';
  }
}

/**
 * Apply the accepted schema only to an in-memory fixture. File-backed fixtures
 * must be created atomically by createExecutionLedgerFileFixture(); arbitrary
 * paths are rejected so symlink/hardlink aliases cannot cross the gate.
 * Operational activation remains gated by the accepted ADR compatibility window.
 * @param {import('better-sqlite3').Database} db
 * @returns {{applied: string[], current: number}}
 */
function applyExecutionLedgerFixtureSchema(db) {
  if (!db || db.name !== ':memory:') throw new ExecutionLedgerActivationError(db && db.name);
  return runMigrations(db, PENDING_MIGRATIONS_DIR, { log: () => {} });
}

function fixtureMarker() {
  return {
    schema_version: 1,
    artifact_type: 'hseos-temporary-execution-ledger',
    database: FIXTURE_DATABASE,
    operational: false,
  };
}

function assertTemporaryFixtureDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new ExecutionLedgerActivationError(directory);
  }
  const requestedStat = fs.lstatSync(directory);
  if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) throw new ExecutionLedgerActivationError(directory);
  const canonical = fs.realpathSync(directory);
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  if (path.dirname(canonical) !== temporaryRoot || !path.basename(canonical).startsWith(FIXTURE_PREFIX)) {
    throw new ExecutionLedgerActivationError(directory);
  }
  const directoryStat = fs.lstatSync(canonical);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new ExecutionLedgerActivationError(directory);

  const markerPath = path.join(canonical, FIXTURE_MARKER);
  const markerStat = fs.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1) {
    throw new ExecutionLedgerActivationError(directory);
  }
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    throw new ExecutionLedgerActivationError(directory);
  }
  if (JSON.stringify(marker) !== JSON.stringify(fixtureMarker())) throw new ExecutionLedgerActivationError(directory);

  const filename = path.join(canonical, FIXTURE_DATABASE);
  const databaseStat = fs.lstatSync(filename);
  if (!databaseStat.isFile() || databaseStat.isSymbolicLink() || databaseStat.nlink !== 1) {
    throw new ExecutionLedgerActivationError(filename);
  }
  if (fs.realpathSync(filename) !== filename) throw new ExecutionLedgerActivationError(filename);
  return { directory: canonical, filename };
}

/** Validate a workspace view against the containing fixture without opening another ledger. */
function assertExecutionLedgerView(db, directory) {
  const resolved = fs.realpathSync(directory);
  const relative = path.relative(fs.realpathSync(os.tmpdir()), resolved);
  const root = path.join(fs.realpathSync(os.tmpdir()), relative.split(path.sep)[0]);
  const fixture = assertTemporaryFixtureDirectory(root);
  const identity = db && fixtureIdentities.get(db);
  const current = fs.lstatSync(fixture.filename);
  if (!identity || db.name !== fixture.filename || identity.ino !== current.ino || identity.dev !== current.dev)
    throw Object.assign(new Error('JOB_LEDGER_MISMATCH'), { code: 'JOB_LEDGER_MISMATCH' });
  return { directory: resolved, filename: fixture.filename };
}

function fixtureHandle(db, directory, filename, identity = fs.lstatSync(filename)) {
  const current = fs.lstatSync(filename);
  if (identity.ino !== current.ino || identity.dev !== current.dev) throw new ExecutionLedgerActivationError(filename);
  fixtureIdentities.set(db, { ino: identity.ino, dev: identity.dev });
  return {
    db,
    directory,
    filename,
    close() {
      if (db.open) db.close();
    },
    cleanup() {
      if (db.open) db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createExecutionLedgerFileFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  fs.chmodSync(directory, 0o700);
  const filename = path.join(directory, FIXTURE_DATABASE);
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    runMigrations(db, BASE_MIGRATIONS_DIR, { log: () => {} });
    runMigrations(db, PENDING_MIGRATIONS_DIR, { log: () => {} });
    fs.writeFileSync(path.join(directory, FIXTURE_MARKER), JSON.stringify(fixtureMarker()), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return fixtureHandle(db, directory, filename);
}

function openExecutionLedgerFileFixture(directory) {
  const fixture = assertTemporaryFixtureDirectory(directory);
  const identity = fs.lstatSync(fixture.filename);
  const db = new Database(fixture.filename);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    const requiredTables = ['execution_event_schemas', 'execution_events'];
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (requiredTables.some((name) => !tables.has(name))) throw new ExecutionLedgerActivationError(fixture.filename);
    return fixtureHandle(db, fixture.directory, fixture.filename, identity);
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = {
  assertTemporaryFixtureDirectory,
  assertExecutionLedgerView,
  applyExecutionLedgerFixtureSchema,
  createExecutionLedgerFileFixture,
  openExecutionLedgerFileFixture,
  ExecutionLedgerActivationError,
  PENDING_MIGRATIONS_DIR,
};
