'use strict';
// C8 (pre-W6 closeout) task side of F14: an engineering task whose contract carries `memory.retrieve`, run over the TEST copy of the
// activated project.db. It prints what entered the assembled context (memory sources with origin/trust/authority/digest), never the note text.
// usage (repository root): node task.cjs <project.db copy> <project_id> <label> <out.json>
const fs = require('node:fs'),
  { createHash } = require('node:crypto');
const root = process.cwd();
const Database = require('node:module').createRequire(root + '/package.json')('better-sqlite3');
const { project, execute, ledgerRows, ALLOW, OPERATOR } = require(root + '/test/helpers/environment-fixtures');
const { ExecutionEventLedger } = require(root + '/tools/mcp-project-state/lib/execution-event-ledger');
const { createGovernedMemory } = require(root + '/tools/cli/lib/memory-context-source');
const [dbPath, projectId, label, output] = process.argv.slice(2);
(async () => {
  const cleanups = [];
  const t = { after: (fn) => cleanups.push(fn) };
  const db = new Database(dbPath);
  cleanups.push(() => db.close());
  const store = createGovernedMemory({ ledger: new ExecutionEventLedger(db), now: () => Date.now(), db });
  const includeUntrusted = process.env.C8_INCLUDE_UNTRUSTED === '1';
  const host = {
    project_id: projectId,
    memory: { store, rules: ALLOW, operator: OPERATOR, ...(includeUntrusted ? { include_untrusted: true } : {}) },
  };
  const result = await execute(t, project(t, ['memory.retrieve']), [], host);
  const events = ledgerRows(
    result,
    "SELECT payload_json FROM execution_events WHERE aggregate_type = 'agent_session' ORDER BY position",
  ).map((row) => JSON.parse(JSON.parse(row.payload_json).session_event_json));
  const assembled = events.find((e) => e.event_type === 'context.assembled');
  const blocks = assembled.payload.request.messages.map((m) => m.content).filter((c) => c.startsWith('[HSEOS MEMORY_DATA'));
  const sources = assembled.payload.sources.filter((s) => s.origin === 'memory');
  const rows = ledgerRows(result, 'SELECT position, aggregate_type, event_type FROM execution_events ORDER BY position');
  const assembledRow = ledgerRows(result, "SELECT position FROM execution_events WHERE aggregate_type = 'agent_session' ORDER BY position");
  const report = {
    label,
    observed_at: new Date().toISOString(),
    task_run_id: result.task_run_id,
    task_id: result.task_id,
    session_id: result.session_id,
    task_ledger_events: rows.length,
    agent_session_event_positions: assembledRow.map((r) => r.position),
    context_assembled_sequence: assembled.sequence ?? assembled.payload?.sequence ?? null,
    task_result: result.task_result,
    project_id: projectId,
    host_include_untrusted: includeUntrusted,
    memory_sources: sources,
    memory_blocks: blocks.map((b) => ({
      sha256: createHash('sha256').update(b).digest('hex'),
      bytes: Buffer.byteLength(b),
      authority_data: /authority=data/.test(b),
    })),
    source_refs: assembled.payload.source_refs,
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ label, task_result: report.task_result, memory_sources: sources.length, blocks: blocks.length }));
  for (const fn of cleanups.toReversed()) {
    try {
      fn();
    } catch {
      /* best effort */
    }
  }
})().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
