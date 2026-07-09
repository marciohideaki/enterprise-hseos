/**
 * HSEOS Project State MCP Server
 *
 * Exposes STATE.md and TASKS.md as structured tools over MCP protocol.
 * Uses SQLite for atomic reads/writes with full history.
 *
 * Start: hseos state start
 * Port:  configurable via --port (default: 3100)
 */

const path = require('node:path');
const fs = require('node:fs');
const { createHttpServer, createMessageHandler, startStdioServer } = require('../lib/mcp-transport');

let Database;
try {
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
  const mode = args.includes('--http') || args.some((a) => a.startsWith('--port=')) ? 'http' : 'stdio';
  return { dbPath, mode, port };
}

function loadDynamicTools() {
  // Discover and require all `./tools/*.js` files; each exports an array of
  // tool descriptors `{ name, description, inputSchema, handler(db, args, dal) }`.
  const toolsDir = path.join(__dirname, 'tools');
  const map = new Map();
  if (!fs.existsSync(toolsDir)) return map;
  for (const file of fs.readdirSync(toolsDir).filter((f) => f.endsWith('.js'))) {
    try {
      const exported = require(path.join(toolsDir, file));
      if (!Array.isArray(exported)) continue;
      for (const tool of exported) {
        if (tool && tool.name && typeof tool.handler === 'function') {
          map.set(tool.name, tool);
        }
      }
    } catch (error) {
      console.error(`[project-state] failed to load ${file}: ${error.message}`);
    }
  }
  return map;
}

const dynamicTools = loadDynamicTools();
let dalInstance = null;

function getDal(db) {
  if (dalInstance) return dalInstance;
  try {
    const { AgentStateDAL } = require('./lib/agent-state-dal');
    dalInstance = new AgentStateDAL(db);
  } catch {
    dalInstance = null;
  }
  return dalInstance;
}

function logToStderr(level, msg) {
  console.error(`[project-state:${level}] ${msg}`);
}

function initDb(dbPath, { log = logToStderr } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

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

  const { runMigrations } = require('./lib/migrations');
  runMigrations(db, path.join(__dirname, 'migrations'), { log });

  return db;
}

function handleTool(db, name, args) {
  // Dynamic tools (loaded from ./tools/*.js) take precedence over the legacy switch.
  if (dynamicTools.has(name)) {
    return dynamicTools.get(name).handler(db, args, getDal(db));
  }
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
        'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
      );
      const historyInsert = db.prepare(
        'INSERT INTO state_history (key, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)',
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
        id,
        owner,
        description,
        depends ? JSON.stringify(depends) : null,
      );
      return { added: id };
    }

    case 'tasks_update': {
      const { id, status, note } = args;
      if (!id || !status) throw new Error('id and status are required');
      const now = new Date().toISOString();
      db.prepare('UPDATE tasks SET status = ?, note = ?, updated_at = ? WHERE id = ?').run(status, note || null, now, id);
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

const LEGACY_TOOLS = [
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

function listTools() {
  const dynamicDescriptors = [...dynamicTools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  return [...LEGACY_TOOLS, ...dynamicDescriptors];
}

const { dbPath, mode, port } = parseArgs();
const db = initDb(dbPath, { log: logToStderr });
let server = null;

// Start in-process scheduler (stale-orphan sweep every 5min) if available.
let stopScheduler = null;
try {
  const { startScheduler } = require('./lib/scheduler');
  stopScheduler = startScheduler(db, { log: logToStderr, staleMinutes: 10 });
} catch {
  // Scheduler is optional — server works without it.
}

function createProjectStateHandler({ wrapToolResults }) {
  return createMessageHandler({
    serverInfo: { name: 'hseos-project-state', version: '1.0.0' },
    tools: listTools(),
    wrapToolResults,
    callTool(name, args) {
      return handleTool(db, name, args);
    },
  });
}

if (mode === 'http') {
  const handleMessage = createProjectStateHandler({ wrapToolResults: false });
  server = createHttpServer(handleMessage, { status: 'ok', server: 'hseos-project-state' });
  server.listen(port, '127.0.0.1', () => {
    console.error(`[project-state] MCP server listening on http://127.0.0.1:${port}`);
    console.error(`[project-state] Database: ${dbPath}`);
    console.error(`[project-state] Dynamic tools loaded: ${dynamicTools.size}`);
  });
} else {
  const handleMessage = createProjectStateHandler({ wrapToolResults: true });
  console.error(`[project-state] MCP stdio server ready. Database: ${dbPath}`);
  console.error(`[project-state] Dynamic tools loaded: ${dynamicTools.size}`);
  startStdioServer(handleMessage);
}

function shutdown() {
  if (stopScheduler) stopScheduler();
  if (server) server.close();
  try {
    db.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
