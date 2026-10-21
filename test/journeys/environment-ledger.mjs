// Ledger of the W5 environment journey (W5-11b): the capability services write their events to a REAL execution ledger
// (SQLite, the accepted fixture schema) and the journey asserts the rows it reads back, not a recorded file. Importable on
// its own so the verifier is unit-tested without running the journey.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { createEnvironmentLedgerSink } = require('../../packages/agent-environment');
const { ExecutionEventLedger } = require('../../tools/mcp-project-state/lib/execution-event-ledger');
const { applyExecutionLedgerFixtureSchema } = require('../../tools/mcp-project-state/lib/execution-ledger-schema');

export const ENVIRONMENT_AGGREGATE = 'environment_session';
export const MEMORY_AGGREGATE = 'agent_memory';

/** One entry per capability: the event types its journey step must have left in the ledger. */
export const REQUIRED_EVENTS = Object.freeze({
  lsp: ['environment.lsp.completed', 'environment.lsp.refused'],
  dap: ['environment.dap.completed'],
  browser: ['environment.browser.completed'],
  computer: [
    'environment.computer.session_opened',
    'environment.computer.screenshot',
    'environment.computer.refused',
    'environment.computer.approval_outcome',
    'environment.computer.action_executed',
    'environment.computer.session_closed',
  ],
  memory: ['memory.written', 'memory.deleted'],
});

export function readLedgerRows(db) {
  return db
    .prepare(
      `SELECT position, aggregate_type, aggregate_id, event_type, payload_json FROM execution_events
       WHERE aggregate_type IN (?, ?) ORDER BY position`,
    )
    .all(ENVIRONMENT_AGGREGATE, MEMORY_AGGREGATE)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
}

export function openJourneyLedger({ projectId = 'w5-journey' } = {}) {
  const db = new Database(':memory:');
  applyExecutionLedgerFixtureSchema(db);
  const ledger = new ExecutionEventLedger(db);
  return {
    db,
    ledger,
    projectId,
    /** A `ledger` callback for a service: the event goes to the real ledger (and to `also`, when given). */
    sink(sessionId, also = null) {
      const append = createEnvironmentLedgerSink({
        ledger,
        project_id: projectId,
        actor: { type: 'host', id: 'w5-journey' },
        session_id: sessionId,
      });
      return (event) => {
        if (also) also(event);
        return append(event);
      };
    },
    rows: () => readLedgerRows(db),
    close: () => db.close(),
  };
}

const violation = (rule, message) => ({ rule, message });

/**
 * Pure checker over the rows read back from the ledger. `capabilities` limits the required events to the capabilities whose
 * journey step ran; the default is all of them.
 */
export function assertEnvironmentLedger(rows, { capabilities = Object.keys(REQUIRED_EVENTS) } = {}) {
  const violations = [];
  const types = new Set(rows.map((row) => row.event_type));
  for (const capability of capabilities) {
    for (const type of REQUIRED_EVENTS[capability] ?? []) {
      if (!types.has(type)) violations.push(violation('required_events', `no ${type} row in the ledger (${capability})`));
    }
  }
  for (const row of rows) {
    const expected = row.event_type.startsWith('memory.') ? MEMORY_AGGREGATE : ENVIRONMENT_AGGREGATE;
    if (row.aggregate_type !== expected) {
      violations.push(violation('aggregate', `${row.event_type} is on ${row.aggregate_type}, expected ${expected}`));
    }
    // An environment event names its project in the payload; a memory stream is the project (aggregate_id) and an entry
    // is written only into its own project.
    const isMemory = expected === MEMORY_AGGREGATE;
    const project = isMemory
      ? (row.payload?.entry?.scope?.project_id ?? (row.event_type === 'memory.written' ? undefined : row.aggregate_id))
      : row.payload?.project_id;
    if (typeof project !== 'string' || project.length === 0 || (isMemory && project !== row.aggregate_id)) {
      violations.push(violation('project_scope', `${row.event_type} is not scoped to its project`));
    }
  }
  // Every computer action is approved first: requested, approved and consumed come before the action that ran.
  const computer = rows.filter((row) => row.event_type.startsWith('environment.computer.'));
  const outcomes = (id, outcome) =>
    computer.filter((r) => r.aggregate_id === id && r.event_type.endsWith('approval_outcome') && r.payload.outcome === outcome);
  for (const executed of computer.filter((row) => row.event_type.endsWith('action_executed'))) {
    const consumed = outcomes(executed.aggregate_id, 'consumed').filter((row) => row.position < executed.position);
    const approved = outcomes(executed.aggregate_id, 'approved').filter((row) => row.position < executed.position);
    const requested = outcomes(executed.aggregate_id, 'requested').filter((row) => row.position < executed.position);
    if (consumed.length === 0 || approved.length === 0 || requested.length === 0) {
      violations.push(
        violation(
          'computer_approval_order',
          `action at position ${executed.position} ran without requested, approved and consumed before it`,
        ),
      );
    }
  }
  // A deletion follows the write of the same entry and carries the approval that backed it.
  const memoryRows = rows.filter((row) => row.aggregate_type === MEMORY_AGGREGATE);
  for (const deleted of memoryRows.filter((row) => row.event_type === 'memory.deleted')) {
    if (typeof deleted.payload.approval_id !== 'string' || deleted.payload.approval_id.length === 0) {
      violations.push(violation('memory_delete_approval', `memory.deleted for ${deleted.payload.memory_id} has no approval_id`));
    }
    const written = memoryRows.some(
      (row) =>
        row.event_type === 'memory.written' && row.payload.memory_id === deleted.payload.memory_id && row.position < deleted.position,
    );
    if (!written)
      violations.push(violation('memory_delete_order', `memory.deleted for ${deleted.payload.memory_id} has no earlier memory.written`));
  }
  return { ok: violations.length === 0, violations, rows: rows.length, types: [...types].sort() };
}
