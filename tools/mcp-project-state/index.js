/**
 * HSEOS Project State MCP Server
 *
 * Exposes STATE.md and TASKS.md as structured tools over MCP protocol.
 * Uses SQLite for atomic reads/writes with full history.
 *
 * Start: hseos state start
 * Port:  configurable via --port (default: 3100)
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
  Database = require('better-sqlite3');
} catch {
  console.error('[project-state] better-sqlite3 not found. Install with: npm install better-sqlite3');
  process.exit(1);
}

const DEFAULT_PORT = 3100;
const DEFAULT_DB = path.join(process.cwd(), '.hseos', 'state', 'project.db');

function parseArgs() {
  const args = process.argv.slice(2);
  const port = parseInt(args.find((a) => a.startsWith('--port='))?.split('=')[1] || DEFAULT_PORT);
  const dbPath = args.find((a) => a.startsWith('--db='))?.split('=')[1] || process.env.HSEOS_STATE_DB || DEFAULT_DB;
  return { port, dbPath };
}

function initDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      depends_on TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS state_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

function buildMcpResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function buildMcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function handleTool(db, name, args) {
  switch (name) {
    case 'state_read': {
      const rows = db.prepare('SELECT key, value, updated_at FROM state ORDER BY key').all();
      const state = {};
      for (const row of rows) state[row.key] = row.value;
      return { state, updated_at: rows[0]?.updated_at || null };
    }

    case 'state_write': {
      const fields = args.fields || {};
      const agent = args.agent || 'unknown';
      const now = new Date().toISOString();
      const insert = db.prepare(
        'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'
      );
      const historyInsert = db.prepare(
        'INSERT INTO state_history (key, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)'
      );
      const getOld = db.prepare('SELECT value FROM state WHERE key = ?');

      const writeMany = db.transaction(() => {
        for (const [key, value] of Object.entries(fields)) {
          const old = getOld.get(key);
          insert.run(key, String(value), now);
          historyInsert.run(key, old?.value || null, String(value), agent, now);
        }
      });
      writeMany();
      return { written: Object.keys(fields).length, updated_at: now };
    }

    case 'tasks_list': {
      const status = args.status;
      const rows = status
        ? db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at').all(status)
        : db.prepare('SELECT * FROM tasks ORDER BY status, created_at').all();
      return { tasks: rows, count: rows.length };
    }

    case 'tasks_add': {
      const { id, owner, description, depends } = args;
      if (!id || !owner || !description) throw new Error('id, owner, description are required');
      db.prepare('INSERT OR IGNORE INTO tasks (id, owner, description, depends_on) VALUES (?, ?, ?, ?)').run(
        id, owner, description, depends ? JSON.stringify(depends) : null
      );
      return { added: id };
    }

    case 'tasks_update': {
      const { id, status, note } = args;
      if (!id || !status) throw new Error('id and status are required');
      const now = new Date().toISOString();
      db.prepare('UPDATE tasks SET status = ?, note = ?, updated_at = ? WHERE id = ?').run(
        status, note || null, now, id
      );
      return { updated: id, status, updated_at: now };
    }

    case 'state_history': {
      const n = args.n || 20;
      const rows = db.prepare('SELECT * FROM state_history ORDER BY changed_at DESC LIMIT ?').all(n);
      return { history: rows, count: rows.length };
    }

    default: {
      throw new Error(`Unknown tool: ${name}`);
    }
  }
}

function createServer(db) {
  const TOOLS = [
    { name: 'state_read', description: 'Get current project state', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'state_write',
      description: 'Update state fields atomically',
      inputSchema: {
        type: 'object',
        properties: {
          fields: { type: 'object', description: 'Key-value pairs to write' },
          agent: { type: 'string', description: 'Agent code writing the state' },
        },
        required: ['fields'],
      },
    },
    {
      name: 'tasks_list',
      description: 'List tasks with optional status filter',
      inputSchema: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['pending', 'done', 'blocked'] } },
      },
    },
    {
      name: 'tasks_add',
      description: 'Add a new task to the backlog',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          owner: { type: 'string' },
          description: { type: 'string' },
          depends: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'owner', 'description'],
      },
    },
    {
      name: 'tasks_update',
      description: 'Update task status',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'done', 'blocked'] },
          note: { type: 'string' },
        },
        required: ['id', 'status'],
      },
    },
    {
      name: 'state_history',
      description: 'Get recent state change history',
      inputSchema: {
        type: 'object',
        properties: { n: { type: 'integer', description: 'Number of records (default 20)' } },
      },
    },
  ];

  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'hseos-project-state' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildMcpError(null, -32_700, 'Parse error')));
        return;
      }

      const { id, method, params } = parsed;
      res.writeHead(200, { 'Content-Type': 'application/json' });

      try {
        switch (method) {
        case 'initialize': {
          res.end(JSON.stringify(buildMcpResponse(id, {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'hseos-project-state', version: '1.0.0' },
            capabilities: { tools: {} },
          })));
        
        break;
        }
        case 'tools/list': {
          res.end(JSON.stringify(buildMcpResponse(id, { tools: TOOLS })));
        
        break;
        }
        case 'tools/call': {
          const result = handleTool(db, params.name, params.arguments || {});
          res.end(JSON.stringify(buildMcpResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          })));
        
        break;
        }
        default: {
          res.end(JSON.stringify(buildMcpError(id, -32_601, `Method not found: ${method}`)));
        }
        }
      } catch (error) {
        res.end(JSON.stringify(buildMcpError(id, -32_000, error.message)));
      }
    });
  });
}

const { port, dbPath } = parseArgs();
const db = initDb(dbPath);
const server = createServer(db);

server.listen(port, '127.0.0.1', () => {
  console.log(`[project-state] MCP server listening on http://127.0.0.1:${port}`);
  console.log(`[project-state] Database: ${dbPath}`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });
