/**
 * Migration runner for HSEOS project-state SQLite database.
 *
 * Discovers `*.sql` files in the migrations directory, sorts by NNN prefix,
 * and applies any whose number is greater than the current `PRAGMA user_version`.
 * Each successful migration bumps user_version to its NNN value.
 *
 * Idempotent: safe to re-run; already-applied migrations are skipped.
 */

const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_FILE_PATTERN = /^(\d{3,})-[\w-]+\.sql$/;

function listMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .map((name) => {
      const match = name.match(MIGRATION_FILE_PATTERN);
      if (!match) return null;
      return { name, version: parseInt(match[1], 10), fullPath: path.join(migrationsDir, name) };
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

function getCurrentVersion(db) {
  const row = db.pragma('user_version', { simple: true });
  return typeof row === 'number' ? row : 0;
}

function setVersion(db, version) {
  db.pragma(`user_version = ${version}`);
}

/**
 * Run pending migrations against `db`.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} migrationsDir Absolute path to migrations directory.
 * @param {object} [options]
 * @param {(level: 'info'|'warn'|'error', msg: string) => void} [options.log] Optional logger.
 * @returns {{applied: string[], current: number}}
 */
function runMigrations(db, migrationsDir, options = {}) {
  const log = options.log || ((level, msg) => console.log(`[migrations:${level}] ${msg}`));
  const migrations = listMigrations(migrationsDir);
  const current = getCurrentVersion(db);
  const applied = [];

  if (migrations.length === 0) {
    log('info', `no migrations found in ${migrationsDir}`);
    return { applied, current };
  }

  for (const m of migrations) {
    if (m.version <= current) continue;
    const sql = fs.readFileSync(m.fullPath, 'utf8');
    try {
      db.exec('BEGIN');
      db.exec(sql);
      setVersion(db, m.version);
      db.exec('COMMIT');
      applied.push(m.name);
      log('info', `applied ${m.name} (user_version → ${m.version})`);
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      log('error', `failed ${m.name}: ${error.message}`);
      throw error;
    }
  }

  return { applied, current: getCurrentVersion(db) };
}

module.exports = { runMigrations, listMigrations };
