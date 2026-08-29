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
const { randomUUID } = require('node:crypto');

let Database;
try {
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

function fetchResponse(port, path_, token = null) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = http.get({ host: '127.0.0.1', port, path: path_, headers, timeout: 4000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

async function fetchJson(port, path_, token = null) {
  const response = await fetchResponse(port, path_, token);
  if (response.statusCode !== 200) throw new Error(`status ${response.statusCode}`);
  return JSON.parse(response.body);
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
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
  runMigrations(db, path.join(REPO_ROOT, 'tools', 'mcp-project-state', 'migrations'), { log: () => {} });
  db.close();
  const token = 'state-ui-test-token-1234';
  const instanceId = randomUUID();
  const { start } = require('../tools/state-ui-server');
  const { healthCheck, parsePort, stopInstance, writeInstanceRecord } = require('../tools/cli/lib/sidecar-lifecycle');

  await it('side-car lifecycle rejects command-shaped and out-of-range ports', async () => {
    for (const value of ['3200; touch /tmp/sidecar-injection', '0', '65536', '3.14']) {
      let rejected = false;
      try {
        parsePort(value, 3200);
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error(`accepted port: ${value}`);
    }
  });

  await it('non-loopback binding fails closed even with authentication', async () => {
    let rejected = false;
    try {
      start({ port, host: '0.0.0.0', dbPath, pollMs: 200, staleMinutes: 10, authToken: token });
    } catch (error) {
      rejected = /binds only to loopback/.test(error.message);
    }
    if (!rejected) throw new Error('cleartext non-loopback binding was accepted');
  });

  await it('identity health check sends no bearer secret and rejects an arbitrary 200 response', async () => {
    let authorization = 'not-observed';
    const fake = http.createServer((request, response) => {
      authorization = request.headers.authorization;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', server: 'unrelated-server', instance_id: instanceId }));
    });
    await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
    try {
      const accepted = await healthCheck({ port: fake.address().port, server: 'hseos-state-ui', instanceId });
      if (accepted) throw new Error('unrelated server passed the identity check');
      if (authorization !== undefined) throw new Error('health request disclosed an Authorization header');
    } finally {
      await new Promise((resolve) => fake.close(resolve));
    }
  });

  await it('stop refuses an instance record whose PID belongs to another process', async () => {
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const recordPath = path.join(tmp, 'unrelated.instance.json');
    writeInstanceRecord(recordPath, {
      version: 1,
      server: 'hseos-state-ui',
      instanceId: randomUUID(),
      entrypoint: SERVER,
      port,
      host: '127.0.0.1',
      pid: unrelated.pid,
      startedAt: new Date().toISOString(),
    });
    try {
      const stopped = await stopInstance(recordPath, { server: 'hseos-state-ui', entrypoint: SERVER });
      if (stopped !== 0) throw new Error('unrelated process was treated as managed');
      process.kill(unrelated.pid, 0);
    } finally {
      unrelated.kill('SIGTERM');
    }
  });

  await it('single-project side-car refuses to create a missing state database', async () => {
    let rejected = false;
    try {
      start({ port, host: '127.0.0.1', dbPath: path.join(tmp, 'missing.db'), pollMs: 200, staleMinutes: 10 });
    } catch (error) {
      rejected = /does not exist/.test(error.message);
    }
    if (!rejected) throw new Error('missing database was created or accepted');
  });

  const child = spawn(
    process.execPath,
    [SERVER, `--port=${port}`, `--db=${dbPath}`, '--poll-ms=200', '--auth-token-env=HSEOS_TEST_UI_TOKEN', `--instance-id=${instanceId}`],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HSEOS_TEST_UI_TOKEN: token },
    },
  );

  child.on('error', (e) => console.error('spawn error', e));

  try {
    await waitFor(() => fetchJson(port, '/health').then((r) => r.instance_id === instanceId));

    await it('requests without the configured bearer token are rejected', async () => {
      const response = await fetchResponse(port, '/api/state');
      if (response.statusCode !== 401) throw new Error(`status ${response.statusCode}`);
    });

    await it('GET /health exposes only unauthenticated process identity', async () => {
      const body = await fetchJson(port, '/health');
      if (body.status !== 'ok') throw new Error('not ok');
      if (body.server !== 'hseos-state-ui') throw new Error('wrong server name');
      if (body.instance_id !== instanceId) throw new Error('wrong instance id');
      if (Object.keys(body).sort().join(',') !== 'instance_id,server,status') throw new Error('health response exposes runtime data');
    });

    await it('GET /api/state returns snapshot shape', async () => {
      const snap = await fetchJson(port, '/api/state', token);
      const required = ['ts', 'runs', 'tasks', 'agentRuns', 'events', 'orphans', 'counts', 'stale_minutes'];
      for (const k of required) {
        if (!(k in snap)) throw new Error(`missing key: ${k}`);
      }
      if (!Array.isArray(snap.runs)) throw new Error('runs not array');
      if (!Array.isArray(snap.tasks)) throw new Error('tasks not array');
      if (!Array.isArray(snap.agentRuns)) throw new Error('agentRuns not array');
      if (typeof snap.counts !== 'object') throw new Error('counts not object');
    });

    await it('stop signals exactly the verified managed process', async () => {
      const recordPath = path.join(tmp, 'managed.instance.json');
      writeInstanceRecord(recordPath, {
        version: 1,
        server: 'hseos-state-ui',
        instanceId,
        entrypoint: SERVER,
        port,
        host: '127.0.0.1',
        pid: child.pid,
        startedAt: new Date().toISOString(),
      });
      const stopped = await stopInstance(recordPath, { server: 'hseos-state-ui', entrypoint: SERVER });
      if (stopped !== 1) throw new Error('verified process was not signalled');
      if (fs.existsSync(recordPath)) throw new Error('instance record remained after stop');
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
