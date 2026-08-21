'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { test } = require('node:test');
const Database = require('better-sqlite3');
const { z } = require('zod');

const { ExecutionContractRegistry } = require('../tools/lib/governed-execution/contract-registry');
const {
  createExecutionEventRegistry,
  EventSchemaError,
  ExecutionEventRegistry,
} = require('../tools/lib/governed-execution/event-registry');
const { GovernedExecutionRuntime } = require('../tools/lib/governed-execution/runtime');
const { ExecutionApprovalStore } = require('../tools/mcp-project-state/lib/execution-approval-store');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { ExecutionProjectionStore } = require('../tools/mcp-project-state/lib/execution-projections');
const { runMigrations } = require('../tools/mcp-project-state/lib/migrations');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'tools', 'mcp-project-state', 'migrations');
const NOW = '2026-08-21T05:00:00.000Z';

function toolContract(overrides = {}) {
  return {
    name: 'fixture.echo',
    capability: 'fixture-capability',
    provider: 'fixture-provider',
    authority: 'fixture.execute',
    policy_version: 'policy-v1',
    reversibility: 'read_only',
    cancellation_policy: 'cooperative',
    failure_mode: 'fail_closed',
    timeout_ms: 100,
    requires_approval: false,
    exclusive: false,
    provider_accepts_idempotency: true,
    sandbox: null,
    prerequisites: [],
    input_schema: Object.assign(z.object({ value: z.string() }).strict(), { version: 1 }),
    output_schema: Object.assign(z.object({ echoed: z.string() }).strict(), { version: 1 }),
    ...overrides,
  };
}

function setup({ contract = toolContract(), provider = null, approvalResolver = null, policy = null, authority = null, clock = null } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  const eventRegistry = createExecutionEventRegistry();
  const ledger = new ExecutionEventLedger(db, { event_registry: eventRegistry });
  const projector = new ExecutionProjectionStore(db, ledger);
  projector.rebuild();
  const approvals = new ExecutionApprovalStore(db);
  const contracts = new ExecutionContractRegistry();
  contracts.register(contract);
  const providers = new Map([
    [
      contract.provider,
      provider || {
        async execute(input) {
          return { data: { echoed: input.value }, evidence: ['evidence://provider'] };
        },
      },
    ],
  ]);
  const runtime = new GovernedExecutionRuntime({
    contracts,
    event_registry: eventRegistry,
    ledger,
    approval_store: approvals,
    authority: authority || { async evaluate() { return { allowed: true }; } },
    policy:
      policy ||
      {
        async evaluate() {
          return { allowed: true, requires_approval: false, policy_version: contract.policy_version, warnings: [] };
        },
      },
    providers,
    approval_resolver: approvalResolver,
    projector,
    clock: clock || { now: () => NOW },
    event_id_factory: randomUUID,
  });
  return { approvals, contracts, db, eventRegistry, ledger, projector, providers, runtime };
}

function request(overrides = {}) {
  return {
    tool: 'fixture.echo',
    input: { value: 'hello' },
    actor: { id: 'human-1', type: 'human' },
    resource_scope: { project: 'fixture' },
    idempotency_key: 'fixture-idempotency',
    correlation_id: 'fixture-correlation',
    causation_id: 'fixture-request',
    ...overrides,
  };
}

function issueApproval(store, operation, overrides = {}) {
  return store.issue({
    approval_id: overrides.approval_id || randomUUID(),
    operation_id: operation.operation_id,
    authorizer: { id: 'approver-1', type: 'human' },
    resource_scope: operation.resource_scope,
    issued_at: '2026-08-21T04:59:00.000Z',
    expires_at: '2026-08-21T05:01:00.000Z',
    decision: 'approved',
    policy_version: operation.policy_version,
    evidence_ref: 'evidence://approval',
    ...overrides,
  });
}

test('fixture applies immutable approval migration 007 while the operational runner stays at v4', () => {
  const db = new Database(':memory:');
  try {
    runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
    assert.equal(db.pragma('user_version', { simple: true }), 4);
    applyExecutionLedgerFixtureSchema(db);
    assert.equal(db.pragma('user_version', { simple: true }), 7);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'execution_approvals'`).get().count, 1);
    db.pragma('foreign_keys = OFF');
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO execution_events (
               event_id, event_type, aggregate_id, aggregate_type, stream_sequence, schema_version,
               occurred_at, correlation_id, causation_id, actor_json, operation_id, payload_json, evidence_refs_json
             ) VALUES (?, 'ExecutionBypassed', 'raw-bypass', 'execution', 1, 999, ?, 'corr', 'cause', '{}', 'op', '{}', '[]')`,
          )
          .run(randomUUID(), NOW),
      /not registered/,
    );
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO execution_approvals (
             approval_id, operation_id, authorizer_json, resource_scope_json,
             issued_at, expires_at, decision, policy_version, evidence_ref
           ) VALUES ('bad-time', 'operation', '{"id":"a","type":"human"}', '{"project":"fixture"}',
                     '2026-13-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 'approved', 'v1', 'evidence://bad')`,
        )
        .run(),
    );
  } finally {
    db.close();
  }
});

test('event registry rejects unknown/current-invalid facts and deterministically upcasts history', () => {
  const registry = createExecutionEventRegistry();
  assert.throws(
    () => registry.validateForAppend({ event_type: 'ExecutionInvented', schema_version: 1, payload: {} }),
    (error) => error instanceof EventSchemaError && error.code === 'EXECUTION_EVENT_TYPE_UNREGISTERED',
  );
  assert.throws(
    () => registry.validateForAppend({ event_type: 'ExecutionStarted', schema_version: 2, payload: {} }),
    (error) => error.code === 'EXECUTION_EVENT_SCHEMA_NOT_CURRENT',
  );
  assert.throws(
    () =>
      registry.validateForAppend({
        event_type: 'ExecutionStarted',
        schema_version: 1,
        payload: {
          tool: 'fixture.echo',
          provider: 'fixture',
          idempotency_key: 'id',
          dispatch_attempt: 1,
          deadline: NOW,
          raw_credential: 'forbidden-by-allowlist',
        },
      }),
    (error) => error.code === 'EXECUTION_EVENT_PAYLOAD_INVALID' && error.details.unknown_fields.includes('raw_credential'),
  );
  assert.throws(
    () =>
      registry.validateForAppend({
        event_type: 'ExecutionStarted',
        schema_version: 1,
        payload: {
          tool: 'fixture.echo',
          provider: 'fixture',
          idempotency_key: 'id',
          dispatch_attempt: 'first',
          deadline: NOW,
        },
      }),
    (error) => error.code === 'EXECUTION_EVENT_PAYLOAD_INVALID',
  );

  const historical = new ExecutionEventRegistry([
    {
      event_type: 'FixtureCompleted',
      current_version: 2,
      versions: {
        1: { allowed_fields: ['value'], required_fields: ['value'], classifications: { value: 'operational' } },
        2: {
          allowed_fields: ['result'],
          required_fields: ['result'],
          classifications: { result: 'operational' },
        },
      },
      upcasters: { 1: { rename: { value: 'result' } } },
    },
  ]);
  const source = Object.freeze({ value: 'stable' });
  const first = historical.deserialize({ event_type: 'FixtureCompleted', schema_version: 1, payload: source });
  const second = historical.deserialize({ event_type: 'FixtureCompleted', schema_version: 1, payload: source });
  assert.deepEqual(first, second);
  assert.deepEqual(first.payload, { result: 'stable' });
  assert.deepEqual(source, { value: 'stable' });

  assert.throws(
    () =>
      new ExecutionEventRegistry([
        {
          event_type: 'FixtureRandomized',
          current_version: 2,
          versions: {
            1: { allowed_fields: ['value'], required_fields: ['value'], classifications: { value: 'operational' } },
            2: { allowed_fields: ['result'], required_fields: ['result'], classifications: { result: 'operational' } },
          },
          upcasters: { 1: () => ({ result: randomUUID() }) },
        },
      ]),
    /upcaster must be an object/,
  );
});

test('event registry refuses schema fields without explicit classification', () => {
  assert.throws(
    () =>
      new ExecutionEventRegistry([
        {
          event_type: 'FixtureEvent',
          current_version: 1,
          versions: { 1: { allowed_fields: ['value'], required_fields: ['value'], classifications: {} } },
        },
      ]),
    (error) => error.code === 'EXECUTION_EVENT_FIELD_UNCLASSIFIED',
  );
});

test('runtime seals tool and event registries against post-start injection', () => {
  const fixture = setup();
  try {
    assert.throws(() => fixture.contracts.register(toolContract({ name: 'fixture.late' })), /sealed/);
    assert.throws(
      () =>
        fixture.eventRegistry.register({
          event_type: 'ExecutionInjected',
          current_version: 1,
          versions: { 1: { allowed_fields: [], required_fields: [], classifications: {} } },
        }),
      /sealed/,
    );
  } finally {
    fixture.db.close();
  }
});

test('runtime commits authorized and started facts before provider dispatch and returns one envelope', async () => {
  let ledger;
  let calls = 0;
  const provider = {
    async execute(input, context) {
      calls++;
      assert.deepEqual(
        ledger.readStream('execution', context.operation_id).map((event) => event.event_type),
        ['ExecutionAuthorized', 'ExecutionStarted'],
      );
      assert.equal(context.idempotency_key, 'fixture-idempotency');
      return { data: { echoed: input.value }, evidence: ['evidence://provider'], warnings: ['provider-warning'] };
    },
  };
  const fixture = setup({
    provider,
    policy: {
      async evaluate() {
        return { allowed: true, requires_approval: false, policy_version: 'policy-v1', warnings: ['policy-warning'] };
      },
    },
  });
  ledger = fixture.ledger;
  try {
    const result = await fixture.runtime.execute(request());
    assert.deepEqual(Object.keys(result), ['schema_version', 'ok', 'data', 'error', 'evidence', 'warnings']);
    assert.equal(result.ok, true);
    assert.equal(result.data.result.echoed, 'hello');
    assert.equal(result.data.replayed, false);
    assert.deepEqual(result.evidence, ['evidence://provider']);
    assert.deepEqual(result.warnings, ['policy-warning', 'provider-warning']);
    assert.deepEqual(
      ledger.readStream('execution', result.data.operation_id).map((event) => event.event_type),
      ['ExecutionAuthorized', 'ExecutionStarted', 'ExecutionSucceeded'],
    );
    assert.equal(fixture.projector.listRuns()[0].status, 'succeeded');
    const replay = await fixture.runtime.execute(request());
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);
    assert.deepEqual(replay.data.result, result.data.result);
    assert.deepEqual(replay.evidence, result.evidence);
    assert.deepEqual(replay.warnings, result.warnings);
    assert.equal(calls, 1);
  } finally {
    fixture.db.close();
  }
});

test('input, authority, and policy failures are fail-closed before ledger/provider effects', async () => {
  for (const scenario of ['input', 'authority', 'policy']) {
    let calls = 0;
    const fixture = setup({
      provider: { async execute() { calls++; return { data: { echoed: 'unexpected' } }; } },
      authority: { async evaluate() { return { allowed: scenario !== 'authority' }; } },
      policy: { async evaluate() { return { allowed: scenario !== 'policy', policy_version: 'policy-v1' }; } },
    });
    try {
      const result = await fixture.runtime.execute(request(scenario === 'input' ? { input: { value: 42 } } : {}));
      assert.equal(result.ok, false, scenario);
      assert.equal(calls, 0, scenario);
      assert.equal(fixture.ledger.readGlobal().length, 0, scenario);
    } finally {
      fixture.db.close();
    }
  }
});

test('reserved optional-warning failure mode fails closed before provider or ledger effects', async () => {
  let providerCalls = 0;
  const fixture = setup({
    contract: toolContract({ failure_mode: 'optional_warning' }),
    provider: {
      async execute() {
        providerCalls += 1;
        return { data: { echoed: 'unexpected' } };
      },
    },
  });
  try {
    const result = await fixture.runtime.execute(request());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EXECUTION_FAILURE_MODE_NOT_IMPLEMENTED');
    assert.equal(providerCalls, 0);
    assert.equal(fixture.ledger.readGlobal().length, 0);
  } finally {
    fixture.db.close();
  }
});

test('provided invalid idempotency keys are rejected instead of replaced', async () => {
  let calls = 0;
  const fixture = setup({ provider: { async execute() { calls++; return { data: { echoed: 'unexpected' } }; } } });
  try {
    for (const idempotency_key of ['', 0, null]) {
      const result = await fixture.runtime.execute(request({ idempotency_key }));
      assert.equal(result.error.code, 'EXECUTION_REQUEST_INVALID');
    }
    assert.equal(calls, 0);
    assert.equal(fixture.ledger.readGlobal().length, 0);
  } finally {
    fixture.db.close();
  }
});

test('invalid actor, resource scope, or signal fails before durable facts', async () => {
  for (const invalid of [
    { actor: {} },
    { actor: { id: '', type: 'human' } },
    { resource_scope: {} },
    { signal: { aborted: false } },
  ]) {
    let calls = 0;
    const fixture = setup({ provider: { async execute() { calls++; return { data: { echoed: 'unexpected' } }; } } });
    try {
      const result = await fixture.runtime.execute(request(invalid));
      assert.equal(result.error.code, 'EXECUTION_REQUEST_INVALID');
      assert.equal(calls, 0);
      assert.equal(fixture.ledger.readGlobal().length, 0);
    } finally {
      fixture.db.close();
    }
  }
});

test('malformed policy approval and warning fields fail closed before effects', async () => {
  for (const policyResult of [
    { allowed: true, policy_version: 'policy-v1', requires_approval: 'yes' },
    { allowed: true, policy_version: 'policy-v1', warnings: 'warning' },
  ]) {
    let calls = 0;
    const fixture = setup({
      policy: { async evaluate() { return policyResult; } },
      provider: { async execute() { calls++; return { data: { echoed: 'unexpected' } }; } },
    });
    try {
      const result = await fixture.runtime.execute(request());
      assert.equal(result.error.code, 'EXECUTION_POLICY_DECISION_INVALID');
      assert.equal(calls, 0);
      assert.equal(fixture.ledger.readGlobal().length, 0);
    } finally {
      fixture.db.close();
    }
  }
});

test('explicit approval is immutable, operation-bound, consumed once, and replay does not redispatch', async () => {
  let calls = 0;
  let approvals;
  let resolverCalls = 0;
  const contract = toolContract({ reversibility: 'irreversible_mutation', requires_approval: true });
  const fixture = setup({
    contract,
    provider: { async execute(input) { calls++; return { data: { echoed: input.value } }; } },
    approvalResolver: async (operation) => {
      resolverCalls++;
      return issueApproval(approvals, operation).approval_id;
    },
  });
  approvals = fixture.approvals;
  try {
    const first = await fixture.runtime.execute(request());
    assert.equal(first.ok, true);
    const replay = await fixture.runtime.execute(request());
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);
    assert.equal(calls, 1);
    assert.equal(resolverCalls, 1);
    assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM execution_approval_uses`).get().count, 1);
    assert.throws(() => fixture.db.prepare(`UPDATE execution_approvals SET decision = 'denied'`).run(), /immutable/);
    assert.throws(() => fixture.db.prepare(`DELETE FROM execution_approval_uses`).run(), /immutable/);
    const row = fixture.db.prepare(`SELECT * FROM execution_approvals`).get();
    assert.throws(
      () =>
        fixture.db
          .prepare(
            `INSERT OR REPLACE INTO execution_approvals (
               approval_id, operation_id, authorizer_json, resource_scope_json,
               issued_at, expires_at, decision, policy_version, evidence_ref
             ) VALUES (?, ?, ?, ?, ?, ?, 'denied', ?, ?)`,
          )
          .run(
            row.approval_id,
            row.operation_id,
            row.authorizer_json,
            row.resource_scope_json,
            row.issued_at,
            row.expires_at,
            row.policy_version,
            row.evidence_ref,
          ),
      /identity is immutable/,
    );
  } finally {
    fixture.db.close();
  }
});

test('approval records reject lossy JSON and sensitive scope data', () => {
  const fixture = setup();
  try {
    const base = {
      approval_id: randomUUID(),
      operation_id: 'operation-fixture',
      authorizer: { id: 'approver', type: 'human' },
      resource_scope: { project: 'fixture' },
      issued_at: '2026-08-21T04:59:00.000Z',
      expires_at: '2026-08-21T05:01:00.000Z',
      decision: 'approved',
      policy_version: 'policy-v1',
      evidence_ref: 'evidence://approval',
    };
    assert.throws(
      () => fixture.approvals.issue({ ...base, authorizer: { id: 'approver', metadata: { value: undefined } } }),
      /non-JSON/,
    );
    assert.throws(
      () => fixture.approvals.issue({ ...base, approval_id: randomUUID(), resource_scope: { project: 'fixture', apiKey: 'x' } }),
      (error) => error.code === 'EXECUTION_APPROVAL_SENSITIVE_DATA',
    );
  } finally {
    fixture.db.close();
  }
});

test('expired or scope-mismatched approvals cannot dispatch', async () => {
  for (const scenario of ['expired', 'scope']) {
    let calls = 0;
    let approvals;
    const fixture = setup({
      contract: toolContract({ requires_approval: true }),
      provider: { async execute() { calls++; return { data: { echoed: 'unexpected' } }; } },
      approvalResolver: async (operation) => {
        const overrides =
          scenario === 'expired'
            ? { issued_at: '2026-08-21T04:00:00.000Z', expires_at: '2026-08-21T04:30:00.000Z' }
            : { resource_scope: { project: 'different' } };
        return issueApproval(approvals, operation, overrides).approval_id;
      },
    });
    approvals = fixture.approvals;
    try {
      const result = await fixture.runtime.execute(request());
      assert.equal(result.ok, false, scenario);
      assert.match(result.error.code, /EXECUTION_APPROVAL_(EXPIRED|SCOPE_MISMATCH)/);
      assert.equal(calls, 0);
      assert.equal(fixture.ledger.readGlobal().length, 0);
      assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM execution_approval_uses`).get().count, 0);
    } finally {
      fixture.db.close();
    }
  }
});

test('denied, wrong-policy, not-active, and reused approvals fail before dispatch', async () => {
  for (const scenario of ['denied', 'policy', 'not-active', 'reused']) {
    let calls = 0;
    let approvals;
    const fixture = setup({
      contract: toolContract({ requires_approval: true }),
      provider: { async execute() { calls++; return { data: { echoed: 'unexpected' } }; } },
      approvalResolver: async (operation) => {
        const overridesByScenario = {
          denied: { decision: 'denied' },
          policy: { policy_version: 'policy-v2' },
          'not-active': { issued_at: '2026-08-21T05:01:00.000Z', expires_at: '2026-08-21T05:02:00.000Z' },
          reused: {},
        };
        const approval = issueApproval(approvals, operation, overridesByScenario[scenario]);
        if (scenario === 'reused') {
          approvals.consume({
            approval_id: approval.approval_id,
            operation_id: operation.operation_id,
            resource_scope: operation.resource_scope,
            policy_version: operation.policy_version,
            now: NOW,
          });
        }
        return approval.approval_id;
      },
    });
    approvals = fixture.approvals;
    try {
      const result = await fixture.runtime.execute(request());
      const expectedCodes = {
        denied: 'EXECUTION_APPROVAL_DENIED',
        policy: 'EXECUTION_APPROVAL_POLICY_MISMATCH',
        'not-active': 'EXECUTION_APPROVAL_NOT_ACTIVE',
        reused: 'EXECUTION_APPROVAL_REUSED',
      };
      assert.equal(result.error.code, expectedCodes[scenario]);
      assert.equal(calls, 0);
      assert.equal(fixture.ledger.readGlobal().length, 0);
      assert.equal(
        fixture.db.prepare(`SELECT COUNT(*) AS count FROM execution_approval_uses`).get().count,
        scenario === 'reused' ? 1 : 0,
      );
    } finally {
      fixture.db.close();
    }
  }
});

test('approval consumption rolls back atomically when pre-effect facts cannot commit', async () => {
  let calls = 0;
  let approvals;
  const fixture = setup({
    contract: toolContract({ requires_approval: true }),
    provider: { async execute() { calls++; return { data: { echoed: 'unexpected' } }; } },
    approvalResolver: async (operation) => issueApproval(approvals, operation).approval_id,
  });
  approvals = fixture.approvals;
  fixture.db.exec(`
    CREATE TRIGGER reject_execution_started
    BEFORE INSERT ON execution_events WHEN NEW.event_type = 'ExecutionStarted'
    BEGIN SELECT RAISE(ABORT, 'injected pre-effect append failure'); END;
  `);
  try {
    const result = await fixture.runtime.execute(request());
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
    assert.equal(fixture.ledger.readGlobal().length, 0);
    assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM execution_approval_uses`).get().count, 0);
  } finally {
    fixture.db.close();
  }
});

test('deadline after dispatch records uncertain outcome and same idempotency key never redispatches', async () => {
  let calls = 0;
  const fixture = setup({
    contract: toolContract({ timeout_ms: 10, reversibility: 'idempotent_mutation' }),
    provider: {
      async execute(input, context) {
        calls++;
        return new Promise((resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { outcome: 'cancelled' })), {
            once: true,
          });
        });
      },
    },
  });
  try {
    const first = await fixture.runtime.execute(request());
    assert.equal(first.ok, false);
    assert.equal(first.error.code, 'EXECUTION_OUTCOME_IN_DOUBT');
    assert.equal(fixture.ledger.readGlobal().at(-1).event_type, 'ExecutionOutcomeUncertain');
    const replay = await fixture.runtime.execute(request());
    assert.equal(replay.error.code, 'EXECUTION_OUTCOME_IN_DOUBT');
    assert.equal(calls, 1);
  } finally {
    fixture.db.close();
  }
});

test('approval delay cannot extend the absolute execution deadline', async () => {
  let current = NOW;
  let calls = 0;
  let approvals;
  const fixture = setup({
    contract: toolContract({ requires_approval: true, timeout_ms: 100 }),
    clock: { now: () => current },
    provider: { async execute() { calls++; return { data: { echoed: 'unexpected' } }; } },
    approvalResolver: async (operation) => {
      const approval = issueApproval(approvals, operation, { expires_at: '2026-08-21T05:03:00.000Z' });
      current = '2026-08-21T05:02:00.000Z';
      return approval.approval_id;
    },
  });
  approvals = fixture.approvals;
  try {
    const result = await fixture.runtime.execute(request());
    assert.equal(result.error.code, 'EXECUTION_DEADLINE_EXCEEDED');
    assert.equal(calls, 0);
    assert.equal(fixture.ledger.readGlobal().at(-1).event_type, 'ExecutionCancelled');
  } finally {
    fixture.db.close();
  }
});

test('terminal append failure after provider success stays in doubt and is never automatically replayed', async () => {
  let calls = 0;
  const fixture = setup({
    contract: toolContract({ reversibility: 'idempotent_mutation' }),
    provider: {
      async execute(input) {
        calls++;
        return { data: { echoed: input.value }, receipt_ref: 'evidence://receipt' };
      },
    },
  });
  fixture.db.exec(`
    CREATE TRIGGER reject_execution_success
    BEFORE INSERT ON execution_events WHEN NEW.event_type = 'ExecutionSucceeded'
    BEGIN SELECT RAISE(ABORT, 'injected terminal append failure'); END;
  `);
  try {
    const first = await fixture.runtime.execute(request());
    assert.equal(first.error.code, 'EXECUTION_OUTCOME_IN_DOUBT');
    assert.deepEqual(fixture.ledger.readGlobal().map((event) => event.event_type), ['ExecutionAuthorized', 'ExecutionStarted']);
    const replay = await fixture.runtime.execute(request());
    assert.equal(replay.error.code, 'EXECUTION_OUTCOME_IN_DOUBT');
    assert.equal(calls, 1);
  } finally {
    fixture.db.close();
  }
});

test('same idempotency key cannot cross actor, resource, or contract policy scope', async () => {
  const fixture = setup();
  try {
    const first = await fixture.runtime.execute(request());
    assert.equal(first.ok, true);
    for (const changed of [
      { actor: { id: 'human-2', type: 'human' } },
      { resource_scope: { project: 'different' } },
    ]) {
      const replay = await fixture.runtime.execute(request(changed));
      assert.equal(replay.ok, false);
      assert.equal(replay.error.code, 'EXECUTION_IDEMPOTENCY_SCOPE_CONFLICT');
    }
  } finally {
    fixture.db.close();
  }
});

test('malformed provider evidence is terminally rejected after dispatch', async () => {
  for (const reversibility of ['read_only', 'idempotent_mutation']) {
    const fixture = setup({
      contract: toolContract({ reversibility }),
      provider: { async execute() { return { data: { echoed: 'hello' }, evidence: 'not-an-array' }; } },
    });
    try {
      const result = await fixture.runtime.execute(request({ idempotency_key: `bad-evidence-${reversibility}` }));
      const terminal = fixture.ledger.readGlobal().at(-1).event_type;
      assert.equal(terminal, reversibility === 'read_only' ? 'ExecutionFailed' : 'ExecutionOutcomeUncertain');
      assert.equal(result.error.code, reversibility === 'read_only' ? 'EXECUTION_PROVIDER_RESULT_INVALID' : 'EXECUTION_OUTCOME_IN_DOUBT');
    } finally {
      fixture.db.close();
    }
  }
});

test('malformed provider error receipt is omitted while outcome remains durable', async () => {
  const fixture = setup({
    contract: toolContract({ reversibility: 'idempotent_mutation' }),
    provider: {
      async execute() {
        throw Object.assign(new Error('provider failed'), { outcome: 'uncertain', receipt_ref: { invalid: true } });
      },
    },
  });
  try {
    const result = await fixture.runtime.execute(request());
    assert.equal(result.error.code, 'EXECUTION_OUTCOME_IN_DOUBT');
    assert.deepEqual(result.evidence, []);
    assert.ok(result.warnings.includes('provider_error_receipt_ref_invalid'));
    const terminal = fixture.ledger.readGlobal().at(-1);
    assert.equal(terminal.event_type, 'ExecutionOutcomeUncertain');
    assert.deepEqual(terminal.evidence_refs, []);
    assert.equal(Object.hasOwn(terminal.payload, 'provider_receipt_ref'), false);
  } finally {
    fixture.db.close();
  }
});

test('primitive provider throws still record a terminal outcome', async () => {
  const fixture = setup({ provider: { async execute() { throw 'primitive failure'; } } });
  try {
    const result = await fixture.runtime.execute(request());
    assert.equal(result.ok, false);
    assert.equal(fixture.ledger.readGlobal().at(-1).event_type, 'ExecutionFailed');
  } finally {
    fixture.db.close();
  }
});

test('retryable provider failure remains retryable on immediate response and replay', async () => {
  let calls = 0;
  const fixture = setup({
    provider: {
      async execute() {
        calls++;
        throw Object.assign(new Error('temporary failure'), { code: 'PROVIDER_TEMPORARY', outcome: 'failed', retryable: true });
      },
    },
  });
  try {
    const first = await fixture.runtime.execute(request());
    assert.equal(first.error.retryable, true);
    const replay = await fixture.runtime.execute(request());
    assert.equal(replay.error.retryable, true);
    assert.equal(calls, 1);
  } finally {
    fixture.db.close();
  }
});

test('a provider without idempotency support forces explicit approval', async () => {
  let calls = 0;
  const fixture = setup({
    contract: toolContract({ provider_accepts_idempotency: false }),
    provider: { async execute() { calls++; return { data: { echoed: 'unexpected' } }; } },
  });
  try {
    const result = await fixture.runtime.execute(request());
    assert.equal(result.error.code, 'EXECUTION_APPROVAL_REQUIRED');
    assert.equal(calls, 0);
    assert.equal(fixture.ledger.readGlobal().length, 0);
  } finally {
    fixture.db.close();
  }
});

test('non-cancellable execution ignores a pre-aborted caller signal', async () => {
  let calls = 0;
  const fixture = setup({
    contract: toolContract({ cancellation_policy: 'non_cancellable' }),
    provider: {
      async execute(input, context) {
        calls++;
        assert.equal(context.signal.aborted, false);
        return { data: { echoed: input.value } };
      },
    },
  });
  const controller = new AbortController();
  controller.abort('caller changed mind');
  try {
    const result = await fixture.runtime.execute(request({ signal: controller.signal }));
    assert.equal(result.ok, true);
    assert.equal(calls, 1);
    assert.equal(fixture.ledger.readGlobal().at(-1).event_type, 'ExecutionSucceeded');
  } finally {
    fixture.db.close();
  }
});

test('output contract failure is failed for reads and uncertain for mutations', async () => {
  for (const reversibility of ['read_only', 'idempotent_mutation']) {
    const fixture = setup({
      contract: toolContract({ reversibility }),
      provider: { async execute() { return { data: { wrong: true } }; } },
    });
    try {
      const result = await fixture.runtime.execute(request({ idempotency_key: `invalid-output-${reversibility}` }));
      const expectedType = reversibility === 'read_only' ? 'ExecutionFailed' : 'ExecutionOutcomeUncertain';
      assert.equal(fixture.ledger.readGlobal().at(-1).event_type, expectedType);
      assert.equal(result.error.code, reversibility === 'read_only' ? 'EXECUTION_OUTPUT_INVALID' : 'EXECUTION_OUTCOME_IN_DOUBT');
    } finally {
      fixture.db.close();
    }
  }
});

test('runtime rejects a ledger not bound to the exact fail-closed event registry', () => {
  const db = new Database(':memory:');
  try {
    runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
    applyExecutionLedgerFixtureSchema(db);
    const contracts = new ExecutionContractRegistry();
    contracts.register(toolContract());
    assert.throws(
      () =>
        new GovernedExecutionRuntime({
          contracts,
          event_registry: createExecutionEventRegistry(),
          ledger: new ExecutionEventLedger(db),
          approval_store: new ExecutionApprovalStore(db),
          authority: { evaluate() { return { allowed: true }; } },
          policy: { evaluate() { return { allowed: true, policy_version: 'policy-v1' }; } },
          providers: new Map(),
        }),
      (error) => error.code === 'EXECUTION_EVENT_REGISTRY_BOUNDARY_MISSING',
    );
  } finally {
    db.close();
  }
});

test('runtime rejects approval and ledger stores on different SQLite connections', () => {
  const first = setup();
  const second = setup();
  try {
    assert.throws(
      () =>
        new GovernedExecutionRuntime({
          contracts: first.contracts,
          event_registry: first.eventRegistry,
          ledger: first.ledger,
          approval_store: second.approvals,
          authority: { evaluate() { return { allowed: true }; } },
          policy: { evaluate() { return { allowed: true, policy_version: 'policy-v1' }; } },
          providers: first.providers,
        }),
      (error) => error.code === 'EXECUTION_APPROVAL_LEDGER_TRANSACTION_MISMATCH',
    );
  } finally {
    first.db.close();
    second.db.close();
  }
});

test('the registry-bound ledger rejects direct unregistered execution facts', () => {
  const fixture = setup();
  try {
    assert.throws(
      () =>
        fixture.ledger.append({
          aggregate_type: 'execution',
          aggregate_id: 'direct-bypass',
          expected_version: 0,
          events: [
            {
              event_id: randomUUID(),
              event_type: 'ExecutionBypassed',
              schema_version: 1,
              occurred_at: NOW,
              correlation_id: 'direct',
              causation_id: 'direct',
              actor: { id: 'fixture', type: 'test' },
              operation_id: 'direct-bypass',
              payload: {},
              evidence_refs: [],
            },
          ],
        }),
      (error) => error.code === 'EXECUTION_EVENT_TYPE_UNREGISTERED',
    );
    assert.equal(fixture.ledger.readGlobal().length, 0);
  } finally {
    fixture.db.close();
  }
});

test('a default ledger also fails closed on unregistered execution facts', () => {
  const db = new Database(':memory:');
  try {
    runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
    applyExecutionLedgerFixtureSchema(db);
    const ledger = new ExecutionEventLedger(db);
    assert.throws(
      () => new ExecutionEventLedger(db, { event_registry: null }),
      (error) => error.code === 'EXECUTION_EVENT_REGISTRY_BOUNDARY_MISSING',
    );
    assert.throws(
      () => new ExecutionEventLedger(db, { event_registry: { validateForAppend() {} } }),
      (error) => error.code === 'EXECUTION_EVENT_REGISTRY_BOUNDARY_MISSING',
    );
    assert.throws(
      () =>
        ledger.append({
          aggregate_type: 'execution',
          aggregate_id: 'default-bypass',
          expected_version: 0,
          events: [
            {
              event_id: randomUUID(),
              event_type: 'ExecutionBypassed',
              schema_version: 999,
              occurred_at: NOW,
              correlation_id: 'direct',
              causation_id: 'direct',
              actor: { id: 'fixture', type: 'test' },
              operation_id: 'default-bypass',
              payload: {},
              evidence_refs: [],
            },
          ],
        }),
      (error) => error.code === 'EXECUTION_EVENT_TYPE_UNREGISTERED',
    );
    assert.equal(ledger.readGlobal().length, 0);
  } finally {
    db.close();
  }
});
