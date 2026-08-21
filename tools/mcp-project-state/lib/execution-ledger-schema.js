'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');

const PENDING_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations-pending-activation');
const BASE_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

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
 * Operational activation remains a separate human gate.
 * @param {import('better-sqlite3').Database} db
 * @returns {{applied: string[], current: number}}
 */
function applyExecutionLedgerFixtureSchema(db) {
  if (!db || db.name !== ':memory:') throw new ExecutionLedgerActivationError(db && db.name);
  return runMigrations(db, PENDING_MIGRATIONS_DIR, { log: () => {} });
}

function createExecutionLedgerFileFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-ledger-fixture-'));
  fs.chmodSync(directory, 0o700);
  const filename = path.join(directory, 'ledger.sqlite');
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    runMigrations(db, BASE_MIGRATIONS_DIR, { log: () => {} });
    runMigrations(db, PENDING_MIGRATIONS_DIR, { log: () => {} });
  } catch (error) {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    db,
    directory,
    filename,
    cleanup() {
      if (db.open) db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

module.exports = {
  applyExecutionLedgerFixtureSchema,
  createExecutionLedgerFileFixture,
  ExecutionLedgerActivationError,
  PENDING_MIGRATIONS_DIR,
};
