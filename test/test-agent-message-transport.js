'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  AgentMessageTransportError,
  LocalAgentMessageRelay,
  SCHEMA_VERSION,
  SqliteAgentMessageStore,
  assertAgentMessageRelay,
  createAgentMessageRelayAdapter,
} = require('../packages/agent-message-transport');

function fixture({ policy = () => 'accept', presence = () => true, max_inbox = 8, rate_limit = 8, now = '2026-08-24T06:00:00.000Z' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-message-'));
  const filename = path.join(directory, 'messages.sqlite');
  const db = new Database(filename);
  let current = now;
  const store = new SqliteAgentMessageStore(db, { fixture_root: directory });
  const presenceControl = Object.freeze({ fixture: directory });
  const createRelay = (principal_id) =>
    new LocalAgentMessageRelay({
      store,
      principal_id,
      presence_control: presenceControl,
      inbound_policy: policy,
      presence_policy: presence,
      max_inbox,
      rate_limit,
      clock: () => current,
    });
  const relay = createRelay('agent:sender');
  const recipientRelay = createRelay('agent:recipient');
  return {
    db,
    directory,
    filename,
    relay,
    recipientRelay,
    presenceControl,
    createRelay,
    store,
    setNow(value) {
      current = value;
    },
    cleanup() {
      if (db.open) db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function message(overrides = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    message_id: 'message:one',
    sender_id: 'agent:sender',
    recipient_id: 'agent:recipient',
    idempotency_key: 'send:one',
    text: 'review status -- this is text, not a command',
    ttl_ms: 60_000,
    ...overrides,
  };
}

function receive(relay, recipient_id = 'agent:recipient') {
  return relay.receive({ schema_version: 1, recipient_id, limit: 32 });
}

test('delivery and acknowledgement are durable before returning and survive reopen', () => {
  const item = fixture();
  try {
    const delivered = item.relay.send(message());
    assert.equal(delivered.status, 'delivered');
    assert.equal(delivered.replayed, false);
    assert.equal(item.db.prepare('SELECT COUNT(*) AS count FROM agent_message_events').get().count, 2);
    assert.equal(receive(item.recipientRelay).length, 1);
    const acknowledged = item.recipientRelay.acknowledge({ schema_version: 1, recipient_id: 'agent:recipient', message_id: 'message:one' });
    assert.equal(acknowledged.acknowledged, true);
    item.db.close();
    const reopened = new Database(item.filename);
    const store = new SqliteAgentMessageStore(reopened, { fixture_root: item.directory });
    assert.equal(store.read('message:one').acknowledged, true);
    assert.throws(() => reopened.prepare('DELETE FROM agent_message_events').run(), /immutable/);
    reopened.close();
  } finally {
    item.cleanup();
  }
});

test('hold, refuse, flush, and TTL expiration are explicit durable states', () => {
  let decision = 'hold';
  const item = fixture({ policy: () => decision });
  try {
    assert.equal(item.relay.send(message()).status, 'held');
    decision = 'accept';
    assert.equal(item.recipientRelay.flushHeld({ schema_version: 1, recipient_id: 'agent:recipient' })[0].status, 'delivered');
    assert.equal(
      item.relay.send(message({ message_id: 'message:two', idempotency_key: 'send:two', recipient_id: 'agent:other' })).status,
      'delivered',
    );
    item.setNow('2026-08-24T06:02:00.000Z');
    assert.deepEqual(receive(item.createRelay('agent:other'), 'agent:other'), []);
    assert.equal(new SqliteAgentMessageStore(item.db, { fixture_root: item.directory }).read('message:two').status, 'expired');
    decision = 'refuse';
    assert.equal(item.relay.send(message({ message_id: 'message:three', idempotency_key: 'send:three' })).status, 'refused');
  } finally {
    item.cleanup();
  }
});

test('an acknowledgement at or after TTL expires the message and fails closed', () => {
  const item = fixture();
  try {
    item.relay.send(message({ ttl_ms: 1 }));
    item.setNow('2026-08-24T06:00:00.001Z');
    assert.throws(
      () => item.recipientRelay.acknowledge({ schema_version: 1, recipient_id: 'agent:recipient', message_id: 'message:one' }),
      (error) => error.code === 'AGENT_MESSAGE_ACK_INVALID',
    );
    assert.equal(item.store.read('message:one').status, 'expired');
  } finally {
    item.cleanup();
  }
});

test('dedup replays exact messages and rejects conflicting reuse', () => {
  const item = fixture();
  try {
    item.relay.send(message());
    assert.equal(item.relay.send(message()).replayed, true);
    assert.throws(
      () => item.relay.send(message({ message_id: 'message:changed', text: 'changed' })),
      (error) => error.code === 'AGENT_MESSAGE_DEDUP_CONFLICT',
    );
    assert.equal(
      item.db.prepare("SELECT COUNT(*) AS count FROM agent_message_events WHERE event_type='agent.message.enqueued'").get().count,
      1,
    );
  } finally {
    item.cleanup();
  }
});

test('bounded inbox, sender rate, and reentrant policy checks cannot race the append', () => {
  const inbox = fixture({ max_inbox: 1 });
  try {
    inbox.relay.send(message());
    assert.throws(
      () => inbox.relay.send(message({ message_id: 'message:two', idempotency_key: 'send:two' })),
      (error) => error.code === 'AGENT_MESSAGE_INBOX_FULL',
    );
    assert.equal(
      inbox.db.prepare("SELECT COUNT(*) AS count FROM agent_message_events WHERE event_type='agent.message.enqueued'").get().count,
      1,
    );
  } finally {
    inbox.cleanup();
  }
  const rate = fixture({ rate_limit: 1 });
  try {
    rate.relay.send(message());
    assert.throws(
      () => rate.relay.send(message({ message_id: 'message:two', idempotency_key: 'send:two', recipient_id: 'agent:other' })),
      (error) => error.code === 'AGENT_MESSAGE_RATE_LIMITED',
    );
  } finally {
    rate.cleanup();
  }
  let relay;
  let nestedCode;
  const reentrant = fixture({
    max_inbox: 1,
    policy: () => {
      try {
        relay.send(message({ message_id: 'message:nested', idempotency_key: 'send:nested' }));
      } catch (error) {
        nestedCode = error.code;
      }
      return 'accept';
    },
  });
  relay = reentrant.relay;
  try {
    relay.send(message());
    assert.equal(nestedCode, 'AGENT_MESSAGE_CONCURRENCY_CONFLICT');
    assert.equal(
      reentrant.db.prepare("SELECT COUNT(*) AS count FROM agent_message_events WHERE event_type='agent.message.enqueued'").get().count,
      1,
    );
  } finally {
    reentrant.cleanup();
  }
});

test('a second SQLite connection cannot interleave a send inside the policy transaction', () => {
  let competingRelay;
  let nestedCode;
  const item = fixture({
    policy: () => {
      try {
        competingRelay.send(message({ message_id: 'message:competing', idempotency_key: 'send:competing' }));
      } catch (error) {
        nestedCode = error.code;
      }
      return 'accept';
    },
  });
  const competingDb = new Database(item.filename, { timeout: 1 });
  competingRelay = new LocalAgentMessageRelay({
    store: new SqliteAgentMessageStore(competingDb, { fixture_root: item.directory }),
    principal_id: 'agent:sender',
    presence_control: item.presenceControl,
    inbound_policy: () => 'accept',
    presence_policy: () => true,
    clock: () => '2026-08-24T06:00:00.000Z',
  });
  try {
    item.relay.send(message());
    assert.equal(nestedCode, 'AGENT_MESSAGE_CONCURRENCY_CONFLICT');
    assert.equal(
      item.db.prepare("SELECT COUNT(*) AS count FROM agent_message_events WHERE event_type='agent.message.enqueued'").get().count,
      1,
    );
  } finally {
    competingDb.close();
    item.cleanup();
  }
});

test('message boundary is text-only and inherited request shapes fail closed', () => {
  const item = fixture();
  try {
    assert.throws(() => item.relay.send({ ...message(), approval: { decision: 'allow' } }), AgentMessageTransportError);
    assert.throws(() => item.relay.send({ ...message(), command: ['rm', '-rf'] }), AgentMessageTransportError);
    assert.equal(item.relay.send(message({ text: '/approve operation-1' })).status, 'delivered');
    assert.throws(
      () => item.relay.send(message({ sender_id: 'agent:victim' })),
      (error) => error.code === 'AGENT_MESSAGE_PRINCIPAL_MISMATCH',
    );
    assert.throws(
      () => item.relay.receive({ schema_version: 1, recipient_id: 'agent:victim', limit: 1 }),
      (error) => error.code === 'AGENT_MESSAGE_PRINCIPAL_MISMATCH',
    );
    assert.equal(item.relay.store, undefined);
    assert.equal(item.store.db, undefined);
    const inherited = Object.create({ schema_version: 1, recipient_id: 'agent:recipient', message_id: 'message:one' });
    assert.throws(() => item.recipientRelay.acknowledge(inherited), AgentMessageTransportError);
    assert.throws(
      () => item.recipientRelay.receive(Object.create({ schema_version: 1, recipient_id: 'agent:recipient', limit: 1 })),
      AgentMessageTransportError,
    );
  } finally {
    item.cleanup();
  }
});

test('persisted payload and identity drift are rejected during reconstruction', () => {
  const forged = fixture();
  try {
    const insert = forged.db.prepare(`INSERT INTO agent_message_events
      (event_id,message_id,sequence,event_type,occurred_at,sender_id,recipient_id,idempotency_key,payload_json)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    insert.run(
      'event:forged',
      'message:forged',
      1,
      'agent.message.enqueued',
      '2026-08-24T06:00:00.000Z',
      'agent:sender',
      'agent:recipient',
      'send:forged',
      '{"schema_version":1,"message_id":"message:forged","sender_id":"agent:sender","recipient_id":"agent:recipient","idempotency_key":"send:forged","text":"x","ttl_ms":1,"created_at":"2026-08-24T06:00:00.000Z","expires_at":"2026-08-24T06:00:00.001Z","__proto__":{"approval":true}}',
    );
    assert.throws(
      () => forged.store.read('message:forged'),
      (error) => error.code === 'AGENT_MESSAGE_INVALID',
    );
  } finally {
    forged.cleanup();
  }

  const drift = fixture();
  try {
    drift.relay.send(message());
    drift.db
      .prepare(
        `INSERT INTO agent_message_events
      (event_id,message_id,sequence,event_type,occurred_at,sender_id,recipient_id,idempotency_key,payload_json)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'event:drift',
        'message:one',
        3,
        'agent.message.acknowledged',
        '2026-08-24T06:01:00.000Z',
        'agent:sender',
        'agent:recipient',
        'send:one',
        JSON.stringify({ reason: 'recipient_ack' }),
      );
    assert.throws(
      () => drift.store.read('message:one'),
      (error) => error.code === 'AGENT_MESSAGE_STREAM_INVALID',
    );
  } finally {
    drift.cleanup();
  }
});

test('one-shot idle notifications require authorization and subscription IDs never replay', async () => {
  const item = fixture({ presence: ({ requester_id }) => requester_id === 'agent:observer' });
  const observer = item.createRelay('agent:observer');
  const intruder = item.createRelay('agent:intruder');
  try {
    assert.throws(
      () =>
        intruder.notifyWhenIdle({
          schema_version: 1,
          requester_id: 'agent:intruder',
          agent_id: 'agent:recipient',
          subscription_id: 'subscription:denied',
          timeout_ms: 10,
        }),
      (error) => error.code === 'AGENT_MESSAGE_PRESENCE_DENIED',
    );
    const request = {
      schema_version: 1,
      requester_id: 'agent:observer',
      agent_id: 'agent:recipient',
      subscription_id: 'subscription:one',
      timeout_ms: 100,
    };
    const pending = observer.notifyWhenIdle(request);
    observer.setIdle({ schema_version: 1, agent_id: 'agent:recipient', idle: true, control: item.presenceControl });
    assert.deepEqual(await pending, { agent_id: 'agent:recipient', subscription_id: 'subscription:one', idle: true });
    assert.throws(
      () => observer.notifyWhenIdle(request),
      (error) => error.code === 'AGENT_MESSAGE_SUBSCRIPTION_INVALID',
    );
    item.db.close();
    const reopened = new Database(item.filename);
    const restarted = new LocalAgentMessageRelay({
      store: new SqliteAgentMessageStore(reopened, { fixture_root: item.directory }),
      principal_id: 'agent:observer',
      presence_control: item.presenceControl,
      inbound_policy: () => 'accept',
      presence_policy: () => true,
      clock: () => '2026-08-24T06:00:00.000Z',
    });
    assert.throws(
      () => restarted.notifyWhenIdle(request),
      (error) => error.code === 'AGENT_MESSAGE_SUBSCRIPTION_INVALID',
    );
    reopened.close();
    assert.throws(() => observer.notifyWhenIdle(Object.create(request)), AgentMessageTransportError);
    assert.throws(
      () => observer.setIdle({ schema_version: 1, agent_id: 'agent:recipient', idle: false, control: {} }),
      (error) => error.code === 'AGENT_MESSAGE_PRESENCE_DENIED',
    );
  } finally {
    item.cleanup();
  }
});

test('dedicated fixture gate rejects arbitrary application databases before DDL', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-message-scope-'));
  const db = new Database(path.join(directory, 'application.sqlite'));
  try {
    db.exec('CREATE TABLE application_data (id INTEGER)');
    assert.throws(
      () => new SqliteAgentMessageStore(db, { fixture_root: directory }),
      (error) => error.code === 'AGENT_MESSAGE_STORE_SCOPE_INVALID',
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='agent_message_events'").get().count, 0);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const malformedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-message-schema-'));
  const malformed = new Database(path.join(malformedDirectory, 'messages.sqlite'));
  try {
    malformed.exec('CREATE TABLE agent_message_events (position INTEGER)');
    assert.throws(
      () => new SqliteAgentMessageStore(malformed, { fixture_root: malformedDirectory }),
      (error) => error.code === 'AGENT_MESSAGE_STORE_SCOPE_INVALID',
    );
  } finally {
    malformed.close();
    fs.rmSync(malformedDirectory, { recursive: true, force: true });
  }
});

test('relay clock cannot regress', () => {
  const item = fixture();
  try {
    item.relay.send(message());
    item.setNow('2026-08-24T05:59:59.999Z');
    assert.throws(
      () => receive(item.recipientRelay),
      (error) => error.code === 'AGENT_MESSAGE_CLOCK_REGRESSION',
    );
  } finally {
    item.cleanup();
  }
});

test('relay port is nominal and provider-neutral adapters are explicitly registered', () => {
  const item = fixture();
  try {
    assert.equal(assertAgentMessageRelay(item.relay), item.relay);
    const forwardingMethods = {
      transport: 'http',
      principal_id: 'agent:sender',
      send(input) {
        return item.relay.send(input);
      },
      receive() {},
      acknowledge() {},
      flushHeld() {},
      notifyWhenIdle() {},
    };
    const forwarding = createAgentMessageRelayAdapter(forwardingMethods);
    forwardingMethods.send = () => ({ approval: true });
    const validState = forwarding.send(message());
    assert.equal(validState.status, 'delivered');
    const identityDrift = createAgentMessageRelayAdapter({
      transport: 'remote',
      principal_id: 'agent:sender',
      send() {
        return { ...validState, message_id: 'message:other', idempotency_key: 'send:other' };
      },
      receive() {},
      acknowledge() {},
      flushHeld() {},
      notifyWhenIdle() {},
    });
    assert.throws(
      () => identityDrift.send(message()),
      (error) => error.code === 'AGENT_MESSAGE_ADAPTER_INVALID',
    );
    const methods = {
      transport: 'mcp',
      principal_id: 'agent:sender',
      send(input) {
        return { status: 'delivered', approval: true, input };
      },
      receive() {},
      acknowledge() {},
      flushHeld() {},
      notifyWhenIdle() {},
    };
    const adapter = createAgentMessageRelayAdapter(methods);
    assert.equal(assertAgentMessageRelay(adapter), adapter);
    assert.equal(adapter.transport, 'mcp');
    assert.throws(() => adapter.send(message()), AgentMessageTransportError);
    assert.throws(() => assertAgentMessageRelay(Object.create(methods)), AgentMessageTransportError);
    assert.throws(() => assertAgentMessageRelay({ ...methods }), AgentMessageTransportError);
    assert.throws(() => item.relay.send(message({ schema_version: 2 })), AgentMessageTransportError);
    assert.throws(() => item.relay.send(message({ sender_id: '__proto__' })), AgentMessageTransportError);
    assert.throws(() => item.relay.send(message({ text: 'x'.repeat(65_537) })), AgentMessageTransportError);
  } finally {
    item.cleanup();
  }
});
