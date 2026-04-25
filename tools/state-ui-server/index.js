/**
 * HSEOS State UI Server — read-only side-car exposing the agent-state kanban over HTTP+SSE.
 *
 * Polls the SQLite store every N ms, computes a SHA1 of the snapshot, and pushes diffs
 * to connected EventSource clients. Bind 127.0.0.1 only — never exposed externally.
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
  // eslint-disable-next-line n/no-missing-require
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
  const pollMs = Number.parseInt(args.find((a) => a.startsWith('--poll-ms='))?.split('=')[1] ?? DEFAULT_POLL_MS, 10);
  const staleMinutes = Number.parseInt(args.find((a) => a.startsWith('--stale-minutes='))?.split('=')[1] ?? 10, 10);
  return { port, dbPath, pollMs, staleMinutes };
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

function start({ port, dbPath, pollMs, staleMinutes }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { readonly: false, fileMustExist: false });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const sseClients = new Set();
  let lastSnapshot = null;
  let lastChecksum = null;

  function pushSnapshot() {
    let snap;
    try {
      snap = takeSnapshot(db, { staleMinutes });
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

    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'hseos-state-ui', clients: sseClients.size }));
      return;
    }

    if (url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(lastSnapshot ?? takeSnapshot(db, { staleMinutes })));
      return;
    }

    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(lastSnapshot ?? takeSnapshot(db, { staleMinutes }))}\n\n`);
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
      const file = path.join(WEB_DIR, url.replace('/assets/', ''));
      if (!file.startsWith(WEB_DIR) || !fs.existsSync(file)) {
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

  server.listen(port, '127.0.0.1', () => {
    console.log(`[state-ui] listening on http://127.0.0.1:${port}`);
    console.log(`[state-ui] db=${dbPath} poll=${pollMs}ms stale=${staleMinutes}min`);
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
      try {
        db.close();
      } catch {
        /* ignore */
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

module.exports = { start };
