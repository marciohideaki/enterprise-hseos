'use strict';

const path = require('node:path');

let AgentStateDAL;
try {
  AgentStateDAL = require('../../mcp-project-state/lib/agent-state-dal').AgentStateDAL;
} catch {
  AgentStateDAL = null;
}

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

const NO_OP_DAL = {
  createRun: () => ({ id: 'noop', message: 'better-sqlite3 not available' }),
  listRuns: () => [],
  getRun: () => null,
};

function createDal(dbPath) {
  if (!Database || !AgentStateDAL) return NO_OP_DAL;
  try {
    const fs = require('node:fs');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    const dal = new AgentStateDAL(db);
    return { dal, db };
  } catch {
    return NO_OP_DAL;
  }
}

module.exports = { createDal, NO_OP_DAL };
