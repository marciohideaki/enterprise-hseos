'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { GovernanceRepositoryError } = require('../../domain/repository-port');

const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const MAX_MIGRATION_BYTES = 2 * 1024 * 1024;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readMigrations(migrationsDirectory) {
  const absoluteDirectory = path.resolve(migrationsDirectory);
  const directoryStat = await fs.promises.lstat(absoluteDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new GovernanceRepositoryError('migration directory must be a real directory', 'MANAGED_GOVERNANCE_MIGRATION_INVALID');
  }
  if ((await fs.promises.realpath(absoluteDirectory)) !== absoluteDirectory) {
    throw new GovernanceRepositoryError('migration directory must use its canonical real path', 'MANAGED_GOVERNANCE_MIGRATION_INVALID');
  }
  const names = (await fs.promises.readdir(absoluteDirectory)).sort(compareText);
  if (names.length === 0 || names.some((name) => !MIGRATION_NAME.test(name))) {
    throw new GovernanceRepositoryError(
      'migration directory contains missing or invalid migration names',
      'MANAGED_GOVERNANCE_MIGRATION_INVALID',
    );
  }
  const migrations = [];
  for (const name of names) {
    const filename = path.join(absoluteDirectory, name);
    const stat = await fs.promises.lstat(filename, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(MAX_MIGRATION_BYTES)) {
      throw new GovernanceRepositoryError('migration must be a bounded regular file', 'MANAGED_GOVERNANCE_MIGRATION_INVALID');
    }
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    let handle;
    try {
      handle = await fs.promises.open(filename, flags);
    } catch {
      throw new GovernanceRepositoryError('migration could not be opened safely', 'MANAGED_GOVERNANCE_MIGRATION_INVALID');
    }
    let bytes;
    try {
      const before = await handle.stat({ bigint: true });
      if (before.dev !== stat.dev || before.ino !== stat.ino || before.nlink !== 1n || !before.isFile()) {
        throw new GovernanceRepositoryError('migration identity changed before read', 'MANAGED_GOVERNANCE_MIGRATION_INVALID');
      }
      bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs ||
        BigInt(bytes.length) !== before.size
      ) {
        throw new GovernanceRepositoryError('migration changed while being read', 'MANAGED_GOVERNANCE_MIGRATION_INVALID');
      }
    } finally {
      await handle.close();
    }
    let sql;
    try {
      sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new GovernanceRepositoryError('migration must be valid UTF-8', 'MANAGED_GOVERNANCE_MIGRATION_INVALID');
    }
    migrations.push({
      version: name.slice(0, 4),
      name,
      checksum: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
      sql,
    });
  }
  return Object.freeze(migrations.map(Object.freeze));
}

async function migrate(pool, options = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new GovernanceRepositoryError('a PostgreSQL pool is required', 'MANAGED_GOVERNANCE_POSTGRES_CONFIG_INVALID');
  }
  const migrationsDirectory = options.migrationsDirectory || path.resolve(__dirname, '../../../migrations');
  const migrations = await readMigrations(migrationsDirectory);
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('hseos-governance-migrations', 0))");
    await client.query('CREATE SCHEMA IF NOT EXISTS hseos_governance');
    await client.query(`
      CREATE TABLE IF NOT EXISTS hseos_governance.schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        checksum text NOT NULL CHECK (checksum ~ '^sha256:[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL
      )
    `);
    const existing = await client.query('SELECT version, name, checksum FROM hseos_governance.schema_migrations ORDER BY version');
    const existingByVersion = new Map(existing.rows.map((row) => [row.version, row]));
    for (const migration of migrations) {
      const receipt = existingByVersion.get(migration.version);
      if (receipt) {
        if (receipt.name !== migration.name || receipt.checksum !== migration.checksum) {
          throw new GovernanceRepositoryError('applied migration differs from its immutable file', 'MANAGED_GOVERNANCE_MIGRATION_DRIFT', {
            version: migration.version,
          });
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO hseos_governance.schema_migrations(version, name, checksum, applied_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [migration.version, migration.name, migration.checksum],
      );
      applied.push(migration.name);
    }
    await client.query('COMMIT');
    return Object.freeze({ applied: Object.freeze(applied), current_version: migrations.at(-1).version });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original error remains authoritative.
    }
    if (error instanceof GovernanceRepositoryError) throw error;
    throw new GovernanceRepositoryError('PostgreSQL migration failed', 'MANAGED_GOVERNANCE_MIGRATION_FAILED', {
      database_code: typeof error?.code === 'string' ? error.code : null,
    });
  } finally {
    client.release();
  }
}

module.exports = {
  migrate,
  readMigrations,
};
