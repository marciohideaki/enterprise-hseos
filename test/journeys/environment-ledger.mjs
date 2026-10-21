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
 * Pure checker over the rows read back from the ledger. `projectId` is the project the sink was opened for: every row must
 * belong to it. `capabilities` limits the required events to the capabilities whose journey step ran (default: all).
 */
export function assertEnvironmentLedger(rows, { projectId, capabilities = Object.keys(REQUIRED_EVENTS) } = {}) {
  if (typeof projectId !== 'string' || projectId.length === 0) throw new TypeError('assertEnvironmentLedger needs the sink projectId');
  const violations = [];
  const types = new Set(rows.map((row) => row.event_type));
  for (const capability of capabilities) {
    for (const type of REQUIRED_EVENTS[capability] ?? []) {
      if (!types.has(type)) violations.push(violation('required_events', `no ${type} row in the ledger (${capability})`));
    }
  }
  for (const row of rows) {
    const isMemory = row.event_type.startsWith('memory.');
    const expected = isMemory ? MEMORY_AGGREGATE : ENVIRONMENT_AGGREGATE;
    if (row.aggregate_type !== expected) {
      violations.push(violation('aggregate', `${row.event_type} is on ${row.aggregate_type}, expected ${expected}`));
    }
    // An environment event names its project in the payload; a memory stream IS its project (the aggregate id), and an
    // entry is written only into that same project. Both are compared with the project of the sink, not with themselves.
    const scoped = isMemory
      ? row.aggregate_id === projectId && (row.event_type !== 'memory.written' || row.payload?.entry?.scope?.project_id === projectId)
      : row.payload?.project_id === projectId;
    if (!scoped) violations.push(violation('project_scope', `${row.event_type} is not scoped to project ${projectId}`));
  }
  // Every computer action has ITS OWN approval: requested, approved and consumed (same request) come, in that order,
  // before the action, and a request is never spent on a second action.
  const computer = rows.filter((row) => row.event_type.startsWith('environment.computer.'));
  const outcomes = computer.filter((row) => row.event_type.endsWith('approval_outcome'));
  const spentRequests = new Set();
  for (const executed of computer.filter((row) => row.event_type.endsWith('action_executed'))) {
    const { session_id: sessionId, seq, action } = executed.payload;
    const label = `action ${action} (session ${sessionId}, seq ${seq}, position ${executed.position})`;
    const requested = outcomes.find(
      (row) =>
        row.payload.outcome === 'requested' &&
        row.payload.session_id === sessionId &&
        row.payload.seq === seq &&
        row.payload.action === action &&
        row.position < executed.position,
    );
    if (!requested) {
      violations.push(violation('computer_approval_order', `${label} has no requested outcome for its own session, step and action`));
      continue;
    }
    const step = (outcome, after) =>
      outcomes.find(
        (row) =>
          row.payload.outcome === outcome &&
          row.payload.request_id === requested.payload.request_id &&
          row.payload.binding_digest === requested.payload.binding_digest &&
          row.position > after &&
          row.position < executed.position,
      );
    const approved = step('approved', requested.position);
    const consumed = approved && step('consumed', approved.position);
    if (!approved)
      violations.push(violation('computer_approval_order', `${label} has no approved outcome for its request after it was requested`));
    else if (!consumed)
      violations.push(violation('computer_approval_order', `${label} has no consumed outcome for its request after it was approved`));
    if (spentRequests.has(requested.payload.request_id)) {
      violations.push(violation('computer_approval_order', `${label} reuses the approval of an earlier action`));
    }
    spentRequests.add(requested.payload.request_id);
  }
  // A deletion follows the write of the same entry and carries the approval that backed it.
  const memoryRows = rows.filter((row) => row.aggregate_type === MEMORY_AGGREGATE);
  for (const deleted of memoryRows.filter((row) => row.event_type === 'memory.deleted')) {
    if (typeof deleted.payload.approval_id !== 'string' || deleted.payload.approval_id.length === 0) {
      violations.push(violation('memory_delete_approval', `memory.deleted for ${deleted.payload.memory_id} has no approval_id`));
    }
    const written = memoryRows.some(
      (row) =>
        row.event_type === 'memory.written' &&
        row.aggregate_id === deleted.aggregate_id &&
        row.payload.memory_id === deleted.payload.memory_id &&
        row.position < deleted.position,
    );
    if (!written)
      violations.push(violation('memory_delete_order', `memory.deleted for ${deleted.payload.memory_id} has no earlier memory.written`));
  }
  return { ok: violations.length === 0, violations, rows: rows.length, types: [...types].sort() };
}
