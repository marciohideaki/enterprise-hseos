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
const { startNativeMcpServer } = require('../lib/governed-execution/native-mcp-server');
const { startLegacyMcpServer } = require('../lib/legacy-mcp-server');
const { openOperationalStateDatabase } = require('./lib/operational-state-db');
const { LEGACY_TOOLS } = require('./tool-catalog');

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

function handleTool(db, name, args, context) {
  // Dynamic tools (loaded from ./tools/*.js) take precedence over the legacy switch.
  if (dynamicTools.has(name)) {
    return dynamicTools.get(name).handler(db, args, getDal(db), context);
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

    case 'scheduler_sweep_orphans': {
      const { sweepOrphans } = require('./lib/stale-detector');
      return sweepOrphans(db, args.stale_minutes);
    }

    default: {
      throw new Error(`Unknown tool: ${name}`);
    }
  }
}

function listTools() {
  const dynamicDescriptors = [...dynamicTools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  return [...LEGACY_TOOLS, ...dynamicDescriptors];
}

const { dbPath, mode, port } = parseArgs();
const toolMap = new Map(listTools().map((tool) => [tool.name, tool]));
const fixtureActivation = process.env.NODE_ENV === 'test' && process.env.HSEOS_GOVERNED_EXECUTION_FIXTURE === '1';
let runtimeHandle;
let operationalDb = null;
if (fixtureActivation) {
  toolMap.set('scheduler_sweep_orphans', {
    name: 'scheduler_sweep_orphans',
    description: 'Internal governed stale-heartbeat sweep',
    inputSchema: {
      type: 'object',
      properties: { stale_minutes: { type: 'integer', minimum: 1, maximum: 1440 } },
      required: ['stale_minutes'],
      additionalProperties: false,
    },
  });
  runtimeHandle = startNativeMcpServer({
    serverId: 'project_state', tools: toolMap, mode, port, dbPath,
    invokeTool(name, args, context) { return handleTool(runtimeHandle.db, name, args, context); },
    log: (message) => logToStderr('info', message),
  });
} else {
  operationalDb = openOperationalStateDatabase(dbPath, { log: logToStderr });
  runtimeHandle = startLegacyMcpServer({
    serverId: 'project_state', serverName: 'hseos-project-state', tools: toolMap, mode, port,
    projectDirectory: process.cwd(), stateDatabasePath: dbPath, wrapHttpResults: false,
    health: { schema_version: operationalDb.pragma('user_version', { simple: true }), tools: toolMap.size },
    invokeTool(name, args) { return handleTool(operationalDb, name, args); },
    log: (message) => logToStderr('info', message),
  });
}

// Start in-process scheduler (stale-orphan sweep every 5min) if available.
let stopScheduler = null;
try {
  if (!fixtureActivation) throw new Error('legacy compatibility mode does not run governed background mutations');
  const { startScheduler } = require('./lib/scheduler');
  stopScheduler = startScheduler(runtimeHandle.execution.scheduler, {
    dbPath,
    log: logToStderr,
    project: process.cwd(),
    staleMinutes: 10,
  });
} catch {
  // Scheduler is optional — server works without it.
}

async function shutdown() {
  if (stopScheduler) stopScheduler();
  await runtimeHandle.close();
  if (operationalDb?.open) operationalDb.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
