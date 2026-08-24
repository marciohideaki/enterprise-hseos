'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrations } = require('../mcp-project-state/lib/migrations');
const { assertStableReadOnlyDatabase, readMcpLegacyActivationReadiness } = require('../mcp-project-state/lib/mcp-legacy-usage-store');

const LEGACY_SERVER_IDS = Object.freeze(['axon_bridge', 'governance', 'project_state', 'swarm']);
const RETIREMENT_DEADLINE = '2026-11-30';
const ACTIVATION_DEADLINE = '2026-10-31';
const RETIRED_INTERNAL_SYMBOLS = Object.freeze([
  'toColonName',
  'toColonPath',
  'customAgentColonName',
  'isColonFormat',
  'parseColonName',
  'toUnderscoreName',
  'toUnderscorePath',
  'customAgentUnderscoreName',
  'isUnderscoreFormat',
  'parseUnderscoreName',
  'writeColonArtifacts',
  'generateColonTaskToolCommands',
  'getCustomAgentColonName',
]);

function sha256File(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function databaseFingerprint(databasePath) {
  return Object.fromEntries(
    [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`]
      .filter((filename) => fs.existsSync(filename))
      .map((filename) => [path.basename(filename), { bytes: fs.statSync(filename).size, sha256: sha256File(filename) }]),
  );
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeSqlValue(value) {
  if (Buffer.isBuffer(value)) return { $blob: value.toString('base64') };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  return value;
}

function tableDigest(db, tableName) {
  const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`).all();
  const normalized = rows
    .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeSqlValue(value)]))))
    .sort();
  const schema = db
    .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name = ? OR tbl_name = ? ORDER BY type, name')
    .all(tableName, tableName);
  return {
    rows: rows.length,
    data_sha256: createHash('sha256').update(normalized.join('\n')).digest('hex'),
    schema_sha256: createHash('sha256').update(JSON.stringify(schema)).digest('hex'),
  };
}

function snapshotTables(db) {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(({ name }) => name);
  return Object.fromEntries(names.map((name) => [name, tableDigest(db, name)]));
}

async function migrationDryRun(databasePath, repositoryRoot) {
  assertStableReadOnlyDatabase(databasePath);
  const sourceFingerprintBefore = databaseFingerprint(databasePath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compat-dry-run-'));
  fs.chmodSync(directory, 0o700);
  const fixturePath = path.join(directory, 'project.db');
  let fixture;
  let result;
  try {
    fs.copyFileSync(databasePath, fixturePath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(fixturePath, 0o600);
    fixture = new Database(fixturePath);
    fixture.pragma('foreign_keys = ON');
    const sourceVersion = fixture.pragma('user_version', { simple: true });
    const before = snapshotTables(fixture);
    const migrationResult = runMigrations(
      fixture,
      path.join(repositoryRoot, 'tools', 'mcp-project-state', 'migrations-pending-activation'),
      { log: () => {} },
    );
    const integrity = fixture.pragma('integrity_check').map((row) => row.integrity_check);
    const after = snapshotTables(fixture);
    const changedLegacyTables = Object.entries(before)
      .filter(([name, digest]) => JSON.stringify(after[name]) !== JSON.stringify(digest))
      .map(([name]) => name);
    const targetVersion = fixture.pragma('user_version', { simple: true });
    result = {
      ready:
        sourceVersion === 4 && targetVersion === 9 && integrity.length === 1 && integrity[0] === 'ok' && changedLegacyTables.length === 0,
      source_version: sourceVersion,
      target_version: targetVersion,
      applied: migrationResult.applied,
      integrity,
      preserved_legacy_tables: Object.keys(before).length,
      changed_legacy_tables: changedLegacyTables,
    };
  } finally {
    if (fixture?.open) fixture.close();
    fs.rmSync(directory, { force: true, recursive: true });
  }
  const sourceFingerprintAfter = databaseFingerprint(databasePath);
  const operationalUnchanged = JSON.stringify(sourceFingerprintBefore) === JSON.stringify(sourceFingerprintAfter);
  return Object.freeze({
    ...result,
    ready: result.ready && operationalUnchanged,
    operational_files_before: sourceFingerprintBefore,
    operational_files_after: sourceFingerprintAfter,
    operational_unchanged: operationalUnchanged,
  });
}

function listRuntimeFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listRuntimeFiles(entryPath));
    else if (entry.isFile() && /\.(?:c?js|mjs|ps1|sh)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function lineMatches(root, filename, pattern) {
  const relative = path.relative(root, filename).replaceAll(path.sep, '/');
  return fs
    .readFileSync(filename, 'utf8')
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter(({ text }) => pattern.test(text))
    .map(({ line }) => `${relative}:${line}`);
}

function scanInternalCompatibilityCallers(repositoryRoot) {
  const files = ['tools', 'src']
    .flatMap((runtimeRoot) => listRuntimeFiles(path.join(repositoryRoot, runtimeRoot)))
    .filter((filename) => filename !== __filename);
  const retiredSymbolPattern = new RegExp(`\\b(?:${RETIRED_INTERNAL_SYMBOLS.join('|')})\\b`);
  const retiredSymbolCallers = files.flatMap((filename) => lineMatches(repositoryRoot, filename, retiredSymbolPattern));
  const legacyMcpCallers = files
    .filter((filename) => !filename.endsWith(path.join('tools', 'lib', 'legacy-mcp-server.js')))
    .flatMap((filename) => lineMatches(repositoryRoot, filename, /\bstartLegacyMcpServer\b/));
  const legacyStatePattern =
    /(?:['"](?:state_write|tasks_add|tasks_update)['"]|\bcmd_(?:state_write|tasks_add)\b|\b(?:INSERT INTO|UPDATE) (?:state|tasks)\b)/;
  const legacyStateWrites = files.flatMap((filename) => lineMatches(repositoryRoot, filename, legacyStatePattern));
  return Object.freeze({
    retired_internal_symbols: retiredSymbolCallers,
    retired_internal_symbols_zero: retiredSymbolCallers.length === 0,
    active_legacy_mcp_entrypoints: legacyMcpCallers,
    active_legacy_state_writes: legacyStateWrites,
    legacy_runtime_zero: legacyMcpCallers.length === 0 && legacyStateWrites.length === 0,
  });
}

function summarizeTelemetry(readiness) {
  return Object.freeze({
    ready: readiness.ready,
    days: readiness.days,
    gap_count: readiness.gaps.length,
    gaps_sample: readiness.gaps.slice(0, 20),
    integrity_errors: readiness.integrity_errors,
    legacy_use: readiness.legacy_use,
  });
}

async function auditCompatibility({ repositoryRoot, projectDirectory = repositoryRoot, asOf = new Date() }) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolvedProject = path.resolve(projectDirectory);
  const stateDirectory = path.join(resolvedProject, '.hseos', 'state');
  const operationalDatabase = path.join(stateDirectory, 'project.db');
  const telemetryDatabase = path.join(stateDirectory, 'mcp-legacy-usage.db');
  const callers = scanInternalCompatibilityCallers(resolvedRoot);

  let telemetry;
  if (fs.existsSync(telemetryDatabase)) {
    const filesBefore = databaseFingerprint(telemetryDatabase);
    try {
      const readiness = summarizeTelemetry(
        readMcpLegacyActivationReadiness(telemetryDatabase, { serverIds: LEGACY_SERVER_IDS, asOf, days: 30 }),
      );
      const filesAfter = databaseFingerprint(telemetryDatabase);
      const unchanged = JSON.stringify(filesBefore) === JSON.stringify(filesAfter);
      telemetry = { ...readiness, ready: readiness.ready && unchanged, files_before: filesBefore, files_after: filesAfter, unchanged };
    } catch (error) {
      telemetry = {
        ready: false,
        error: error.message,
        files_before: filesBefore,
        files_after: databaseFingerprint(telemetryDatabase),
      };
    }
  } else {
    telemetry = { ready: false, error: 'legacy telemetry database is absent' };
  }

  let migration;
  if (fs.existsSync(operationalDatabase)) {
    try {
      migration = await migrationDryRun(operationalDatabase, resolvedRoot);
    } catch (error) {
      migration = { ready: false, error: error.message };
    }
  } else {
    migration = { ready: false, error: 'operational project database is absent' };
  }

  const evidenceReady =
    telemetry.ready &&
    migration.ready &&
    migration.operational_unchanged &&
    callers.retired_internal_symbols_zero &&
    callers.legacy_runtime_zero;
  return Object.freeze({
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    as_of: new Date(asOf).toISOString(),
    decision_authority: ['ADR-0022', 'ADR-0023'],
    deadlines: { activation_no_later_than: ACTIVATION_DEADLINE, compatibility_removal_by: RETIREMENT_DEADLINE },
    status: evidenceReady ? 'awaiting-human-authorization' : 'blocked-on-evidence',
    activation_authorized: false,
    ready_for_human_gate: evidenceReady,
    operational_paths: { project_database: operationalDatabase, telemetry_database: telemetryDatabase },
    evidence: { telemetry, migration, callers },
    retained_compatibility: [
      { id: 'mcp-2024-11-05', owner: 'platform-governance', reason: 'production entrypoints and zero-use evidence remain active' },
      { id: 'state-schema-v4', owner: 'platform-governance', reason: 'operational migration requires evidence and explicit authorization' },
      { id: 'plugin-catalog-v1', owner: 'platform-governance', reason: 'external-consumer telemetry is not yet available' },
      { id: 'installer-v4-detection', owner: 'platform-governance', reason: 'external installation migration remains supported' },
    ],
    retired_compatibility: [{ id: 'ide-underscore-command-naming', owner: 'platform-governance' }],
  });
}

module.exports = {
  ACTIVATION_DEADLINE,
  LEGACY_SERVER_IDS,
  RETIRED_INTERNAL_SYMBOLS,
  RETIREMENT_DEADLINE,
  auditCompatibility,
  databaseFingerprint,
  migrationDryRun,
  scanInternalCompatibilityCallers,
  snapshotTables,
};
