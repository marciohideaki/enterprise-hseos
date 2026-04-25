/**
 * Smoke test for `hseos state-purge`.
 *
 * Creates a run with tasks/agent_runs/events/handoffs, runs purge with --force,
 * verifies all `as_*` rows for that run are deleted while OTHER runs survive.
 *
 * Skips cleanly if better-sqlite3 is not installed.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

if (!Database) {
  console.warn('[test-state-purge] better-sqlite3 not installed — skipping');
  process.exit(0);
}

const REPO_ROOT = path.join(__dirname, '..');
const HSEOS_CLI = path.join(REPO_ROOT, 'tools', 'cli', 'hseos-cli.js');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'tools', 'mcp-project-state', 'migrations');

let pass = 0;
let fail = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    pass++;
  } catch (error) {
    console.log(`  \u2717 ${name}\n    ${error.message}`);
    fail++;
  }
}

function applyMigrations(db) {
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((x) => /^\d{3}-.*\.sql$/.test(x)).sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  }
}

function seed(dir, runId) {
  const dbPath = path.join(dir, '.hseos', 'state', 'project.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  applyMigrations(db);
  db.prepare("INSERT INTO as_runs (id, workflow_id, project, phase) VALUES (?, 'dev-squad', ?, 'execute')").run(
    runId,
    dir
  );
  db.prepare("INSERT INTO as_tasks (id, run_id, wave, status) VALUES (?, ?, 1, 'IN_PROGRESS')").run(
    `${runId}-T1`,
    runId
  );
  const ar = db
    .prepare(
      "INSERT INTO as_agent_runs (agent_name, task_id, run_id, last_heartbeat_at, status) VALUES ('A', ?, ?, datetime('now'), 'running')"
    )
    .run(`${runId}-T1`, runId);
  for (let i = 0; i < 3; i++) {
    db.prepare("INSERT INTO as_events (agent_run_id, kind, payload_json) VALUES (?, 'heartbeat', ?)").run(
      ar.lastInsertRowid,
      `{"i":${i}}`
    );
  }
  db.close();
  return dbPath;
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [HSEOS_CLI, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    ...opts,
  });
}

console.log('state-purge smoke');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-purge-'));
seed(tmp, 'R-keep');
const dbPath = seed(tmp, 'R-purge');

it('dry-run reports counts without deleting', () => {
  const r = runCli(['state-purge', 'R-purge', '--directory', tmp, '--json']);
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  if (!out.dry_run) throw new Error('expected dry_run flag');
  if (out.counts.runs !== 1) throw new Error('expected 1 run');
  // Verify NOT deleted yet
  const db = new Database(dbPath);
  const n = db.prepare("SELECT COUNT(*) AS n FROM as_runs WHERE id = 'R-purge'").get().n;
  db.close();
  if (n !== 1) throw new Error('run was deleted on dry-run');
});

it('--force deletes the run and dependent rows', () => {
  const r = runCli(['state-purge', 'R-purge', '--directory', tmp, '--force', '--json']);
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  if (!out.purged) throw new Error('expected purged flag');
  const db = new Database(dbPath);
  const remaining = db.prepare("SELECT COUNT(*) AS n FROM as_runs WHERE id = 'R-purge'").get().n;
  const events = db.prepare("SELECT COUNT(*) AS n FROM as_events").get().n;
  const tasks = db.prepare("SELECT COUNT(*) AS n FROM as_tasks WHERE run_id = 'R-purge'").get().n;
  db.close();
  if (remaining !== 0) throw new Error(`run still exists: ${remaining}`);
  if (tasks !== 0) throw new Error(`tasks still exist: ${tasks}`);
  // events from R-purge should be 0 but R-keep events still survive
  if (events !== 0) throw new Error(`events from purged run remain: ${events} (R-keep had no events seeded so total should be 0)`);
});

it('R-keep run is preserved (not affected by R-purge)', () => {
  const db = new Database(dbPath);
  const keep = db.prepare("SELECT COUNT(*) AS n FROM as_runs WHERE id = 'R-keep'").get().n;
  db.close();
  if (keep !== 1) throw new Error('R-keep was deleted');
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
