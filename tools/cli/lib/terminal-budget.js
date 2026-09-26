'use strict';
const { randomUUID } = require('node:crypto');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');

function terminalBudget(db, taskId) {
  const ledger = new ExecutionEventLedger(db);
  const rows = ledger.readStream('terminal_budget', taskId);
  const reservations = rows
    .filter((r) => r.payload.kind === 'reserved')
    .map((r) => {
      const latest = rows.findLast((v) => v.payload.terminal_id === r.payload.terminal_id).payload;
      return { ...r.payload, settled: latest.kind === 'settled', uncertain: latest.uncertain !== false };
    });
  return { reservations, count: reservations.length };
}
function recordTerminalBudget(db, taskId, payload) {
  const ledger = new ExecutionEventLedger(db);
  const rows = ledger.readStream('terminal_budget', taskId);
  ledger.append({
    aggregate_type: 'terminal_budget',
    aggregate_id: taskId,
    expected_version: rows.length,
    events: [
      {
        event_id: randomUUID(),
        event_type: 'ControlCommandRecorded',
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        correlation_id: taskId,
        causation_id: rows.at(-1)?.event_id || taskId,
        actor: { type: 'hseos', id: 'terminal-control' },
        operation_id: null,
        payload,
        evidence_refs: [],
      },
    ],
  });
}
function assertTerminalsSettled(db, taskId, allowUncertain = false) {
  if (terminalBudget(db, taskId).reservations.some((r) => !r.settled || (!allowUncertain && r.uncertain))) {
    const error = new Error('Terminals require settlement through the control service');
    error.code = 'CONTROL_TERMINALS_UNSETTLED';
    throw error;
  }
}
module.exports = { terminalBudget, recordTerminalBudget, assertTerminalsSettled };
