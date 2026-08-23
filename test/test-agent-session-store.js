'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const {
  RelationalSessionEventStore,
  SessionEventStoreError,
  SessionReplayError,
  canonicalJson,
  ledgerEventId,
} = require('../packages/agent-session-store');
const {
  CONTEXT_ASSEMBLY_CONTRACT,
  CONTEXT_PRECEDENCE_PREAMBLE,
  CONTEXT_PRECEDENCE_REF,
} = require('../packages/agent-runtime-contracts');
const { kernelSession, modelRequest, sessionEvent } = require('./fixtures/agent-runtime-contracts');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const {
  applyExecutionLedgerFixtureSchema,
  createExecutionLedgerFileFixture,
} = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');

function openStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  const ledger = new ExecutionEventLedger(db);
  return { db, ledger, store: new RelationalSessionEventStore({ ledger }) };
}

function uuid(label) {
  const hex = createHash('sha256').update(label).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function created(spec = kernelSession, sequence = 1) {
  return { ...sessionEvent('session.created', { spec }, sequence), session_id: spec.session_id };
}

function turn(sequence = 2, sessionId = kernelSession.session_id) {
  return {
    ...sessionEvent('turn.started', { turn_id: 'turn:fixture-1', input: { role: 'user', content: 'read the fixture' } }, sequence),
    session_id: sessionId,
  };
}

function governedRequest(request) {
  return {
    ...request,
    messages: [
      { role: 'system', content: CONTEXT_PRECEDENCE_PREAMBLE },
      {
        role: 'system',
        content: '[HSEOS INSTRUCTION tier=constitution source="governance://constitution"]\nrule\n[END HSEOS INSTRUCTION]',
      },
      {
        role: 'system',
        content: '[HSEOS INSTRUCTION tier=project source="project://instructions"]\nrule\n[END HSEOS INSTRUCTION]',
      },
      request.messages.at(-1),
    ],
  };
}

function context(sequence = 3, request = modelRequest) {
  const governed = governedRequest(request);
  return sessionEvent(
    'context.assembled',
    {
      assembly_contract: CONTEXT_ASSEMBLY_CONTRACT,
      turn_id: governed.turn_id,
      request: governed,
      source_refs: [
        CONTEXT_PRECEDENCE_REF,
        'governance://constitution',
        'project://instructions',
        `session-event://${turn(2, governed.session_id).event_id}`,
        ...governed.tools.map((tool) => tool.governance_ref),
      ],
      budget: {
        counter_id: 'token-counter:fixture',
        context_limit_tokens: 4096,
        reserved_output_tokens: 2048,
        input_limit_tokens: 2048,
        input_tokens: 100,
        message_tokens: 80,
        tool_tokens: 20,
        parameter_tokens: 0,
        overflow_policy: 'reject',
        omitted_source_refs: [],
      },
    },
    sequence,
  );
}

function streamed(sequence, modelSequence, eventType = 'content.delta') {
  const payloadByType = {
    'content.delta': { text: 'deterministic output' },
    completed: { finish_reason: 'stop', provider_response_ref: 'provider-response://fixture' },
  };
  return sessionEvent(
    'model.streamed',
    {
      turn_id: modelRequest.turn_id,
      provider_id: modelRequest.provider_id,
      event: {
        schema_version: 1,
        provider_id: modelRequest.provider_id,
        request_id: modelRequest.request_id,
        event_type: eventType,
        sequence: modelSequence,
        payload: payloadByType[eventType],
      },
    },
    sequence,
  );
}

function executionStarted(label) {
  return {
    event_id: uuid(label),
    event_type: 'ExecutionStarted',
    schema_version: 1,
    occurred_at: '2026-08-22T00:00:00.000Z',
    correlation_id: 'correlation:fixture',
    causation_id: `cause:${label}`,
    actor: { type: 'fixture', id: 'test' },
    operation_id: `operation:${label}`,
    payload: {
      tool: 'fixture.read',
      provider: 'fixture-provider',
      idempotency_key: `idempotency:${label}`,
      dispatch_attempt: 1,
      deadline: '2026-08-22T00:01:00.000Z',
    },
    evidence_refs: [],
  };
}

test('session and governed-operation aggregates share relational global ordering without sharing authority', () => {
  const { db, ledger, store } = openStore();
  try {
    const operation = ledger.append({
      aggregate_type: 'execution',
      aggregate_id: 'operation:fixture',
      expected_version: 0,
      events: [executionStarted('shared-order')],
    });
    const session = store.append({
      session_id: kernelSession.session_id,
      expected_version: 0,
      events: [created()],
    });

    assert.deepEqual(
      operation.events.map((event) => event.position),
      [1],
    );
    assert.deepEqual(session.positions, [2]);
    assert.equal(store.readGlobal({ limit: 1 })[0].position, 2, 'filtering occurs before pagination');
    const row = db.prepare(`SELECT operation_id FROM execution_events WHERE aggregate_type = 'agent_session'`).get();
    assert.equal(row.operation_id, null, 'ordinary session facts do not invent governed operation ownership');
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO execution_events (
             event_id, event_type, aggregate_id, aggregate_type, stream_sequence, schema_version,
             occurred_at, correlation_id, causation_id, actor_json, operation_id, payload_json, evidence_refs_json
           ) VALUES (?, 'ExecutionStarted', 'raw-execution', 'execution', 1, 1, ?, 'corr', 'cause', '{}', NULL, '{}', '[]')`,
        )
        .run(uuid('raw-execution-null-operation'), '2026-08-22T00:00:00.000Z'),
    );
  } finally {
    db.close();
  }
});

test('append and replay enforce one contiguous immutable session lifecycle', () => {
  const { db, store } = openStore();
  try {
    const events = [
      created(),
      turn(),
      context(),
      streamed(4, 0),
      streamed(5, 1, 'completed'),
      sessionEvent(
        'tool.operation_linked',
        { turn_id: modelRequest.turn_id, tool_call_id: 'tool-call:fixture', operation_id: 'operation:fixture' },
        6,
      ),
      sessionEvent('session.completed', { outcome_ref: 'outcome://fixture' }, 7),
    ];
    const result = store.append({ session_id: kernelSession.session_id, expected_version: 0, events });
    const replay = store.replay(kernelSession.session_id);

    assert.equal(result.current_version, 7);
    assert.equal(replay.status, 'completed');
    assert.deepEqual(replay.turn_order, [modelRequest.turn_id]);
    assert.deepEqual(replay.operation_ids, ['operation:fixture']);
    assert.equal(replay.terminal_event.event_type, 'session.completed');
    assert.equal(db.prepare(`SELECT operation_id FROM execution_events WHERE stream_sequence = 6`).get().operation_id, 'operation:fixture');
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 7,
          events: [sessionEvent('session.resumed', { from_sequence: 7 }, 8)],
        }),
      (error) => error instanceof SessionReplayError && error.code === 'AGENT_SESSION_ALREADY_TERMINAL',
    );
  } finally {
    db.close();
  }
});

test('model request reconstruction is canonical, immutable and source-linked', () => {
  const { db, store } = openStore();
  try {
    store.append({
      session_id: kernelSession.session_id,
      expected_version: 0,
      events: [created(), turn(), context()],
    });
    const reconstructed = store.reconstructRequest(kernelSession.session_id, { turn_id: modelRequest.turn_id });
    assert.deepEqual(reconstructed.request, governedRequest(modelRequest));
    assert.equal(reconstructed.canonical_json, canonicalJson(governedRequest(modelRequest)));
    assert.equal(reconstructed.byte_length, Buffer.byteLength(canonicalJson(governedRequest(modelRequest)), 'utf8'));
    assert.deepEqual(reconstructed.source_refs, [
      CONTEXT_PRECEDENCE_REF,
      'governance://constitution',
      'project://instructions',
      'session-event://event:fixture-2',
      modelRequest.tools[0].governance_ref,
    ]);
    assert.equal(reconstructed.source_event_id, 'event:fixture-3');
    assert.equal(Object.isFrozen(reconstructed.request), true);
  } finally {
    db.close();
  }
});

test('crash recovery survives process reopen and exact append retry is idempotent', () => {
  const fixture = createExecutionLedgerFileFixture();
  const events = [created(), turn(), context()];
  try {
    const firstStore = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(fixture.db) });
    firstStore.append({ session_id: kernelSession.session_id, expected_version: 0, events });
    fixture.db.close();

    const reopened = new Database(fixture.filename);
    try {
      reopened.pragma('foreign_keys = ON');
      const recoveredStore = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(reopened) });
      const plan = recoveredStore.recoveryPlan(kernelSession.session_id);
      assert.deepEqual(
        { sequence: plan.current_sequence, action: plan.next_action, request_id: plan.request.request_id },
        { sequence: 3, action: 'restart_model_request', request_id: modelRequest.request_id },
      );
      const retry = recoveredStore.append({ session_id: kernelSession.session_id, expected_version: 0, events });
      assert.equal(retry.idempotent, true);
      assert.equal(recoveredStore.readSession(kernelSession.session_id).length, 3);
    } finally {
      reopened.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('fork records immutable lineage and cannot widen authority, policy or resource limits', () => {
  const { db, store } = openStore();
  try {
    store.append({ session_id: kernelSession.session_id, expected_version: 0, events: [created()] });
    const attached = (childId, sequence) =>
      sessionEvent('child.attached', { child_session_id: childId, authority_ceiling_ref: kernelSession.authority_ref }, sequence);
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 1,
          events: Array.from({ length: kernelSession.limits.max_children + 1 }, (_, index) =>
            attached(`session:direct-child-${index + 1}`, index + 2),
          ),
        }),
      (error) => error instanceof SessionReplayError && error.code === 'AGENT_SESSION_CHILD_LIMIT_EXCEEDED',
    );
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 1,
          events: [attached(kernelSession.session_id, 2)],
        }),
      (error) => error instanceof SessionReplayError && error.code === 'AGENT_SESSION_SELF_CHILD',
    );
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 1,
          events: [attached('session:duplicate-child', 2), attached('session:duplicate-child', 3)],
        }),
      (error) => error instanceof SessionReplayError && error.code === 'AGENT_SESSION_DUPLICATE_CHILD',
    );
    const childSpec = {
      ...kernelSession,
      session_id: 'session:fixture-child',
      parent_session_id: kernelSession.session_id,
      metadata: { purpose: 'fork-test' },
    };
    store.forkSession({
      parent_session_id: kernelSession.session_id,
      parent_sequence: 1,
      child_spec: childSpec,
      event_ids: { attached: 'event:child-attached', created: 'event:child-created', forked: 'event:child-forked' },
      occurred_at: '2026-08-22T00:01:00Z',
    });
    const child = store.replay(childSpec.session_id);
    assert.deepEqual(child.parent, { parent_session_id: kernelSession.session_id, parent_sequence: 1 });
    assert.deepEqual(store.replay(kernelSession.session_id).children, [childSpec.session_id]);

    const retry = store.forkSession({
      parent_session_id: kernelSession.session_id,
      parent_sequence: 1,
      child_spec: childSpec,
      event_ids: { attached: 'event:child-attached', created: 'event:child-created', forked: 'event:child-forked' },
      occurred_at: '2026-08-22T00:01:00Z',
    });
    assert.equal(retry.parent.idempotent, true);
    assert.equal(retry.child.idempotent, true);

    for (let index = 2; index <= kernelSession.limits.max_children; index++) {
      store.forkSession({
        parent_session_id: kernelSession.session_id,
        parent_sequence: 1,
        child_spec: { ...childSpec, session_id: `session:fixture-child-${index}` },
        event_ids: {
          attached: `event:child-${index}-attached`,
          created: `event:child-${index}-created`,
          forked: `event:child-${index}-forked`,
        },
        occurred_at: `2026-08-22T00:01:0${index}Z`,
      });
    }
    assert.equal(store.replay(kernelSession.session_id).children.length, kernelSession.limits.max_children);
    assert.throws(
      () =>
        store.forkSession({
          parent_session_id: kernelSession.session_id,
          parent_sequence: 1,
          child_spec: { ...childSpec, session_id: 'session:fixture-child-over-limit' },
          event_ids: {
            attached: 'event:child-over-limit-attached',
            created: 'event:child-over-limit-created',
            forked: 'event:child-over-limit-forked',
          },
          occurred_at: '2026-08-22T00:01:09Z',
        }),
      (error) => error instanceof SessionEventStoreError && error.code === 'AGENT_SESSION_CHILD_LIMIT_EXCEEDED',
    );

    assert.throws(
      () =>
        store.forkSession({
          parent_session_id: kernelSession.session_id,
          parent_sequence: 1,
          child_spec: {
            ...childSpec,
            session_id: 'session:widened-child',
            limits: { ...childSpec.limits, max_children: childSpec.limits.max_children + 1 },
          },
          event_ids: { attached: 'event:widened-attached', created: 'event:widened-created', forked: 'event:widened-forked' },
          occurred_at: '2026-08-22T00:01:01Z',
        }),
      (error) => error instanceof SessionEventStoreError && error.code === 'AGENT_SESSION_FORK_LIMIT_WIDENING',
    );
  } finally {
    db.close();
  }
});

test('fork parent attachment and child creation commit atomically', () => {
  const { db, store } = openStore();
  try {
    store.append({ session_id: kernelSession.session_id, expected_version: 0, events: [created()] });
    const childSpec = {
      ...kernelSession,
      session_id: 'session:atomic-child',
      parent_session_id: kernelSession.session_id,
    };
    db.exec(`
      CREATE TRIGGER reject_atomic_child
      BEFORE INSERT ON execution_events WHEN NEW.aggregate_id = 'session:atomic-child'
      BEGIN SELECT RAISE(ABORT, 'injected child failure'); END;
    `);
    assert.throws(
      () =>
        store.forkSession({
          parent_session_id: kernelSession.session_id,
          parent_sequence: 1,
          child_spec: childSpec,
          event_ids: {
            attached: 'event:atomic-attached',
            created: 'event:atomic-created',
            forked: 'event:atomic-forked',
          },
          occurred_at: '2026-08-22T00:02:00Z',
        }),
      /injected child failure/,
    );
    assert.deepEqual(store.replay(kernelSession.session_id).children, []);
    assert.deepEqual(store.readSession(childSpec.session_id), []);
  } finally {
    db.close();
  }
});

test('gaps, foreign model streams and forged relational envelopes fail closed', () => {
  const { db, ledger, store } = openStore();
  try {
    assert.throws(
      () => new RelationalSessionEventStore({ ledger, actor: { id: 'lossy', metadata: { omitted: undefined } } }),
      (error) => error instanceof SessionEventStoreError && error.code === 'AGENT_SESSION_ACTOR_INVALID',
    );
    store.append({ session_id: kernelSession.session_id, expected_version: 0, events: [created()] });
    assert.throws(
      () =>
        store.append({
          session_id: 'session:secret-bearing',
          expected_version: 0,
          events: [created({ ...kernelSession, session_id: 'session:secret-bearing', metadata: { api_key: 'must-not-persist' } })],
        }),
      (error) => error instanceof SessionEventStoreError && error.code === 'AGENT_SESSION_SECRET_FORBIDDEN',
    );
    const schemaSession = { ...kernelSession, session_id: 'session:credential-schema' };
    const schemaRequest = {
      ...modelRequest,
      session_id: schemaSession.session_id,
      tools: [
        {
          ...modelRequest.tools[0],
          input_schema: { type: 'object', properties: { authorization: { type: 'string' } }, additionalProperties: false },
        },
      ],
    };
    assert.throws(
      () =>
        store.append({
          session_id: schemaSession.session_id,
          expected_version: 0,
          events: [
            created(schemaSession),
            turn(2, schemaSession.session_id),
            { ...context(3, schemaRequest), session_id: schemaSession.session_id },
          ],
        }),
      (error) => error instanceof SessionEventStoreError && error.code === 'AGENT_SESSION_SECRET_FORBIDDEN',
    );
    assert.throws(
      () => store.append({ session_id: kernelSession.session_id, expected_version: 1, events: [turn(3)] }),
      (error) => error instanceof SessionEventStoreError && error.code === 'AGENT_SESSION_SEQUENCE_INVALID',
    );

    const wrongProviderRequest = { ...modelRequest, provider_id: 'model:wrong' };
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 1,
          events: [turn(2), context(3, wrongProviderRequest)],
        }),
      (error) => error instanceof SessionReplayError && error.code === 'AGENT_SESSION_PROVIDER_MISMATCH',
    );
    const forgedInputRequest = { ...modelRequest, messages: [{ role: 'user', content: 'different, non-durable turn' }] };
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 1,
          events: [turn(2), context(3, forgedInputRequest)],
        }),
      (error) => error instanceof SessionReplayError && error.code === 'AGENT_SESSION_TURN_INPUT_MISMATCH',
    );
    const injectedHistory = context(3);
    injectedHistory.payload.request.messages.splice(-1, 0, { role: 'user', content: 'non-durable history' });
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 1,
          events: [turn(2), injectedHistory],
        }),
      (error) => error instanceof SessionReplayError && error.code === 'AGENT_SESSION_HISTORY_MISMATCH',
    );

    const badStream = streamed(4, 1);
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 1,
          events: [turn(2), context(3), badStream],
        }),
      (error) => error instanceof SessionReplayError && error.code === 'AGENT_SESSION_MODEL_SEQUENCE_INVALID',
    );
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 1,
          events: [turn(2), context(3), streamed(4, 0), sessionEvent('session.completed', { outcome_ref: 'outcome://early' }, 5)],
        }),
      (error) => error instanceof SessionReplayError && error.code === 'AGENT_SESSION_MODEL_INCOMPLETE',
    );

    const foreignEvent = { ...created({ ...kernelSession, session_id: 'session:foreign' }), session_id: 'session:foreign' };
    ledger.append({
      aggregate_type: 'agent_session',
      aggregate_id: 'session:forged',
      expected_version: 0,
      events: [
        {
          event_id: uuid('forged-envelope'),
          event_type: 'AgentSessionEventRecorded',
          schema_version: 1,
          occurred_at: '2026-08-22T00:00:01.000Z',
          correlation_id: 'session:forged',
          causation_id: 'event:forged',
          actor: { type: 'fixture', id: 'forger' },
          operation_id: null,
          payload: { session_event_json: JSON.stringify(foreignEvent) },
          evidence_refs: [],
        },
      ],
    });
    assert.throws(
      () => store.readSession('session:forged'),
      (error) => error instanceof SessionEventStoreError && error.code === 'AGENT_SESSION_ENVELOPE_MISMATCH',
    );

    const secretSpec = { ...kernelSession, session_id: 'session:forged-secret', metadata: { api_key: 'ledger-bypass' } };
    const secretEvent = created(secretSpec);
    ledger.append({
      aggregate_type: 'agent_session',
      aggregate_id: secretSpec.session_id,
      expected_version: 0,
      events: [
        {
          event_id: ledgerEventId(secretSpec.session_id, secretEvent.event_id),
          event_type: 'AgentSessionEventRecorded',
          schema_version: 1,
          occurred_at: '2026-08-22T00:00:01.000Z',
          correlation_id: secretSpec.session_id,
          causation_id: secretEvent.event_id,
          actor: { type: 'fixture', id: 'ledger-bypass' },
          operation_id: null,
          payload: { session_event_json: JSON.stringify(secretEvent) },
          evidence_refs: [],
        },
      ],
    });
    assert.throws(
      () => store.readSession(secretSpec.session_id),
      (error) => error instanceof SessionEventStoreError && error.code === 'AGENT_SESSION_SECRET_FORBIDDEN',
    );
  } finally {
    db.close();
  }
});

test('session success cannot contradict a failed model terminal event', () => {
  const { db, store } = openStore();
  try {
    const request = governedRequest(modelRequest);
    const stepId = 'step:failed-terminal';
    store.append({
      session_id: kernelSession.session_id,
      expected_version: 0,
      events: [
        created(),
        turn(),
        context(),
        sessionEvent(
          'model.request.started',
          { turn_id: modelRequest.turn_id, step_id: stepId, request, source_event_ids: [context().event_id] },
          4,
        ),
        sessionEvent(
          'model.streamed',
          {
            turn_id: modelRequest.turn_id,
            step_id: stepId,
            provider_id: modelRequest.provider_id,
            event: {
              schema_version: 1,
              provider_id: modelRequest.provider_id,
              request_id: modelRequest.request_id,
              event_type: 'failed',
              sequence: 0,
              payload: { error_code: 'provider_unavailable', message: 'fixture failure', retryable: true },
            },
          },
          5,
        ),
      ],
    });
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 5,
          events: [sessionEvent('session.completed', { outcome_ref: 'outcome://contradiction' }, 6)],
        }),
      (error) => error.code === 'AGENT_SESSION_SUCCESS_PRECONDITION_INVALID',
    );
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 5,
          events: [sessionEvent('session.cancelled', { reason: 'forged cancellation', cascade: true }, 6)],
        }),
      (error) => error.code === 'AGENT_SESSION_CANCELLATION_REQUIRED',
    );
  } finally {
    db.close();
  }
});

test('session cancellation terminal must exactly match its durable non-deadline request', () => {
  const { db, store } = openStore();
  try {
    store.append({
      session_id: kernelSession.session_id,
      expected_version: 0,
      events: [
        created(),
        sessionEvent(
          'session.cancellation.requested',
          { reason: 'operator requested', cascade: true, source: 'user' },
          2,
        ),
      ],
    });
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 2,
          events: [sessionEvent('session.cancelled', { reason: 'different reason', cascade: true }, 3)],
        }),
      (error) => error.code === 'AGENT_SESSION_CANCELLATION_MISMATCH',
    );
    assert.throws(
      () =>
        store.append({
          session_id: kernelSession.session_id,
          expected_version: 2,
          events: [sessionEvent('session.cancelled', { reason: 'operator requested', cascade: false }, 3)],
        }),
      (error) => error.code === 'AGENT_SESSION_CANCELLATION_MISMATCH',
    );
    const deadlineSpec = { ...kernelSession, session_id: 'session:deadline-cancellation' };
    store.append({
      session_id: deadlineSpec.session_id,
      expected_version: 0,
      events: [
        created(deadlineSpec),
        {
          ...sessionEvent(
            'session.cancellation.requested',
            { reason: 'deadline exhausted', cascade: true, source: 'deadline' },
            2,
          ),
          session_id: deadlineSpec.session_id,
        },
      ],
    });
    assert.throws(
      () =>
        store.append({
          session_id: deadlineSpec.session_id,
          expected_version: 2,
          events: [
            {
              ...sessionEvent('session.cancelled', { reason: 'deadline exhausted', cascade: true }, 3),
              session_id: deadlineSpec.session_id,
            },
          ],
        }),
      (error) => error.code === 'AGENT_SESSION_CANCELLATION_TERMINAL_INVALID',
    );
  } finally {
    db.close();
  }
});
