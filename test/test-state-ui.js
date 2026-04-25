/**
 * State UI side-car smoke test — spawns server on a dynamic port,
 * fetches /api/state, asserts JSON shape, terminates via SIGTERM.
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
  console.warn('[test-state-ui] better-sqlite3 not installed — skipping');
  process.exit(0);
}

const REPO_ROOT = path.join(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'tools', 'state-ui-server', 'index.js');

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
  return 3300 + Math.floor(Math.random() * 200);
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
  console.log('State UI side-car smoke');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-ui-'));
  const dbPath = path.join(tmp, '.hseos', 'state', 'project.db');
  const port = pickPort();

  const child = spawn(
    process.execPath,
    [SERVER, `--port=${port}`, `--db=${dbPath}`, '--poll-ms=200'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  child.on('error', (e) => console.error('spawn error', e));

  try {
    await waitFor(() => fetchJson(port, '/health').then((r) => r.status === 'ok'));

    await it('GET /health returns ok', async () => {
      const body = await fetchJson(port, '/health');
      if (body.status !== 'ok') throw new Error('not ok');
      if (body.server !== 'hseos-state-ui') throw new Error('wrong server name');
    });

    await it('GET /api/state returns snapshot shape', async () => {
      const snap = await fetchJson(port, '/api/state');
      const required = ['ts', 'runs', 'tasks', 'agentRuns', 'events', 'orphans', 'counts', 'stale_minutes'];
      for (const k of required) {
        if (!(k in snap)) throw new Error(`missing key: ${k}`);
      }
      if (!Array.isArray(snap.runs)) throw new Error('runs not array');
      if (!Array.isArray(snap.tasks)) throw new Error('tasks not array');
      if (!Array.isArray(snap.agentRuns)) throw new Error('agentRuns not array');
      if (typeof snap.counts !== 'object') throw new Error('counts not object');
    });
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!child.killed) child.kill('SIGKILL');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-state-ui] fatal:', error.message);
  process.exit(1);
});
