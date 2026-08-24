'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');

const { CONTRACT_SCHEMA_VERSION } = require('../packages/agent-runtime-contracts');
const { DelegatedRuntimeHost, DelegatedRuntimeHostError, DelegatedRuntimeStore } = require('../packages/delegated-runtime-host');
const { ClaudeCodeRuntimeProvider, CodexRuntimeProvider, DeepSeekHarnessRuntimeProvider } = require('../packages/runtime-providers');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const {
  createExecutionLedgerFileFixture,
  openExecutionLedgerFileFixture,
} = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const fixtures = require('./fixtures/agent-runtime-contracts');

class DurableHostedDriver {
  constructor(remote) {
    this.remote = remote;
  }

  async create() {
    this.remote.created += 1;
    this.remote.exists = true;
    return { runtime_session_id: this.remote.id, effect_boundary: 'instructions_only', resumable: true };
  }

  async resume({ runtime_session_id }) {
    this.remote.resumed += 1;
    if (!this.remote.exists || runtime_session_id !== this.remote.id) throw new Error('remote session missing');
    return { effect_boundary: 'instructions_only' };
  }

  async send(input) {
    this.remote.sent += 1;
    input.on_event({ type: 'message.delta', text: `result:${input.instruction}` });
    return { stop_reason: 'completed' };
  }

  async cancel() {
    this.remote.cancelled += 1;
  }

  async dispose() {}
  async close() {}
}

class DurableAcpPeer {
  constructor(remote) {
    this.remote = remote;
  }

  subscribe(handlers) {
    this.handlers = handlers;
    return () => {};
  }

  async request(method, params) {
    if (method === 'initialize') {
      return {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, _meta: { hseos: { effectBoundary: 'instructions_only' } } },
        authMethods: [],
      };
    }
    if (method === 'session/new') {
      this.remote.created += 1;
      this.remote.exists = true;
      return { sessionId: this.remote.id };
    }
    if (method === 'session/load') {
      this.remote.resumed += 1;
      if (!this.remote.exists || params.sessionId !== this.remote.id) throw new Error('remote ACP session missing');
      return {};
    }
    if (method === 'session/prompt') {
      this.remote.sent += 1;
      this.handlers.notification('session/update', {
        sessionId: this.remote.id,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'result:ACP' } },
      });
      return { stopReason: 'end_turn' };
    }
    throw new Error(`unexpected ACP method ${method}`);
  }

  async notify(method) {
    if (method === 'session/cancel') this.remote.cancelled += 1;
  }

  async close() {}
}

function spec(providerId, sessionId = 'session:delegated-durable') {
  return {
    ...structuredClone(fixtures.delegatedSession),
    session_id: sessionId,
    execution: { mode: 'delegated', runtime_provider_id: providerId, profile: 'instructions-only' },
    metadata: { cwd: '/workspace/delegated', purpose: 'durable provider substitution' },
  };
}

function factory(Adapter, providerId, remote) {
  return (requestedProviderId) => {
    assert.equal(requestedProviderId, providerId);
    return new Adapter({
      provider_id: providerId,
      driver: new DurableHostedDriver(remote),
      default_cwd: '/workspace/default',
      clock: () => '2026-08-24T01:00:00.000Z',
    });
  };
}

function assembly(db, Adapter, providerId, remote) {
  let tick = 0;
  const store = new DelegatedRuntimeStore({
    ledger: new ExecutionEventLedger(db),
    clock: () => new Date(Date.parse('2026-08-24T01:00:00Z') + tick++ * 1000).toISOString(),
  });
  return {
    host: new DelegatedRuntimeHost({ store, provider_factory: factory(Adapter, providerId, remote), operation_timeout_ms: 500 }),
    store,
  };
}

for (const [name, Adapter, providerId] of [
  ['Codex', CodexRuntimeProvider, 'runtime:codex-durable'],
  ['Claude Code', ClaudeCodeRuntimeProvider, 'runtime:claude-durable'],
]) {
  test(`${name} uses the same durable host to create, reattach in a fresh process, and settle`, async () => {
    const fixture = createExecutionLedgerFileFixture();
    const remote = { id: `remote-${name.toLowerCase().replace(' ', '-')}`, exists: false, created: 0, resumed: 0, sent: 0, cancelled: 0 };
    const sessionId = `session:${name.toLowerCase().replace(' ', '-')}-durable`;
    try {
      const slug = name.toLowerCase().replace(' ', '-');
      const first = assembly(fixture.db, Adapter, providerId, remote).host;
      const created = await first.create({ request_id: `request:${slug}:create`, spec: spec(providerId, sessionId) });
      assert.equal(created.runtime_sequence, 1);
      assert.equal(created.runtime_events[0].event_type, 'runtime.session.started');
      fixture.db.close();

      const reopened = openExecutionLedgerFileFixture(fixture.directory);
      try {
        const second = assembly(reopened.db, Adapter, providerId, remote).host;
        const completed = await second.resumeAndSend({
          request_id: `request:${slug}:send`,
          session_id: sessionId,
          turn_id: `turn:${slug}:1`,
          message: { role: 'user', content: 'inspect durable state' },
        });
        assert.equal(completed.terminal, true);
        assert.deepEqual(
          completed.runtime_events.map((event) => event.event_type),
          ['runtime.session.started', 'runtime.message.delta', 'runtime.session.completed'],
        );
        assert.equal(completed.runtime_events[1].payload.text, 'result:inspect durable state');
        assert.deepEqual({ created: remote.created, resumed: remote.resumed, sent: remote.sent }, { created: 1, resumed: 1, sent: 1 });
        const aggregateTypes = reopened.db
          .prepare('SELECT DISTINCT aggregate_type FROM execution_events ORDER BY aggregate_type')
          .all()
          .map((row) => row.aggregate_type);
        assert.deepEqual(aggregateTypes, ['delegated_runtime']);
      } finally {
        reopened.close();
      }
    } finally {
      fixture.cleanup();
    }
  });
}

test('DeepSeek Harness crosses the same durable host through ACP without a provider-specific core branch', async () => {
  const fixture = createExecutionLedgerFileFixture();
  const providerId = 'runtime:deepseek-durable';
  const remote = { id: 'remote-deepseek-acp', exists: false, created: 0, resumed: 0, sent: 0, cancelled: 0 };
  const providerFactory = () =>
    new DeepSeekHarnessRuntimeProvider({
      provider_id: providerId,
      peer: new DurableAcpPeer(remote),
      default_cwd: '/workspace/default',
      clock: () => '2026-08-24T01:00:00.000Z',
    });
  try {
    const firstStore = new DelegatedRuntimeStore({ ledger: new ExecutionEventLedger(fixture.db) });
    const first = new DelegatedRuntimeHost({ store: firstStore, provider_factory: providerFactory, operation_timeout_ms: 500 });
    await first.create({ request_id: 'request:deepseek:create', spec: spec(providerId, 'session:deepseek-durable') });
    fixture.db.close();

    const reopened = openExecutionLedgerFileFixture(fixture.directory);
    try {
      const secondStore = new DelegatedRuntimeStore({ ledger: new ExecutionEventLedger(reopened.db) });
      const second = new DelegatedRuntimeHost({ store: secondStore, provider_factory: providerFactory, operation_timeout_ms: 500 });
      const completed = await second.resumeAndSend({
        request_id: 'request:deepseek:send',
        session_id: 'session:deepseek-durable',
        turn_id: 'turn:deepseek:1',
        message: { role: 'user', content: 'inspect durable state' },
      });
      assert.deepEqual(
        completed.runtime_events.map((event) => event.event_type),
        ['runtime.session.started', 'runtime.message.delta', 'runtime.session.completed'],
      );
      assert.deepEqual({ created: remote.created, resumed: remote.resumed, sent: remote.sent }, { created: 1, resumed: 1, sent: 1 });
    } finally {
      reopened.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('cancellation reattaches after database reopen and persists terminal truth before returning', async () => {
  const fixture = createExecutionLedgerFileFixture();
  const providerId = 'runtime:codex-cancel-durable';
  const remote = { id: 'remote-cancel', exists: false, created: 0, resumed: 0, sent: 0, cancelled: 0 };
  try {
    await assembly(fixture.db, CodexRuntimeProvider, providerId, remote).host.create({
      request_id: 'request:cancel:create',
      spec: spec(providerId, 'session:cancel-durable'),
    });
    fixture.db.close();
    const reopened = openExecutionLedgerFileFixture(fixture.directory);
    try {
      const host = assembly(reopened.db, CodexRuntimeProvider, providerId, remote).host;
      const cancelled = await host.resumeAndCancel({
        request_id: 'request:cancel:stop',
        session_id: 'session:cancel-durable',
        reason: 'operator stop',
      });
      assert.equal(cancelled.terminal_event.payload.error_code, 'cancelled');
      assert.equal(remote.resumed, 1);
      assert.equal(remote.cancelled, 1);
      assert.equal(host.read('session:cancel-durable').terminal, true);
    } finally {
      reopened.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('durable host fails closed on secret-bearing specs and uncertain create or dispatch gaps', async () => {
  const fixture = createExecutionLedgerFileFixture();
  const providerId = 'runtime:codex-fail-closed';
  const remote = { id: 'remote-fail-closed', exists: false, created: 0, resumed: 0, sent: 0, cancelled: 0 };
  try {
    const { host, store } = assembly(fixture.db, CodexRuntimeProvider, providerId, remote);
    const secretSpec = spec(providerId, 'session:secret-rejected');
    secretSpec.metadata[['api', 'key'].join('_')] = 'must-not-persist';
    await assert.rejects(() => host.create({ request_id: 'request:secret', spec: secretSpec }), /Sensitive field is forbidden/);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM execution_events').get().count, 0);

    const uncertainSpec = spec(providerId, 'session:create-uncertain');
    store.append({
      session_id: uncertainSpec.session_id,
      expected_version: 0,
      event_type: 'delegated.runtime.created',
      payload: { request_id: 'request:create-uncertain', spec: uncertainSpec },
      key: 'request:create-uncertain',
    });
    await assert.rejects(
      () => host.create({ request_id: 'request:create-uncertain', spec: uncertainSpec }),
      (error) => error instanceof DelegatedRuntimeHostError && error.code === 'DELEGATED_RUNTIME_OUTCOME_IN_DOUBT',
    );
    assert.equal(remote.created, 0);

    await host.create({ request_id: 'request:bound:create', spec: spec(providerId, 'session:dispatch-uncertain') });
    let state = host.read('session:dispatch-uncertain');
    state = store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.turn.requested',
      payload: { request_id: 'request:dispatch', turn_id: 'turn:dispatch', message: { role: 'user', content: 'once' } },
      key: 'request:dispatch',
    }).state;
    store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.turn.dispatch_started',
      payload: { request_id: 'request:dispatch' },
      key: 'request:dispatch:started',
    });
    await assert.rejects(
      () =>
        host.resumeAndSend({
          request_id: 'request:dispatch',
          session_id: 'session:dispatch-uncertain',
          turn_id: 'turn:dispatch',
          message: { role: 'user', content: 'once' },
        }),
      (error) => error.code === 'DELEGATED_RUNTIME_OUTCOME_IN_DOUBT',
    );
    assert.equal(remote.sent, 0);
  } finally {
    fixture.cleanup();
  }
});

test('provider manifest drift is rejected before remote reattachment', async () => {
  const fixture = createExecutionLedgerFileFixture();
  const providerId = 'runtime:codex-manifest-drift';
  const remote = { id: 'remote-manifest-drift', exists: false, created: 0, resumed: 0, sent: 0, cancelled: 0 };
  try {
    await assembly(fixture.db, CodexRuntimeProvider, providerId, remote).host.create({
      request_id: 'request:manifest:create',
      spec: spec(providerId, 'session:manifest-drift'),
    });
    const store = new DelegatedRuntimeStore({ ledger: new ExecutionEventLedger(fixture.db) });
    const drifted = new DelegatedRuntimeHost({
      store,
      provider_factory: () =>
        new CodexRuntimeProvider({
          provider_id: providerId,
          provider_version: '2.0.0',
          driver: new DurableHostedDriver(remote),
          default_cwd: '/workspace/default',
        }),
    });
    await assert.rejects(
      () =>
        drifted.resumeAndCancel({
          request_id: 'request:manifest:cancel',
          session_id: 'session:manifest-drift',
          reason: 'stop',
        }),
      /manifest drifted/,
    );
    assert.equal(remote.resumed, 0);
    assert.equal(remote.cancelled, 0);
  } finally {
    fixture.cleanup();
  }
});

test('a durable cancellation intent is retryable while a post-dispatch failure becomes uncertain', async () => {
  const fixture = createExecutionLedgerFileFixture();
  const providerId = 'runtime:codex-retry-cancel';
  const remote = { id: 'remote-retry-cancel', exists: false, created: 0, resumed: 0, sent: 0, cancelled: 0 };
  try {
    const { host, store } = assembly(fixture.db, CodexRuntimeProvider, providerId, remote);
    await host.create({ request_id: 'request:retry:create', spec: spec(providerId, 'session:retry-cancel') });
    let state = host.read('session:retry-cancel');
    store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.cancel.requested',
      payload: { request_id: 'request:retry:cancel', reason: 'retry stop' },
      key: 'request:retry:cancel',
    });
    const cancelled = await host.resumeAndCancel({
      request_id: 'request:retry:cancel',
      session_id: 'session:retry-cancel',
      reason: 'retry stop',
    });
    assert.equal(cancelled.terminal_event.payload.error_code, 'cancelled');
    assert.equal(remote.cancelled, 1);

    const uncertainRemote = { id: 'remote-uncertain', exists: false, created: 0, resumed: 0, sent: 0, cancelled: 0 };
    class ThrowingDriver extends DurableHostedDriver {
      send() {
        this.remote.sent += 1;
        throw new Error('transport disappeared after dispatch');
      }
    }
    const uncertainStore = new DelegatedRuntimeStore({ ledger: new ExecutionEventLedger(fixture.db) });
    const uncertainHost = new DelegatedRuntimeHost({
      store: uncertainStore,
      provider_factory: () =>
        new CodexRuntimeProvider({
          provider_id: providerId,
          driver: new ThrowingDriver(uncertainRemote),
          default_cwd: '/workspace/default',
          clock: () => '2026-08-24T01:00:00.000Z',
        }),
      operation_timeout_ms: 500,
    });
    await uncertainHost.create({
      request_id: 'request:uncertain:create',
      spec: spec(providerId, 'session:uncertain-send'),
    });
    const uncertain = await uncertainHost.resumeAndSend({
      request_id: 'request:uncertain:send',
      session_id: 'session:uncertain-send',
      turn_id: 'turn:uncertain',
      message: { role: 'user', content: 'dispatch once' },
    });
    assert.equal(uncertain.terminal, true);
    assert.equal(uncertain.failed.error_code, 'protocol_error');
    assert.equal(
      fixture.db
        .prepare(
          "SELECT event_type FROM execution_events WHERE aggregate_type = 'delegated_runtime' AND aggregate_id = ? ORDER BY stream_sequence DESC LIMIT 1",
        )
        .get('session:uncertain-send').event_type,
      'delegated.runtime.outcome_uncertain',
    );
    assert.equal(uncertainRemote.sent, 1);
  } finally {
    fixture.cleanup();
  }
});

test('the SQL catalog is sealed after registering every delegated runtime fact', () => {
  const fixture = createExecutionLedgerFileFixture();
  try {
    const registered = fixture.db
      .prepare("SELECT event_type FROM execution_event_schemas WHERE event_type LIKE 'delegated.%' ORDER BY event_type")
      .all()
      .map((row) => row.event_type);
    assert.deepEqual(registered, [
      'delegated.cancel.requested',
      'delegated.runtime.bound',
      'delegated.runtime.created',
      'delegated.runtime.event_recorded',
      'delegated.runtime.failed',
      'delegated.runtime.outcome_uncertain',
      'delegated.turn.dispatch_started',
      'delegated.turn.requested',
    ]);
    assert.throws(
      () => fixture.db.prepare("INSERT INTO execution_event_schemas VALUES ('delegated.forged', 1)").run(),
      /changes require a migration/,
    );
    assert.throws(
      () =>
        fixture.db.prepare("UPDATE execution_event_schemas SET schema_version = 2 WHERE event_type = 'delegated.runtime.created'").run(),
      /changes require a migration/,
    );
  } finally {
    fixture.cleanup();
  }
});

test('delegated host core contains no vendor-specific branch or adapter import', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'packages', 'delegated-runtime-host', 'index.js'), 'utf8');
  for (const vendor of ['CodexRuntimeProvider', 'ClaudeCodeRuntimeProvider', 'AcpRuntimeProvider', 'DeepSeekHarnessRuntimeProvider']) {
    assert.equal(source.includes(vendor), false);
  }
  assert.equal(source.includes("require('../runtime-providers')"), false);
  assert.equal(CONTRACT_SCHEMA_VERSION, 1);
});
