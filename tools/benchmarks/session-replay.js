'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const Database = require('better-sqlite3');
const { RelationalSessionEventStore } = require('../../packages/agent-session-store');
const { ExecutionEventLedger } = require('../mcp-project-state/lib/execution-event-ledger');
const { applyExecutionLedgerFixtureSchema } = require('../mcp-project-state/lib/execution-ledger-schema');

const spec = {
  schema_version: 1,
  session_id: 'session:replay-benchmark',
  agent_id: 'agent:benchmark',
  parent_session_id: null,
  authority_ref: 'authority://benchmark',
  policy_ref: 'policy://benchmark',
  execution: { mode: 'kernel', model_provider_id: 'model:benchmark', model: 'benchmark/control' },
  limits: { max_turns: 8, max_tokens: 100_000, max_duration_ms: 30_000, max_tool_calls: 8, max_children: 0, max_workflow_steps: 0 },
  metadata: {},
};
function event(sequence) {
  return {
    schema_version: 1,
    event_id: `event:benchmark:${sequence}`,
    session_id: spec.session_id,
    sequence,
    occurred_at: '2026-09-25T00:00:00.000Z',
    event_type: sequence === 1 ? 'session.created' : 'session.resumed',
    payload: sequence === 1 ? { spec } : { from_sequence: sequence - 1 },
  };
}
function measure(count) {
  const db = new Database(':memory:');
  try {
    applyExecutionLedgerFixtureSchema(db);
    const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(db) });
    store.append({
      session_id: spec.session_id,
      expected_version: 0,
      events: Array.from({ length: count - 1 }, (_, index) => event(index + 1)),
    });
    store.replay(spec.session_id);
    store.append({ session_id: spec.session_id, expected_version: count - 1, events: [event(count)] });
    let started = performance.now();
    const incremental = store.replay(spec.session_id);
    const incrementalMs = performance.now() - started;
    started = performance.now();
    const full = store.replay(spec.session_id, { full: true });
    const fullMs = performance.now() - started;
    assert.deepEqual(incremental, full);
    return { events: count, full_replay_ms: fullMs, incremental_update_ms: incrementalMs, incremental_events_reduced: 1, equivalent: true };
  } finally {
    db.close();
  }
}
if (require.main === module)
  console.log(
    JSON.stringify(
      {
        schema_version: 1,
        node: process.version,
        workload: 'control events; one-event update after a warmed prefix; not a model-payload benchmark',
        measurements: [100, 1000, 10_000].map(measure),
      },
      null,
      2,
    ),
  );
module.exports = { measure };
