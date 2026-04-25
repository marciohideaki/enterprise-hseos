/**
 * Smoke test for the central multi-project kanban.
 *
 * Creates 2 fake project DBs (with as_* schema applied), writes a tiny registry,
 * spawns the state-ui-server in --registry mode, fetches /api/state, asserts
 * shape includes 2 projects.
 *
 * Skips cleanly if better-sqlite3 is not installed.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

if (!Database) {
  console.warn('[test-kanban-central] better-sqlite3 not installed — skipping');
  process.exit(0);
}

const REPO_ROOT = path.join(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'tools', 'state-ui-server', 'index.js');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'tools', 'mcp-project-state', 'migrations');

let pass = 0;
let fail = 0;

async function it(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    pass++;
  } catch (error) {
    console.log(`  \u2717 ${name}\n    ${error.message}`);
    fail++;
  }
}

function pickPort() {
  return 3400 + Math.floor(Math.random() * 200);
}

function applyMigrations(db) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}-.*\.sql$/.test(f))
    .sort();
  for (const f of files) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  }
}

function seedProjectDb(projectDir, runId, agentName) {
  const dbPath = path.join(projectDir, '.hseos', 'state', 'project.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  applyMigrations(db);
  db.prepare(
    `INSERT INTO as_runs (id, workflow_id, project, phase) VALUES (?, 'dev-squad', ?, 'execute')`
  ).run(runId, projectDir);
  db.prepare(`INSERT INTO as_tasks (id, run_id, wave, status) VALUES ('T1', ?, 1, 'IN_PROGRESS')`).run(runId);
  db.prepare(
    `INSERT INTO as_agent_runs (agent_name, task_id, run_id, last_heartbeat_at, status) VALUES (?, 'T1', ?, datetime('now'), 'running')`
  ).run(agentName, runId);
  db.close();
}

function fetchJson(port, path_) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: path_, timeout: 4000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode}`));
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
  });
}

function waitFor(predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        if (await predicate()) return resolve();
      } catch {
        /* swallow */
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

(async () => {
  console.log('Central kanban smoke');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-central-'));
  const projA = path.join(tmp, 'project-a');
  const projB = path.join(tmp, 'project-b');
  seedProjectDb(projA, 'R-A1', 'FORGE');
  seedProjectDb(projB, 'R-B1', 'QUILL');

  const registryPath = path.join(tmp, 'projects.json');
  fs.writeFileSync(
    registryPath,
    JSON.stringify(
      {
        version: 1,
        projects: [
          { id: 'project-a', path: projA, label: 'Project A', color: '#00d3ff' },
          { id: 'project-b', path: projB, label: 'Project B', color: '#bd93f9' },
        ],
      },
      null,
      2
    )
  );

  const port = pickPort();
  const child = spawn(
    process.execPath,
    [SERVER, `--port=${port}`, `--registry=${registryPath}`, '--poll-ms=200'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  child.on('error', (e) => console.error('spawn error', e));

  try {
    await waitFor(() => fetchJson(port, '/health').then((r) => r.status === 'ok'));

    await it('GET /health reports central mode with 2 projects', async () => {
      const body = await fetchJson(port, '/health');
      if (body.mode !== 'central') throw new Error(`mode != central: ${body.mode}`);
      if (body.projects !== 2) throw new Error(`projects != 2: ${body.projects}`);
    });

    await it('GET /api/state aggregates 2 project DBs', async () => {
      const snap = await fetchJson(port, '/api/state');
      if (snap.mode !== 'central') throw new Error('snap.mode != central');
      if (!Array.isArray(snap.projects_meta) || snap.projects_meta.length !== 2) {
        throw new Error(`projects_meta length: ${snap.projects_meta?.length}`);
      }
      const ok = snap.projects_meta.filter((p) => p.db_status === 'ok');
      if (ok.length !== 2) throw new Error(`ok DBs != 2: ${ok.length}`);
      if (!Array.isArray(snap.runs) || snap.runs.length !== 2) {
        throw new Error(`runs aggregated != 2: ${snap.runs.length}`);
      }
      for (const r of snap.runs) if (!r.project_id) throw new Error('run missing project_id');
    });

    await it('graceful degrade when one DB is missing', async () => {
      // Delete one DB and wait one poll cycle
      fs.rmSync(path.join(projA, '.hseos', 'state', 'project.db'), { force: true });
      await new Promise((r) => setTimeout(r, 600));
      const snap = await fetchJson(port, '/api/state');
      const aMeta = snap.projects_meta.find((p) => p.id === 'project-a');
      if (aMeta.db_status === 'ok') throw new Error('expected non-ok status for project-a after deletion');
      const bMeta = snap.projects_meta.find((p) => p.id === 'project-b');
      if (bMeta.db_status !== 'ok') throw new Error('project-b should still be ok');
    });
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!child.killed) child.kill('SIGKILL');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-kanban-central] fatal:', error.message);
  process.exit(1);
});
