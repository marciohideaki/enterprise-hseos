# PLAN — Wave 4: MCP expansion + stale-detector

G2 cleared via /plan mode + Sprint 2 framing in master plan.

## Tool exports contract (T4.1-T4.4)

Cada `tools/*.js` exporta um array:
```js
module.exports = [
  {
    name: 'runs_list',
    description: 'List runs with optional filter',
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, project: { type: 'string' } } },
    handler: (db, args, dal) => {
      // returns plain object — index.js wraps in JSON-RPC response
      ...
      return { runs, count };
    }
  },
  // ... more tools per file
];
```

## T4.5 loader pattern

`index.js` startup additions:
```js
function loadDynamicTools() {
  const toolsDir = path.join(__dirname, 'tools');
  if (!fs.existsSync(toolsDir)) return new Map();
  const map = new Map();
  for (const file of fs.readdirSync(toolsDir).filter(f => f.endsWith('.js'))) {
    const exported = require(path.join(toolsDir, file));
    for (const tool of exported) map.set(tool.name, tool);
  }
  return map;
}

const dynamicTools = loadDynamicTools();
```

In `handleTool(db, name, args)`:
```js
if (dynamicTools.has(name)) {
  return dynamicTools.get(name).handler(db, args, dal);
}
// fall through to existing switch
```

In tools/list response:
```js
const builtinTools = [...]; // existing static list
const allTools = [...builtinTools, ...[...dynamicTools.values()].map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))];
```

## T4.6 stale-detector

```js
function sweepOrphans(db, staleMinutes = 10) {
  const stale = parseInt(staleMinutes, 10) || 10;
  const sql = `UPDATE as_agent_runs
               SET status='orphaned', exit_reason='stale-heartbeat'
               WHERE status='running'
                 AND last_heartbeat_at IS NOT NULL
                 AND last_heartbeat_at < datetime('now', '-${stale} minutes')
               RETURNING id`;
  const rows = db.prepare(sql).all();
  return { swept: rows.length, ids: rows.map(r => r.id) };
}
module.exports = { sweepOrphans };
```

## T4.8 scheduler

```js
function startScheduler(db, { intervalMs = 5*60*1000, staleMinutes = 10 } = {}) {
  const { sweepOrphans } = require('./stale-detector');
  let timer = null;
  const tick = () => {
    try {
      const r = sweepOrphans(db, staleMinutes);
      if (r.swept > 0) console.log(`[scheduler] swept ${r.swept} orphan(s): ${r.ids.join(',')}`);
    } catch (e) {
      console.error('[scheduler] error:', e.message);
    }
  };
  // Don't sweep immediately — wait first interval
  timer = setInterval(tick, intervalMs);
  return () => { if (timer) clearInterval(timer); };
}
module.exports = { startScheduler };
```

`index.js` calls `const stopScheduler = startScheduler(db, {})` on start, calls `stopScheduler()` on SIGTERM.

## T4.7 CLI

`hseos state-stale-sweep [--directory D] [--stale-minutes N]` — opens DB read-write, runs `sweepOrphans`, prints result. JSON-on-stdout via `--json` flag.

## T4.9 test

`test/test-mcp-agent-state.js`: spawns MCP server (port aleatório), seeds DB com run+task+agent_run, calls `tools/list` e `tools/call` para os novos tools (runs_list, agent_runs_list, events_search). Skip-clean.

## Order of operations

1. Commit scaffolding (run-dir 4 .md)
2. Criar 9 worktrees via `git branch + git worktree add`
3. Implementar 9 tasks paralelas
4. Merge sequencial via `chore(merge): ...`
5. Cleanup
6. Closeout: lint, WAVE-4-REPORT, commit
