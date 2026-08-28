/**
 * HSEOS State UI Server — read-only side-car exposing the agent-state kanban over HTTP+SSE.
 *
 * Polls the SQLite store every N ms, computes a SHA1 of the snapshot, and pushes diffs
 * to connected EventSource clients. Non-loopback binding requires bearer authentication.
 *
 * Start: hseos state-ui start
 * Port:  --port=N (default 3200)
 * DB:    --db=PATH (default .hseos/state/project.db)
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('[state-ui] better-sqlite3 not installed — install with: npm install better-sqlite3');
  process.exit(1);
}

const { takeSnapshot } = require('./lib/snapshot');

const DEFAULT_PORT = 3200;
const DEFAULT_DB = path.join(process.cwd(), '.hseos', 'state', 'project.db');
const DEFAULT_POLL_MS = 1000;
const WEB_DIR = path.join(__dirname, 'web');

function parseArgs() {
  const args = process.argv.slice(2);
  const port = Number.parseInt(args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? DEFAULT_PORT, 10);
  const dbPath = args.find((a) => a.startsWith('--db='))?.split('=')[1] || process.env.HSEOS_STATE_DB || DEFAULT_DB;
  const registry = args.find((a) => a.startsWith('--registry='))?.split('=')[1] || null;
  const host = args.find((a) => a.startsWith('--host='))?.split('=')[1] || '127.0.0.1';
  const pollMs = Number.parseInt(args.find((a) => a.startsWith('--poll-ms='))?.split('=')[1] ?? DEFAULT_POLL_MS, 10);
  const staleMinutes = Number.parseInt(args.find((a) => a.startsWith('--stale-minutes='))?.split('=')[1] ?? 10, 10);
  const authTokenEnv = args.find((a) => a.startsWith('--auth-token-env='))?.slice('--auth-token-env='.length) || null;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('port must be an integer from 1 to 65535');
  if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000) throw new Error('poll-ms must be an integer from 100 to 60000');
  if (!Number.isInteger(staleMinutes) || staleMinutes < 1) throw new Error('stale-minutes must be a positive integer');
  if (authTokenEnv && !/^[A-Z_][A-Z0-9_]*$/.test(authTokenEnv)) throw new Error('auth-token-env must be an environment variable name');
  const authToken = authTokenEnv ? process.env[authTokenEnv] : null;
  return { port, host, dbPath, pollMs, staleMinutes, registry, authToken, authTokenEnv };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function checksum(snapshot) {
  return crypto.createHash('sha1').update(JSON.stringify(snapshot)).digest('hex');
}

function isLoopback(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(host);
}

function start({ port, host = '127.0.0.1', dbPath, pollMs, staleMinutes, registry: registryPath, authToken = null }) {
  if (!isLoopback(host) && (typeof authToken !== 'string' || authToken.length < 16)) {
    throw new Error('non-loopback binding requires --auth-token-env with a token of at least 16 characters');
  }
  const isCentral = Boolean(registryPath);
  let db = null;
  let loadedRegistry = null;
  let takeMultiSnapshotFn = null;
  let loadRegistryFn = null;

  if (isCentral) {
    ({ takeMultiSnapshot: takeMultiSnapshotFn } = require('./lib/snapshot-multi'));
    ({ loadRegistry: loadRegistryFn } = require('./lib/registry'));
    loadedRegistry = loadRegistryFn(registryPath);
    console.log(`[state-ui] central mode — registry: ${loadedRegistry._path}`);
    console.log(`[state-ui] tracking ${loadedRegistry.projects.length} project(s)`);
  } else {
    if (!fs.existsSync(dbPath)) throw new Error(`state database does not exist: ${dbPath}`);
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
  }

  const sseClients = new Set();
  let lastSnapshot = null;
  let lastChecksum = null;

  function takeCurrentSnapshot() {
    if (isCentral) {
      // Reload registry on each tick so register/deregister picks up without restart
      loadedRegistry = loadRegistryFn(registryPath);
      return takeMultiSnapshotFn(loadedRegistry, { staleMinutes });
    }
    return takeSnapshot(db, { staleMinutes });
  }

  function pushSnapshot() {
    let snap;
    try {
      snap = takeCurrentSnapshot();
    } catch (error) {
      console.error('[state-ui] snapshot error:', error.message);
      return;
    }
    const sum = checksum(snap);
    if (sum === lastChecksum) return;
    lastChecksum = sum;
    lastSnapshot = snap;
    const payload = `data: ${JSON.stringify(snap)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  pushSnapshot();
  const pollTimer = setInterval(pushSnapshot, pollMs);

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (authToken) {
      const supplied = req.headers.authorization || '';
      const expected = `Bearer ${authToken}`;
      const suppliedBuffer = Buffer.from(supplied);
      const expectedBuffer = Buffer.from(expected);
      const authorized = suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
      if (!authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }

    if (url === '/health') {
      const meta = isCentral
        ? {
            mode: 'central',
            projects: loadedRegistry?.projects?.length || 0,
            projects_ok: lastSnapshot?.projects_meta?.filter((p) => p.db_status === 'ok').length || 0,
          }
        : { mode: 'single' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'hseos-state-ui', clients: sseClients.size, ...meta }));
      return;
    }

    if (url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(lastSnapshot ?? takeCurrentSnapshot()));
      return;
    }

    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(lastSnapshot ?? takeCurrentSnapshot())}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      fs.createReadStream(path.join(WEB_DIR, 'index.html')).pipe(res);
      return;
    }

    if (url.startsWith('/assets/')) {
      const file = path.resolve(WEB_DIR, url.slice('/assets/'.length));
      const webBoundary = `${path.resolve(WEB_DIR)}${path.sep}`;
      if (!file.startsWith(webBoundary) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  server.listen(port, host, () => {
    console.log(`[state-ui] listening on http://${host}:${port}`);
    if (isCentral) console.log(`[state-ui] mode=central registry=${registryPath} poll=${pollMs}ms`);
    else console.log(`[state-ui] mode=single db=${dbPath} poll=${pollMs}ms stale=${staleMinutes}min`);
  });

  function shutdown(signal) {
    console.log(`[state-ui] ${signal} — draining clients`);
    clearInterval(pollTimer);
    for (const res of sseClients) {
      try {
        res.write('event: bye\ndata: {}\n\n');
        res.end();
      } catch {
        /* ignore */
      }
    }
    sseClients.clear();
    server.close(() => {
      if (db) {
        try {
          db.close();
        } catch {
          /* ignore */
        }
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start(parseArgs());
}

module.exports = { isLoopback, parseArgs, start };
