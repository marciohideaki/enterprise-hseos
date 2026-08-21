/**
 * state-session smoke tests — always-on session tracking (migration 004).
 *
 * DAL level: in-memory DB, all migrations, exercises registerSession /
 * heartbeat / end / listSessions / sweepOrphanSessions.
 * CLI level: spawns `hseos state-session` against an isolated temp directory
 * (the machine-store default is overridden with --directory).
 *
 * Skips cleanly if better-sqlite3 is not installed.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.warn('[test-state-session] better-sqlite3 not installed — skipping');
  process.exit(0);
}

const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const { AgentStateDAL } = require('../tools/mcp-project-state/lib/agent-state-dal');

const REPO_ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'tools', 'mcp-project-state', 'migrations');
const HSEOS_CLI = path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js');

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  return { db, dal: new AgentStateDAL(db) };
}

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

console.log('[test-state-session] DAL');

it('registerSession creates an active row with context', () => {
  const { dal } = setup();
  dal.registerSession({ id: 's1', host: 'devbox', cwd: '/opt/projx', service: 'claude-code' });
  const rows = dal.listSessions();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'active');
  assert.strictEqual(rows[0].host, 'devbox');
  assert.strictEqual(rows[0].cwd, '/opt/projx');
  assert.strictEqual(rows[0].service, 'claude-code');
});

it('registerSession is idempotent and refreshes last_seen', () => {
  const { dal } = setup();
  dal.registerSession({ id: 's1', cwd: '/a' });
  dal.registerSession({ id: 's1' }); // heartbeat-shaped upsert: no context loss
  const rows = dal.listSessions();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].cwd, '/a'); // COALESCE keeps prior context
  assert.ok(rows[0].last_seen_at, 'last_seen_at set by re-register');
});

it('registerSession re-activates an ended session (resume)', () => {
  const { dal } = setup();
  dal.registerSession({ id: 's1' });
  dal.endSession('s1', 'completed');
  dal.registerSession({ id: 's1' });
  const rows = dal.listSessions();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'active');
  assert.strictEqual(rows[0].ended_at, null);
});

it('endSession closes and listSessions hides it unless all=true', () => {
  const { dal } = setup();
  dal.registerSession({ id: 's1' });
  dal.registerSession({ id: 's2' });
  dal.endSession('s2', 'completed');
  assert.strictEqual(dal.listSessions().length, 1);
  assert.strictEqual(dal.listSessions({ all: true }).length, 2);
});

it('sweepOrphanSessions orphans only stale active sessions', () => {
  const { db, dal } = setup();
  dal.registerSession({ id: 'fresh' });
  dal.registerSession({ id: 'stale' });
  db.prepare(`UPDATE as_sessions SET last_seen_at = datetime('now', '-2 days') WHERE id = 'stale'`).run();
  const { changes } = dal.sweepOrphanSessions(1440);
  assert.strictEqual(changes, 1);
  const byId = Object.fromEntries(dal.listSessions({ all: true }).map((r) => [r.id, r.status]));
  assert.strictEqual(byId.stale, 'orphaned');
  assert.strictEqual(byId.fresh, 'active');
});

console.log('[test-state-session] CLI');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-state-session-'));

function cli(args) {
  return spawnSync('node', [HSEOS_CLI, ...args, '--directory', tmp], {
    encoding: 'utf8',
    env: { ...process.env, HSEOS_GOVERNED_EXECUTION_FIXTURE: '1', NODE_ENV: 'test' },
  });
}

it('CLI register creates the store and the row', () => {
  const r = cli(['state-session', 'register', '--session', 'cli-1', '--cwd', '/opt/projx', '--service', 'claude-code', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(tmp, '.hseos', 'state', 'project.db')));
});

it('CLI heartbeat on unknown session registers it (upsert)', () => {
  const r = cli(['state-session', 'heartbeat', '--session', 'cli-2', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const list = cli(['state-session', 'list', '--json']);
  const rows = JSON.parse(list.stdout.trim());
  assert.ok(rows.some((s) => s.id === 'cli-2'));
});

it('CLI end closes the session; list --all still shows it', () => {
  const r = cli(['state-session', 'end', '--session', 'cli-2', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const active = JSON.parse(cli(['state-session', 'list', '--json']).stdout.trim());
  assert.ok(!active.some((s) => s.id === 'cli-2'));
  const all = JSON.parse(cli(['state-session', 'list', '--all', '--json']).stdout.trim());
  assert.strictEqual(all.find((s) => s.id === 'cli-2').status, 'completed');
});

it('CLI sweep reports orphaned count', () => {
  const r = cli(['state-session', 'sweep', '--stale-minutes', '1440', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.strictEqual(out.ok, true);
  assert.strictEqual(typeof out.orphaned, 'number');
});

it('CLI register without --session fails with a clean error', () => {
  const r = cli(['state-session', 'register', '--json']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /--session/);
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n[test-state-session] ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
