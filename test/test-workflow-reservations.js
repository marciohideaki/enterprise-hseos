'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { WorkflowEngine, digest } = require('../packages/agent-orchestration');
const { SessionEventSchema } = require('../packages/agent-runtime-contracts');
const { RelationalSessionEventStore, replaySessionEvents } = require('../packages/agent-session-store');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const {
  applyExecutionLedgerFixtureSchema,
  createExecutionLedgerFileFixture,
} = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');
const { kernelSession } = require('./fixtures/agent-runtime-contracts');

const parent = {
  ...kernelSession,
  session_id: 'session:reservation-parent',
  limits: { ...kernelSession.limits, max_duration_ms: 30_000, max_children: 8 },
};
const timestamp = '2026-09-28T12:00:00.000Z';
const claim = 'session-event://event:reserve';

function event(type, payload, sequence) {
  return {
    schema_version: 1,
    event_id: `event:${type.replaceAll('.', '-')}-${sequence}`,
    session_id: parent.session_id,
    sequence,
    occurred_at: timestamp,
    event_type: type,
    payload,
  };
}

function step(id, limitOverrides = {}) {
  return {
    step_id: `step:${id}`,
    child_spec: {
      ...parent,
      session_id: `session:reservation-child-${id}`,
      agent_id: `agent:reservation-child-${id}`,
      parent_session_id: parent.session_id,
      limits: {
        ...parent.limits,
        max_turns: 1,
        max_tokens: 100,
        max_tool_calls: 0,
        max_children: 0,
        max_workflow_steps: 0,
        ...limitOverrides,
      },
    },
    turn_id: `turn:${id}`,
    message: { role: 'user', content: `Run ${id}` },
  };
}

function definition(phases = [{ phase_id: 'phase:first', mode: 'pipeline', steps: [step('one')] }], overrides = {}) {
  return {
    schema_version: 1,
    workflow_id: 'workflow:reservation',
    subagent_provider_id: 'subagent:fixture',
    max_parallelism: 2,
    join_timeout_ms: 1000,
    phases,
    ...overrides,
  };
}

function baseEvents(first = definition()) {
  return [
    event('session.created', { spec: parent }, 1),
    {
      ...event(
        'workflow.reserved',
        {
          workflow_id: first.workflow_id,
          definition_digest: digest(first),
          claim_id: 'claim:original',
          claim_expires_at: '2026-09-28T11:00:00.000Z',
          step_count: first.phases.flatMap((phase) => phase.steps).length,
          child_session_ids: first.phases.flatMap((phase) => phase.steps.map((item) => item.child_spec.session_id)),
        },
        2,
      ),
      event_id: 'event:reserve',
    },
  ];
}

function revision(previous, next, sequence = 3, overrides = {}) {
  return event(
    'workflow.revised',
    {
      workflow_id: previous.workflow_id,
      claim_ref: claim,
      revision: 2,
      previous_definition: previous,
      definition: next,
      ...overrides,
    },
    sequence,
  );
}

function appended(previous = definition(), id = 'two') {
  return definition([...structuredClone(previous.phases), { phase_id: `phase:${id}`, mode: 'pipeline', steps: [step(id)] }]);
}

function checkpoint(workflow, phase, sequence, payloadOverrides = {}) {
  return event(
    'workflow.phase.checkpointed',
    {
      workflow_id: workflow.workflow_id,
      definition_digest: digest(workflow),
      claim_ref: claim,
      phase_id: phase.phase_id,
      mode: phase.mode,
      completed_step_ids: phase.steps.map((item) => item.step_id),
      child_session_ids: phase.steps.map((item) => item.child_spec.session_id),
      checkpoint_ref: `workflow-checkpoint://${phase.phase_id}`,
      ...payloadOverrides,
    },
    sequence,
  );
}

function reject(events, code) {
  assert.throws(() => replaySessionEvents(events), { code });
}

function openStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations'), { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  return { db, store: new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(db) }) };
}

function completedProvider(store, { onJoin = () => {} } = {}) {
  const outcomes = new Map();
  const spawns = [];
  return {
    outcomes,
    spawns,
    port: {
      manifest() {
        return {
          schema_version: 1,
          provider_id: 'subagent:fixture',
          provider_version: '1.0.0',
          capabilities: ['spawn', 'join', 'cancel'],
          max_parallel_children: 4,
        };
      },
      spawn(input) {
        const childId = input.child_spec.session_id;
        const state = store.replay(parent.session_id);
        store.append({
          session_id: parent.session_id,
          expected_version: state.current_sequence,
          events: [
            event('child.attached', { child_session_id: childId, authority_ceiling_ref: parent.authority_ref }, state.current_sequence + 1),
          ],
        });
        spawns.push(childId);
        outcomes.set(childId, { child_session_id: childId, status: 'completed', outcome_ref: `outcome://${childId}` });
        return {
          schema_version: 1,
          provider_id: input.provider_id,
          request_id: input.request_id,
          parent_session_id: input.parent_session_id,
          child_session_id: childId,
          accepted: true,
          terminal: true,
          event_refs: ['session-event://event:fixture-spawn'],
        };
      },
      join(input) {
        onJoin(input);
        return {
          schema_version: 1,
          provider_id: input.provider_id,
          request_id: input.request_id,
          parent_session_id: input.parent_session_id,
          all_terminal: true,
          children: input.child_session_ids.map((id) => outcomes.get(id)),
          evidence_refs: [],
        };
      },
      cancel(input) {
        const children = input.child_session_ids.map((id) => outcomes.get(id));
        assert.ok(children.every(Boolean));
        return {
          schema_version: 1,
          provider_id: input.provider_id,
          request_id: input.request_id,
          parent_session_id: input.parent_session_id,
          all_terminal: true,
          children,
          evidence_refs: [],
        };
      },
      dispose() {
        throw new Error('unexpected fixture disposal');
      },
    },
    resolve: (_sessionStore, id) => outcomes.get(id) || null,
  };
}

test('session terminals are rejected while a workflow reservation is active', () => {
  const pending = baseEvents();
  reject(
    [...pending, event('session.failed', { error_code: 'internal_error', message: 'failed', retryable: false }, 3)],
    'AGENT_SESSION_WORKFLOW_ACTIVE',
  );
  reject([...pending, event('session.completed', { outcome_ref: 'outcome://premature' }, 3)], 'AGENT_SESSION_WORKFLOW_ACTIVE');
  const cancellation = event('session.cancellation.requested', { reason: 'stop', cascade: true, source: 'user' }, 3);
  reject([...pending, cancellation, event('session.cancelled', { reason: 'stop', cascade: true }, 4)], 'AGENT_SESSION_WORKFLOW_ACTIVE');
});

test('revision keeps the v1 stream and original claim while pinning a new definition', () => {
  const first = definition();
  const next = appended(first);
  const original = replaySessionEvents(baseEvents(first));
  assert.equal(original.workflow_reservations[first.workflow_id].revision, undefined);
  const events = [...baseEvents(first), revision(first, next)];
  const state = replaySessionEvents(events);
  const reservation = state.workflow_reservations[first.workflow_id];
  assert.equal(reservation.revision, 2);
  assert.equal(reservation.definition_digest, digest(next));
  assert.equal(reservation.claim_ref, claim);
  assert.equal(reservation.claim_id, 'claim:original');
  assert.equal(reservation.claim_expires_at, '2026-09-28T11:00:00.000Z');
  assert.deepEqual(
    reservation.revisions.map((item) => item.definition_digest),
    [digest(first), digest(next)],
  );
  assert.deepEqual(replaySessionEvents(events.slice(2), { from: replaySessionEvents(events.slice(0, 2)) }), state);
  const third = appended(next, 'three');
  const chained = replaySessionEvents([...events, revision(next, third, 4, { revision: 3 })]);
  assert.equal(chained.workflow_reservations[first.workflow_id].revision, 3);
  assert.equal(chained.workflow_reservations[first.workflow_id].claim_expires_at, reservation.claim_expires_at);
});

test('revision rejects stale claim, forged history, retroactive edits, cancellation and terminal streams', () => {
  const first = definition();
  const next = appended(first);
  const base = baseEvents(first);
  reject([...base, revision(first, next, 3, { claim_ref: 'session-event://event:stale' })], 'AGENT_SESSION_WORKFLOW_CLAIM_INVALID');
  reject([...base, revision(first, next, 3, { revision: 3 })], 'AGENT_SESSION_WORKFLOW_REVISION_INVALID');
  reject([...base, revision({ ...first, join_timeout_ms: 9 }, next)], 'AGENT_SESSION_WORKFLOW_DEFINITION_CONFLICT');
  const edited = appended(first);
  edited.phases[0].steps[0].message.content = 'changed';
  reject([...base, revision(first, edited)], 'AGENT_SESSION_WORKFLOW_REVISION_RETROACTIVE');
  reject([...base, revision(first, { ...next, max_parallelism: 3 })], 'AGENT_SESSION_WORKFLOW_REVISION_RETROACTIVE');
  reject(
    [...base, event('session.cancellation.requested', { reason: 'stop', cascade: true, source: 'user' }, 3), revision(first, next, 4)],
    'AGENT_SESSION_WORKFLOW_CLAIM_INVALID',
  );
  reject(
    [...base, event('session.failed', { error_code: 'internal_error', message: 'failed', retryable: false }, 3), revision(first, next, 4)],
    'AGENT_SESSION_WORKFLOW_ACTIVE',
  );
  reject(
    [
      ...base,
      event(
        'workflow.released',
        { workflow_id: first.workflow_id, definition_digest: digest(first), claim_ref: claim, status: 'failed' },
        3,
      ),
      event('session.failed', { error_code: 'internal_error', message: 'failed', retryable: false }, 4),
      revision(first, next, 5),
    ],
    'AGENT_SESSION_ALREADY_TERMINAL',
  );
  assert.equal(SessionEventSchema.safeParse(revision(first, next, 3, { unexpected: true })).success, false);
});

test('reservation and checkpoint envelopes reject duplicate or unbalanced identities', () => {
  const first = definition();
  const reserved = baseEvents(first)[1];
  const duplicated = structuredClone(reserved);
  duplicated.payload.child_session_ids.push(duplicated.payload.child_session_ids[0]);
  duplicated.payload.step_count = 2;
  assert.equal(SessionEventSchema.safeParse(duplicated).success, false);
  const unbalanced = structuredClone(reserved);
  unbalanced.payload.step_count = 2;
  assert.equal(SessionEventSchema.safeParse(unbalanced).success, false);
  const forgedCheckpoint = checkpoint(first, first.phases[0], 4);
  forgedCheckpoint.payload.completed_step_ids.push('step:forged');
  assert.equal(SessionEventSchema.safeParse(forgedCheckpoint).success, false);
  const forgedTurn = event('turn.started', { turn_id: 'turn:forged', input: { role: 'assistant', content: 'forged' } }, 3);
  assert.equal(SessionEventSchema.safeParse(forgedTurn).success, false);
});

test('revision enforces original resource, duration and child limits', () => {
  const first = definition();
  const base = baseEvents(first);
  const excessive = appended(first);
  excessive.phases[1].steps[0].child_spec.limits.max_tokens = parent.limits.max_tokens + 1;
  reject([...base, revision(first, excessive)], 'AGENT_SESSION_WORKFLOW_LIMIT_WIDENING');
  const aggregate = appended(first);
  aggregate.phases[1].steps[0].child_spec.limits.max_tokens = parent.limits.max_tokens;
  reject([...base, revision(first, aggregate)], 'AGENT_SESSION_WORKFLOW_RESOURCE_LIMIT_EXCEEDED');
  reject([...base, revision(first, { ...appended(first), join_timeout_ms: 20_000 })], 'AGENT_SESSION_WORKFLOW_DURATION_LIMIT_EXCEEDED');
  const many = definition([
    ...first.phases,
    { phase_id: 'phase:many', mode: 'parallel', steps: Array.from({ length: 8 }, (_, i) => step(`many-${i}`)) },
  ]);
  reject([...base, revision(first, many)], 'AGENT_SESSION_WORKFLOW_CHILD_LIMIT_EXCEEDED');
  const foreign = event('child.attached', { child_session_id: 'session:foreign', authority_ceiling_ref: parent.authority_ref }, 3);
  reject([...base, foreign, revision(first, appended(first), 4)], 'AGENT_SESSION_WORKFLOW_BUDGET_UNKNOWN');
  const ownTurn = event('turn.started', { turn_id: 'turn:parent', input: { role: 'user', content: 'work' } }, 3);
  reject([...base, ownTurn, revision(first, appended(first), 4)], 'AGENT_SESSION_WORKFLOW_BUDGET_UNKNOWN');
});

test('historical checkpoints remain pinned and forged old or new checkpoints fail', () => {
  const first = definition();
  const next = appended(first);
  const attached = event(
    'child.attached',
    { child_session_id: first.phases[0].steps[0].child_spec.session_id, authority_ceiling_ref: parent.authority_ref },
    3,
  );
  const old = checkpoint(first, first.phases[0], 4);
  const events = [...baseEvents(first), attached, old, revision(first, next, 5)];
  const state = replaySessionEvents(events);
  assert.equal(state.workflow_checkpoints[0].definition_digest, digest(first));
  assert.equal(state.workflows[first.workflow_id].definition_digest, digest(next));
  reject(
    [...baseEvents(first), attached, checkpoint(first, first.phases[0], 4, { mode: 'parallel' }), revision(first, next, 5)],
    'AGENT_SESSION_WORKFLOW_CHECKPOINT_INVALID',
  );
  const newAttach = event(
    'child.attached',
    { child_session_id: next.phases[1].steps[0].child_spec.session_id, authority_ceiling_ref: parent.authority_ref },
    6,
  );
  const valid = checkpoint(next, next.phases[1], 7);
  assert.equal(replaySessionEvents([...events, newAttach, valid]).workflow_checkpoints.length, 2);
  reject(
    [...events, newAttach, checkpoint(next, next.phases[1], 7, { completed_step_ids: ['step:one'] })],
    'AGENT_SESSION_WORKFLOW_CHECKPOINT_INVALID',
  );
  reject([...events, newAttach, checkpoint(first, first.phases[0], 7)], 'AGENT_SESSION_WORKFLOW_PHASE_DUPLICATE');
  reject(
    [
      ...events,
      event(
        'workflow.released',
        { workflow_id: first.workflow_id, definition_digest: digest(first), claim_ref: claim, status: 'completed' },
        6,
      ),
    ],
    'AGENT_SESSION_WORKFLOW_RELEASE_INVALID',
  );
});

test('independent SQLite connections serialize revision and cancellation by CAS', (context) => {
  const fixture = createExecutionLedgerFileFixture();
  const secondDb = new Database(fixture.filename);
  secondDb.pragma('foreign_keys = ON');
  secondDb.pragma('busy_timeout = 5000');
  context.after(() => {
    secondDb.close();
    fixture.cleanup();
  });
  const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(fixture.db) });
  const first = definition();
  const next = appended(first);
  store.append({ session_id: parent.session_id, expected_version: 0, events: baseEvents(first) });
  store.append({
    session_id: parent.session_id,
    expected_version: 2,
    events: [
      event(
        'child.attached',
        { child_session_id: first.phases[0].steps[0].child_spec.session_id, authority_ceiling_ref: parent.authority_ref },
        3,
      ),
    ],
  });
  const competing = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(secondDb) });
  const change = revision(first, next, 4);
  store.append({ session_id: parent.session_id, expected_version: 3, events: [change] });
  assert.throws(() =>
    competing.append({ session_id: parent.session_id, expected_version: 3, events: [revision(first, next, 4, { revision: 3 })] }),
  );
  const cancellation = event('session.cancellation.requested', { reason: 'stop', cascade: true, source: 'user' }, 4);
  assert.throws(() => competing.append({ session_id: parent.session_id, expected_version: 3, events: [cancellation] }));
  assert.throws(() =>
    competing.append({ session_id: parent.session_id, expected_version: 3, events: [checkpoint(first, first.phases[0], 4)] }),
  );
  assert.equal(competing.replay(parent.session_id).workflow_reservations[first.workflow_id].revision, 2);
  assert.equal(competing.readSession(parent.session_id).length, 4);
});

test('an in-flight revision does not hide a provider failure or skip child drain', async (context) => {
  const { db, store } = openStore();
  context.after(() => db.close());
  const first = definition([{ phase_id: 'phase:first', mode: 'pipeline', steps: [step('one'), step('two')] }]);
  const next = appended(first, 'three');
  store.append({ session_id: parent.session_id, expected_version: 0, events: [event('session.created', { spec: parent }, 1)] });
  let spawned = 0;
  let joined = 0;
  let cancelled = 0;
  let childTerminal = null;
  const provider = {
    manifest() {
      return {
        schema_version: 1,
        provider_id: first.subagent_provider_id,
        provider_version: '1.0.0',
        capabilities: ['spawn', 'join', 'cancel'],
        max_parallel_children: 4,
      };
    },
    spawn(input) {
      spawned += 1;
      const state = store.replay(parent.session_id);
      const reservation = state.workflow_reservations[first.workflow_id];
      store.append({
        session_id: parent.session_id,
        expected_version: state.current_sequence,
        events: [revision(first, next, state.current_sequence + 1, { claim_ref: reservation.claim_ref })],
      });
      return {
        schema_version: 1,
        provider_id: input.provider_id,
        request_id: input.request_id,
        parent_session_id: input.parent_session_id,
        child_session_id: input.child_spec.session_id,
        accepted: true,
        terminal: false,
        event_refs: ['session-event://event:fixture-spawn'],
      };
    },
    join() {
      joined += 1;
      throw new Error('stale join reached provider');
    },
    cancel(input) {
      cancelled += 1;
      childTerminal = {
        child_session_id: input.child_session_ids[0],
        status: 'cancelled',
        outcome_ref: 'outcome://cancelled',
      };
      return {
        schema_version: 1,
        provider_id: input.provider_id,
        request_id: input.request_id,
        parent_session_id: input.parent_session_id,
        all_terminal: true,
        children: [childTerminal],
        evidence_refs: [],
      };
    },
    dispose() {
      throw new Error('unexpected disposal');
    },
  };
  const engine = new WorkflowEngine({
    engine_id: 'workflow:test',
    session_store: store,
    subagent_provider: provider,
    resolve_child_outcome: () => childTerminal,
  });
  const outcome = await engine.run({
    schema_version: 1,
    engine_id: 'workflow:test',
    request_id: 'request:interleaved-run',
    parent_session_id: parent.session_id,
    workflow: first,
    occurred_at: timestamp,
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(spawned, 1);
  assert.equal(joined, 1);
  assert.equal(cancelled, 1);
  assert.equal(childTerminal.status, 'cancelled');
  assert.equal(store.replay(parent.session_id).workflow_reservations[first.workflow_id].revision, 2);
  assert.equal(store.replay(parent.session_id).workflow_reservations[first.workflow_id].released.status, 'failed');
});

test('revision after a checkpoint executes the appended phase before release', async (context) => {
  const { db, store } = openStore();
  context.after(() => db.close());
  const first = definition();
  const next = appended(first);
  const outcomes = new Map();
  store.append({ session_id: parent.session_id, expected_version: 0, events: [event('session.created', { spec: parent }, 1)] });
  let joined = 0;
  let injected = 0;
  const ledger = store.ledger;
  const originalAppend = ledger.append.bind(ledger);
  ledger.append = (request) => {
    const receipt = originalAppend(request);
    if (
      !injected &&
      request.events.some((item) => JSON.parse(item.payload.session_event_json).event_type === 'workflow.phase.checkpointed')
    ) {
      injected += 1;
      const state = store.replay(parent.session_id);
      store.append({
        session_id: parent.session_id,
        expected_version: state.current_sequence,
        events: [
          revision(first, next, state.current_sequence + 1, { claim_ref: state.workflow_reservations[first.workflow_id].claim_ref }),
        ],
      });
    }
    return receipt;
  };
  const provider = {
    manifest() {
      return {
        schema_version: 1,
        provider_id: first.subagent_provider_id,
        provider_version: '1.0.0',
        capabilities: ['spawn', 'join', 'cancel'],
        max_parallel_children: 4,
      };
    },
    spawn(input) {
      const state = store.replay(parent.session_id);
      const childId = input.child_spec.session_id;
      store.append({
        session_id: parent.session_id,
        expected_version: state.current_sequence,
        events: [
          event('child.attached', { child_session_id: childId, authority_ceiling_ref: parent.authority_ref }, state.current_sequence + 1),
        ],
      });
      outcomes.set(childId, { child_session_id: childId, status: 'completed', outcome_ref: `outcome://${childId}` });
      return {
        schema_version: 1,
        provider_id: input.provider_id,
        request_id: input.request_id,
        parent_session_id: input.parent_session_id,
        child_session_id: childId,
        accepted: true,
        terminal: true,
        event_refs: ['session-event://event:attached'],
      };
    },
    join(input) {
      joined += 1;
      return {
        schema_version: 1,
        provider_id: input.provider_id,
        request_id: input.request_id,
        parent_session_id: input.parent_session_id,
        all_terminal: true,
        children: input.child_session_ids.map((id) => outcomes.get(id)),
        evidence_refs: [],
      };
    },
    cancel() {
      throw new Error('completed child needs no cancellation');
    },
    dispose() {
      throw new Error('unexpected disposal');
    },
  };
  const engine = new WorkflowEngine({
    engine_id: 'workflow:test',
    session_store: store,
    subagent_provider: provider,
    resolve_child_outcome: (_sessionStore, id) => outcomes.get(id) || null,
  });
  const result = await engine.run({
    schema_version: 1,
    engine_id: 'workflow:test',
    request_id: 'request:checkpoint-race',
    parent_session_id: parent.session_id,
    workflow: first,
    occurred_at: timestamp,
  });
  const state = store.replay(parent.session_id);
  assert.equal(result.status, 'completed');
  assert.equal(injected, 1);
  assert.equal(joined, 2);
  assert.equal(state.workflow_reservations[first.workflow_id].revision, 2);
  assert.equal(state.workflow_reservations[first.workflow_id].released.status, 'completed');
  assert.equal(state.workflow_checkpoints[0].definition_digest, digest(first));
  assert.equal(state.workflow_checkpoints[1].definition_digest, digest(next));
});

test('revision-aware engine rejects a forged caller definition before provider manifest', async (context) => {
  const { db, store } = openStore();
  context.after(() => db.close());
  const first = definition();
  const next = appended(first);
  store.append({ session_id: parent.session_id, expected_version: 0, events: [...baseEvents(first), revision(first, next)] });
  let manifests = 0;
  const provider = {
    manifest() {
      manifests += 1;
      throw new Error('provider reached');
    },
    spawn() {
      throw new Error('provider reached');
    },
    join() {
      throw new Error('provider reached');
    },
    cancel() {
      throw new Error('provider reached');
    },
    dispose() {
      throw new Error('provider reached');
    },
  };
  const engine = new WorkflowEngine({ engine_id: 'workflow:test', session_store: store, subagent_provider: provider });
  await assert.rejects(
    () =>
      engine.run({
        schema_version: 1,
        engine_id: 'workflow:test',
        request_id: 'request:revised-run',
        parent_session_id: parent.session_id,
        workflow: { ...next, join_timeout_ms: 999 },
        occurred_at: timestamp,
      }),
    { code: 'WORKFLOW_DEFINITION_CONFLICT' },
  );
  assert.equal(manifests, 0);
  assert.equal(store.readSession(parent.session_id).length, 3);
});

test('engine reclaims an expired revised reservation and follows its durable definition', async (context) => {
  const { db, store } = openStore();
  context.after(() => db.close());
  const first = definition();
  const next = appended(first);
  store.append({ session_id: parent.session_id, expected_version: 0, events: [...baseEvents(first), revision(first, next)] });
  const provider = completedProvider(store);
  const engine = new WorkflowEngine({
    engine_id: 'workflow:test',
    session_store: store,
    subagent_provider: provider.port,
    resolve_child_outcome: provider.resolve,
    clock: { now: () => new Date(timestamp) },
  });
  const result = await engine.run({
    schema_version: 1,
    engine_id: 'workflow:test',
    request_id: 'request:reclaimed-revision',
    parent_session_id: parent.session_id,
    workflow: first,
    occurred_at: timestamp,
    resume_from_ref: claim,
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(
    provider.spawns,
    next.phases.map((phase) => phase.steps[0].child_spec.session_id),
  );
  const state = store.replay(parent.session_id);
  assert.equal(state.workflow_reservations[first.workflow_id].claim_id, 'request:reclaimed-revision');
  assert.equal(state.workflow_reservations[first.workflow_id].released.status, 'completed');
  assert.deepEqual(
    state.workflow_checkpoints.map((item) => item.definition_digest),
    [digest(next), digest(next)],
  );
});

test('revision during join retains the old checkpoint and executes the appended phase', async (context) => {
  const { db, store } = openStore();
  context.after(() => db.close());
  const first = definition();
  const next = appended(first);
  store.append({ session_id: parent.session_id, expected_version: 0, events: [event('session.created', { spec: parent }, 1)] });
  let revised = false;
  const provider = completedProvider(store, {
    onJoin() {
      if (revised) return;
      revised = true;
      const state = store.replay(parent.session_id);
      store.append({
        session_id: parent.session_id,
        expected_version: state.current_sequence,
        events: [
          revision(first, next, state.current_sequence + 1, { claim_ref: state.workflow_reservations[first.workflow_id].claim_ref }),
        ],
      });
    },
  });
  const engine = new WorkflowEngine({
    engine_id: 'workflow:test',
    session_store: store,
    subagent_provider: provider.port,
    resolve_child_outcome: provider.resolve,
  });
  const result = await engine.run({
    schema_version: 1,
    engine_id: 'workflow:test',
    request_id: 'request:revision-during-join',
    parent_session_id: parent.session_id,
    workflow: first,
    occurred_at: timestamp,
  });
  assert.equal(result.status, 'completed');
  assert.equal(revised, true);
  assert.deepEqual(
    store.replay(parent.session_id).workflow_checkpoints.map((item) => item.definition_digest),
    [digest(first), digest(next)],
  );
  assert.deepEqual(
    provider.spawns,
    next.phases.map((phase) => phase.steps[0].child_spec.session_id),
  );
});

test('checkpoint CAS retries after an append-only revision wins the sequence', async (context) => {
  const { db, store } = openStore();
  context.after(() => db.close());
  const first = definition();
  const next = appended(first);
  store.append({ session_id: parent.session_id, expected_version: 0, events: [event('session.created', { spec: parent }, 1)] });
  let injected = false;
  const originalAppend = store.ledger.append.bind(store.ledger);
  store.ledger.append = (request) => {
    if (
      !injected &&
      request.events.some((item) => JSON.parse(item.payload.session_event_json).event_type === 'workflow.phase.checkpointed')
    ) {
      injected = true;
      const state = store.replay(parent.session_id);
      store.append({
        session_id: parent.session_id,
        expected_version: state.current_sequence,
        events: [
          revision(first, next, state.current_sequence + 1, { claim_ref: state.workflow_reservations[first.workflow_id].claim_ref }),
        ],
      });
    }
    return originalAppend(request);
  };
  const provider = completedProvider(store);
  const engine = new WorkflowEngine({
    engine_id: 'workflow:test',
    session_store: store,
    subagent_provider: provider.port,
    resolve_child_outcome: provider.resolve,
  });
  const result = await engine.run({
    schema_version: 1,
    engine_id: 'workflow:test',
    request_id: 'request:checkpoint-cas',
    parent_session_id: parent.session_id,
    workflow: first,
    occurred_at: timestamp,
  });
  assert.equal(result.status, 'completed');
  assert.equal(injected, true);
  const state = store.replay(parent.session_id);
  assert.deepEqual(
    state.workflow_checkpoints.map((item) => item.definition_digest),
    [digest(first), digest(next)],
  );
  assert.deepEqual(
    provider.spawns,
    next.phases.map((phase) => phase.steps[0].child_spec.session_id),
  );
});

test('release CAS follows a revision that wins after the final old checkpoint', async (context) => {
  const { db, store } = openStore();
  context.after(() => db.close());
  const first = definition();
  const next = appended(first);
  store.append({ session_id: parent.session_id, expected_version: 0, events: [event('session.created', { spec: parent }, 1)] });
  let injected = false;
  const originalAppend = store.ledger.append.bind(store.ledger);
  store.ledger.append = (request) => {
    if (!injected && request.events.some((item) => JSON.parse(item.payload.session_event_json).event_type === 'workflow.released')) {
      injected = true;
      const state = store.replay(parent.session_id);
      store.append({
        session_id: parent.session_id,
        expected_version: state.current_sequence,
        events: [
          revision(first, next, state.current_sequence + 1, { claim_ref: state.workflow_reservations[first.workflow_id].claim_ref }),
        ],
      });
    }
    return originalAppend(request);
  };
  const provider = completedProvider(store);
  const engine = new WorkflowEngine({
    engine_id: 'workflow:test',
    session_store: store,
    subagent_provider: provider.port,
    resolve_child_outcome: provider.resolve,
  });
  const result = await engine.run({
    schema_version: 1,
    engine_id: 'workflow:test',
    request_id: 'request:release-cas',
    parent_session_id: parent.session_id,
    workflow: first,
    occurred_at: timestamp,
  });
  assert.equal(result.status, 'completed');
  assert.equal(injected, true);
  const state = store.replay(parent.session_id);
  assert.equal(state.workflow_reservations[first.workflow_id].released.status, 'completed');
  assert.deepEqual(
    state.workflow_checkpoints.map((item) => item.definition_digest),
    [digest(first), digest(next)],
  );
  assert.deepEqual(
    provider.spawns,
    next.phases.map((phase) => phase.steps[0].child_spec.session_id),
  );
});

test('durable cancellation winning the release CAS cannot become completed', async (context) => {
  const { db, store } = openStore();
  context.after(() => db.close());
  const first = definition();
  store.append({ session_id: parent.session_id, expected_version: 0, events: [event('session.created', { spec: parent }, 1)] });
  let injected = false;
  const originalAppend = store.ledger.append.bind(store.ledger);
  store.ledger.append = (request) => {
    if (!injected && request.events.some((item) => JSON.parse(item.payload.session_event_json).event_type === 'workflow.released')) {
      injected = true;
      const state = store.replay(parent.session_id);
      store.append({
        session_id: parent.session_id,
        expected_version: state.current_sequence,
        events: [event('session.cancellation.requested', { reason: 'stop', cascade: true, source: 'user' }, state.current_sequence + 1)],
      });
    }
    return originalAppend(request);
  };
  const provider = completedProvider(store);
  const engine = new WorkflowEngine({
    engine_id: 'workflow:test',
    session_store: store,
    subagent_provider: provider.port,
    resolve_child_outcome: provider.resolve,
  });
  const result = await engine.run({
    schema_version: 1,
    engine_id: 'workflow:test',
    request_id: 'request:cancel-release-cas',
    parent_session_id: parent.session_id,
    workflow: first,
    occurred_at: timestamp,
  });
  assert.equal(injected, true);
  assert.equal(result.status, 'cancelled');
  assert.equal(store.replay(parent.session_id).workflow_reservations[first.workflow_id].released.status, 'cancelled');
  assert.equal(
    store.readSession(parent.session_id).some((item) => item.event_type === 'workflow.released' && item.payload.status === 'completed'),
    false,
  );
});
