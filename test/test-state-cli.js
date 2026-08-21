/**
 * State CLI smoke tests — spawns each `hseos state-*` command against an
 * isolated temp directory. Verifies exit codes and DB creation.
 *
 * Skips cleanly if better-sqlite3 is not installed (since CLI fails open).
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

if (!Database) {
  console.warn('[test-state-cli] better-sqlite3 not installed — skipping');
  process.exit(0);
}

const REPO_ROOT = path.join(__dirname, '..');
const HSEOS_CLI = path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'tools', 'mcp-project-state', 'migrations');
const PENDING_MIGRATIONS_DIR = path.join(REPO_ROOT, 'tools', 'mcp-project-state', 'migrations-pending-activation');

let pass = 0;
let fail = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (error) {
    console.log(`  ✗ ${name}\n    ${error.message}`);
    fail++;
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-test-'));
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [HSEOS_CLI, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    env: { ...process.env, HSEOS_GOVERNED_EXECUTION_FIXTURE: '1', NODE_ENV: 'test' },
    ...opts,
  });
}

console.log('State CLI smoke tests');

it('production CLI preserves v4 behavior and records legacy transition usage', () => {
  const dir = makeTempDir();
  const result = spawnSync(
    process.execPath,
    [HSEOS_CLI, 'state-emit', 'start', '--directory', dir, '--run', 'R-gated', '--silent'],
    { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } },
  );
  if (result.status !== 0) throw new Error(`legacy compatibility failed, exit ${result.status}: ${result.stderr}`);
  const dbPath = path.join(dir, '.hseos', 'state', 'project.db');
  const db = new Database(dbPath, { readonly: true });
  if (db.pragma('user_version', { simple: true }) !== 4) throw new Error('production CLI activated pending schema');
  if (db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'execution_events'").get().count !== 0) {
    throw new Error('production CLI created governed execution tables');
  }
  db.close();
  const usage = new Database(path.join(dir, '.hseos', 'state', 'mcp-legacy-usage.db'), { readonly: true });
  const count = usage.prepare("SELECT SUM(request_count) AS count FROM mcp_legacy_usage_daily WHERE server_id = 'cli'").get().count;
  usage.close();
  if (count !== 1) throw new Error(`expected one metered CLI call, got ${count}`);
});

it('production CLI rejects a pre-existing pending execution schema', () => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, '.hseos', 'state', 'project.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  runMigrations(db, PENDING_MIGRATIONS_DIR, { log: () => {} });
  db.close();
  const result = spawnSync(process.execPath, [HSEOS_CLI, 'state-list', '--directory', dir, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (result.status === 0 || !result.stderr.includes('EXECUTION_ACTIVATION_PENDING')) {
    throw new Error(`expected pending-schema rejection, exit ${result.status}: ${result.stderr}`);
  }
});

it('state-emit creates db file and inserts event', () => {
  const dir = makeTempDir();
  const result = runCli(
    ['state-emit', 'start', '--directory', dir, '--run', 'R-test', '--task', 'T1', '--agent', 'tester', '--silent'],
    { env: { ...process.env, HSEOS_GOVERNED_EXECUTION_FIXTURE: '1', NODE_ENV: 'test', USER: 'self-asserted-attacker' } },
  );
  if (result.status !== 0) {
    throw new Error(`exit ${result.status}: ${result.stderr || result.stdout}`);
  }
  const dbPath = path.join(dir, '.hseos', 'state', 'project.db');
  if (!fs.existsSync(dbPath)) throw new Error('db not created');
  const db = new Database(dbPath, { readonly: true });
  const lifecycle = db
    .prepare(`SELECT event_type FROM execution_events ORDER BY position`)
    .all()
    .map((event) => event.event_type);
  const actor = JSON.parse(db.prepare("SELECT actor_json FROM execution_events WHERE event_type = 'ExecutionAuthorized'").get().actor_json);
  db.close();
  if (JSON.stringify(lifecycle) !== JSON.stringify(['ExecutionAuthorized', 'ExecutionStarted', 'ExecutionSucceeded'])) {
    throw new Error(`missing governed lifecycle: ${JSON.stringify(lifecycle)}`);
  }
  if (actor.id.includes('self-asserted-attacker') || actor.type !== 'local_process') throw new Error(`untrusted CLI actor: ${JSON.stringify(actor)}`);
});

it('state-emit cannot write state when the governed pre-effect append fails', () => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, '.hseos', 'state', 'project.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  runMigrations(db, PENDING_MIGRATIONS_DIR, { log: () => {} });
  db.exec(`
    CREATE TRIGGER reject_cli_execution_start
    BEFORE INSERT ON execution_events WHEN NEW.event_type = 'ExecutionStarted'
    BEGIN SELECT RAISE(ABORT, 'injected CLI pre-effect failure'); END;
  `);
  db.close();
  const result = runCli(['state-emit', 'start', '--directory', dir, '--run', 'R-blocked', '--silent']);
  if (result.status === 0) throw new Error('state-emit unexpectedly succeeded');
  const verify = new Database(dbPath, { readonly: true });
  const runs = verify.prepare(`SELECT COUNT(*) AS count FROM as_runs WHERE id = 'R-blocked'`).get().count;
  const events = verify.prepare(`SELECT COUNT(*) AS count FROM execution_events`).get().count;
  verify.close();
  if (runs !== 0 || events !== 0) throw new Error(`bypass detected: runs=${runs}, execution_events=${events}`);
});

it('state-list returns the row from state-emit', () => {
  const dir = makeTempDir();
  runCli(['state-emit', 'start', '--directory', dir, '--run', 'R1', '--task', 'T1', '--agent', 'A', '--silent']);
  const result = runCli(['state-list', '--directory', dir, '--json']);
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`);
  const rows = JSON.parse(result.stdout);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('no runs listed');
  if (rows[0].id !== 'R1') throw new Error(`unexpected run id: ${rows[0].id}`);
});

it('state-describe returns the run summary', () => {
  const dir = makeTempDir();
  runCli(['state-emit', 'heartbeat', '--directory', dir, '--run', 'R1', '--task', 'T1', '--agent', 'A', '--silent']);
  const result = runCli(['state-describe', 'R1', '--directory', dir, '--json']);
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`);
  const desc = JSON.parse(result.stdout);
  if (desc.kind !== 'run' || desc.run.id !== 'R1') throw new Error('describe payload unexpected');
});

it('state-list --orphans is empty for fresh heartbeat', () => {
  const dir = makeTempDir();
  runCli(['state-emit', 'heartbeat', '--directory', dir, '--run', 'R1', '--task', 'T1', '--agent', 'A', '--silent']);
  const result = runCli(['state-list', '--orphans', '--directory', dir, '--json']);
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`);
  const rows = JSON.parse(result.stdout);
  if (!Array.isArray(rows) || rows.length > 0) {
    throw new Error(`expected 0 orphans, got ${rows.length}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
