'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deepFreeze } = require('../agent-runtime-contracts');

const SCHEMA_VERSION = 1;
const MAX_TEXT_BYTES = 65_536;
const MAX_TTL_MS = 604_800_000;
const MAX_MESSAGES = 10_000;
const MAX_SUBSCRIPTIONS = 100_000;
const IDENTIFIER = /^[^\s\u0000-\u001f\u007f]{1,256}$/u;
const RELAYS = new WeakSet();
const STATUS_EVENTS = Object.freeze({
  delivered: 'agent.message.delivered',
  held: 'agent.message.held',
  refused: 'agent.message.refused',
  expired: 'agent.message.expired',
  acknowledged: 'agent.message.acknowledged',
});
const ROW_KEYS = [
  'position',
  'event_id',
  'message_id',
  'sequence',
  'event_type',
  'occurred_at',
  'sender_id',
  'recipient_id',
  'idempotency_key',
  'payload_json',
];

class AgentMessageTransportError extends Error {
  constructor(message, code = 'AGENT_MESSAGE_INVALID', details = {}) {
    super(message);
    this.name = 'AgentMessageTransportError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AgentMessageTransportError(`${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AgentMessageTransportError(`${label} has non-canonical fields`);
  }
}

function identifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    throw new AgentMessageTransportError(`${label} is invalid`);
  }
  return value;
}

function timestamp(value, label) {
  try {
    if (typeof value !== 'string' || new Date(value).toISOString() !== value) throw new Error('non-canonical');
  } catch {
    throw new AgentMessageTransportError(`${label} must be canonical UTC`);
  }
  return value;
}

function boundedReason(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    throw new AgentMessageTransportError('message transition reason is invalid', 'AGENT_MESSAGE_STREAM_INVALID');
  }
  return value;
}

function addMilliseconds(value, milliseconds) {
  const result = Date.parse(value) + milliseconds;
  if (!Number.isSafeInteger(result) || result > 8_640_000_000_000_000) {
    throw new AgentMessageTransportError('message expiry exceeds the supported clock range');
  }
  return new Date(result).toISOString();
}

function parseSend(value) {
  exactKeys(value, ['schema_version', 'message_id', 'sender_id', 'recipient_id', 'idempotency_key', 'text', 'ttl_ms'], 'send request');
  if (value.schema_version !== SCHEMA_VERSION) throw new AgentMessageTransportError('message schema version is unsupported');
  const bytes = typeof value.text === 'string' ? Buffer.byteLength(value.text, 'utf8') : 0;
  if (bytes < 1 || bytes > MAX_TEXT_BYTES) throw new AgentMessageTransportError('message text exceeds its byte contract');
  if (!Number.isSafeInteger(value.ttl_ms) || value.ttl_ms < 1 || value.ttl_ms > MAX_TTL_MS) {
    throw new AgentMessageTransportError('message ttl is invalid');
  }
  return deepFreeze({
    schema_version: SCHEMA_VERSION,
    message_id: identifier(value.message_id, 'message_id'),
    sender_id: identifier(value.sender_id, 'sender_id'),
    recipient_id: identifier(value.recipient_id, 'recipient_id'),
    idempotency_key: identifier(value.idempotency_key, 'idempotency_key'),
    text: value.text,
    ttl_ms: value.ttl_ms,
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function parsePayload(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AgentMessageTransportError('message payload is not valid JSON', 'AGENT_MESSAGE_STREAM_INVALID');
  }
}

function applyEvent(state, row) {
  exactKeys(row, ROW_KEYS, 'persisted message event');
  if (!Number.isSafeInteger(row.position) || row.position < 1 || !Number.isSafeInteger(row.sequence) || row.sequence < 1) {
    throw new AgentMessageTransportError('message event position is invalid', 'AGENT_MESSAGE_STREAM_INVALID');
  }
  identifier(row.event_id, 'event_id');
  identifier(row.message_id, 'message_id');
  identifier(row.sender_id, 'sender_id');
  identifier(row.recipient_id, 'recipient_id');
  identifier(row.idempotency_key, 'idempotency_key');
  const occurredAt = timestamp(row.occurred_at, 'event occurred_at');
  if (
    row.sequence !== state.version + 1 ||
    row.message_id !== state.message_id ||
    (state.last_occurred_at && Date.parse(occurredAt) < Date.parse(state.last_occurred_at))
  ) {
    throw new AgentMessageTransportError('message stream is discontinuous', 'AGENT_MESSAGE_STREAM_INVALID');
  }
  const payload = parsePayload(row.payload_json);
  if (row.event_type === 'agent.message.enqueued') {
    if (state.version !== 0) throw new AgentMessageTransportError('message enqueue is duplicated', 'AGENT_MESSAGE_STREAM_INVALID');
    exactKeys(
      payload,
      ['schema_version', 'message_id', 'sender_id', 'recipient_id', 'idempotency_key', 'text', 'ttl_ms', 'created_at', 'expires_at'],
      'persisted enqueue payload',
    );
    const message = parseSend({
      schema_version: payload.schema_version,
      message_id: payload.message_id,
      sender_id: payload.sender_id,
      recipient_id: payload.recipient_id,
      idempotency_key: payload.idempotency_key,
      text: payload.text,
      ttl_ms: payload.ttl_ms,
    });
    const createdAt = timestamp(payload.created_at, 'message created_at');
    const expiresAt = timestamp(payload.expires_at, 'message expires_at');
    if (
      createdAt !== occurredAt ||
      Date.parse(expiresAt) !== Date.parse(createdAt) + message.ttl_ms ||
      row.message_id !== message.message_id ||
      row.sender_id !== message.sender_id ||
      row.recipient_id !== message.recipient_id ||
      row.idempotency_key !== message.idempotency_key
    ) {
      throw new AgentMessageTransportError('persisted enqueue identity is inconsistent', 'AGENT_MESSAGE_STREAM_INVALID');
    }
    state.schema_version = message.schema_version;
    state.sender_id = message.sender_id;
    state.recipient_id = message.recipient_id;
    state.idempotency_key = message.idempotency_key;
    state.text = message.text;
    state.ttl_ms = message.ttl_ms;
    state.created_at = createdAt;
    state.expires_at = expiresAt;
    state.status = 'enqueued';
    state.acknowledged = false;
  } else {
    exactKeys(payload, ['reason'], 'persisted transition payload');
    const reason = boundedReason(payload.reason);
    if (
      state.version === 0 ||
      state.acknowledged ||
      row.sender_id !== state.sender_id ||
      row.recipient_id !== state.recipient_id ||
      row.idempotency_key !== state.idempotency_key
    ) {
      throw new AgentMessageTransportError('message transition identity is invalid', 'AGENT_MESSAGE_STREAM_INVALID');
    }
    const status = Object.entries(STATUS_EVENTS).find(([, eventType]) => eventType === row.event_type)?.[0];
    if (!status) throw new AgentMessageTransportError('message transition is invalid', 'AGENT_MESSAGE_STREAM_INVALID');
    const expectedReason = {
      delivered: 'inbound_accept',
      held: 'inbound_hold',
      refused: 'inbound_refuse',
      expired: 'ttl_elapsed',
      acknowledged: 'recipient_ack',
    }[status];
    const atOrAfterExpiry = Date.parse(occurredAt) >= Date.parse(state.expires_at);
    if (reason !== expectedReason || (status === 'expired' ? !atOrAfterExpiry : atOrAfterExpiry)) {
      throw new AgentMessageTransportError('message transition time or reason is invalid', 'AGENT_MESSAGE_STREAM_INVALID');
    }
    if (status === 'acknowledged') {
      if (state.status !== 'delivered')
        throw new AgentMessageTransportError('only delivered messages can be acknowledged', 'AGENT_MESSAGE_STREAM_INVALID');
      state.acknowledged = true;
    } else {
      const allowed = {
        enqueued: ['delivered', 'held', 'refused'],
        held: ['delivered', 'refused', 'expired'],
        delivered: ['expired'],
        refused: [],
        expired: [],
      }[state.status];
      if (!allowed?.includes(status))
        throw new AgentMessageTransportError('message status transition is invalid', 'AGENT_MESSAGE_STREAM_INVALID');
      state.status = status;
    }
    state.reason = reason;
  }
  state.version = row.sequence;
  state.last_occurred_at = occurredAt;
  return state;
}

function assertDedicatedFixture(db, fixtureRootValue) {
  if (typeof fixtureRootValue !== 'string' || !path.isAbsolute(fixtureRootValue)) {
    throw new AgentMessageTransportError('fixture_root must be an absolute temporary directory', 'AGENT_MESSAGE_STORE_SCOPE_INVALID');
  }
  try {
    const suppliedRootStat = fs.lstatSync(fixtureRootValue);
    const suppliedDatabaseStat = fs.lstatSync(db.name);
    const root = fs.realpathSync(fixtureRootValue);
    const database = fs.realpathSync(db.name);
    const rootStat = fs.lstatSync(root);
    const databaseStat = fs.lstatSync(database);
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    if (
      suppliedRootStat.isSymbolicLink() ||
      suppliedDatabaseStat.isSymbolicLink() ||
      (root !== temporaryRoot && !root.startsWith(`${temporaryRoot}${path.sep}`)) ||
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      (rootStat.mode & 0o077) !== 0 ||
      path.dirname(database) !== root ||
      !databaseStat.isFile() ||
      databaseStat.isSymbolicLink() ||
      databaseStat.nlink !== 1
    )
      throw new Error('unsafe fixture');
  } catch {
    throw new AgentMessageTransportError('message store is not a dedicated temporary fixture', 'AGENT_MESSAGE_STORE_SCOPE_INVALID');
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if (tables.some(({ name }) => !['agent_message_events', 'agent_message_subscriptions'].includes(name))) {
    throw new AgentMessageTransportError('message store shares an application database', 'AGENT_MESSAGE_STORE_SCOPE_INVALID');
  }
}

function assertStoreSchema(db) {
  const expectedColumns = [
    ['position', 'INTEGER', 0, 1],
    ['event_id', 'TEXT', 1, 0],
    ['message_id', 'TEXT', 1, 0],
    ['sequence', 'INTEGER', 1, 0],
    ['event_type', 'TEXT', 1, 0],
    ['occurred_at', 'TEXT', 1, 0],
    ['sender_id', 'TEXT', 1, 0],
    ['recipient_id', 'TEXT', 1, 0],
    ['idempotency_key', 'TEXT', 1, 0],
    ['payload_json', 'TEXT', 1, 0],
  ];
  const actualColumns = db
    .prepare("PRAGMA table_info('agent_message_events')")
    .all()
    .map(({ name, type, notnull, pk }) => [name, type, notnull, pk]);
  const indexes = new Map(
    db
      .prepare("PRAGMA index_list('agent_message_events')")
      .all()
      .map((row) => [row.name, row]),
  );
  const indexColumns = (name) =>
    db
      .prepare(`PRAGMA index_info('${name}')`)
      .all()
      .map((row) => row.name);
  const senderIndexSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='agent_message_sender_idempotency'")
    .get()?.sql;
  const triggers = new Map(
    db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('agent_message_events','agent_message_subscriptions')",
      )
      .all()
      .map((row) => [row.name, row.sql]),
  );
  const subscriptionColumns = db
    .prepare("PRAGMA table_info('agent_message_subscriptions')")
    .all()
    .map(({ name, type, notnull, pk }) => [name, type, notnull, pk]);
  const expectedSubscriptionColumns = [
    ['subscription_id', 'TEXT', 0, 1],
    ['requester_id', 'TEXT', 1, 0],
    ['agent_id', 'TEXT', 1, 0],
    ['created_at', 'TEXT', 1, 0],
  ];
  const valid =
    canonicalJson(actualColumns) === canonicalJson(expectedColumns) &&
    indexes.get('agent_message_stream_sequence')?.unique === 1 &&
    indexes.get('agent_message_stream_sequence')?.partial === 0 &&
    canonicalJson(indexColumns('agent_message_stream_sequence')) === canonicalJson(['message_id', 'sequence']) &&
    indexes.get('agent_message_sender_idempotency')?.unique === 1 &&
    indexes.get('agent_message_sender_idempotency')?.partial === 1 &&
    canonicalJson(indexColumns('agent_message_sender_idempotency')) === canonicalJson(['sender_id', 'idempotency_key']) &&
    /WHERE\s+event_type\s*=\s*'agent\.message\.enqueued'/iu.test(senderIndexSql || '') &&
    /BEFORE\s+UPDATE\s+ON\s+agent_message_events[\s\S]+RAISE\s*\(\s*ABORT/iu.test(triggers.get('agent_message_events_no_update') || '') &&
    /BEFORE\s+DELETE\s+ON\s+agent_message_events[\s\S]+RAISE\s*\(\s*ABORT/iu.test(triggers.get('agent_message_events_no_delete') || '') &&
    canonicalJson(subscriptionColumns) === canonicalJson(expectedSubscriptionColumns) &&
    /BEFORE\s+UPDATE\s+ON\s+agent_message_subscriptions[\s\S]+RAISE\s*\(\s*ABORT/iu.test(
      triggers.get('agent_message_subscriptions_no_update') || '',
    ) &&
    /BEFORE\s+DELETE\s+ON\s+agent_message_subscriptions[\s\S]+RAISE\s*\(\s*ABORT/iu.test(
      triggers.get('agent_message_subscriptions_no_delete') || '',
    );
  if (!valid) throw new AgentMessageTransportError('message store schema is not canonical', 'AGENT_MESSAGE_STORE_SCOPE_INVALID');
}

class SqliteAgentMessageStore {
  #db;
  #insert;

  constructor(db, { fixture_root } = {}) {
    if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function' || typeof db.name !== 'string') {
      throw new AgentMessageTransportError('a better-sqlite3 compatible database is required');
    }
    assertDedicatedFixture(db, fixture_root);
    this.#db = db;
    try {
      db.exec(`
      CREATE TABLE IF NOT EXISTS agent_message_events (
        position INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL,
        sequence INTEGER NOT NULL, event_type TEXT NOT NULL, occurred_at TEXT NOT NULL, sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, payload_json TEXT NOT NULL, UNIQUE(message_id, sequence)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS agent_message_stream_sequence ON agent_message_events(message_id, sequence);
      CREATE UNIQUE INDEX IF NOT EXISTS agent_message_sender_idempotency ON agent_message_events(sender_id, idempotency_key)
        WHERE event_type = 'agent.message.enqueued';
      CREATE TRIGGER IF NOT EXISTS agent_message_events_no_update BEFORE UPDATE ON agent_message_events
        BEGIN SELECT RAISE(ABORT, 'agent message events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS agent_message_events_no_delete BEFORE DELETE ON agent_message_events
        BEGIN SELECT RAISE(ABORT, 'agent message events are immutable'); END;
      CREATE TABLE IF NOT EXISTS agent_message_subscriptions (
        subscription_id TEXT PRIMARY KEY, requester_id TEXT NOT NULL, agent_id TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS agent_message_subscriptions_no_update BEFORE UPDATE ON agent_message_subscriptions
        BEGIN SELECT RAISE(ABORT, 'agent message subscriptions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS agent_message_subscriptions_no_delete BEFORE DELETE ON agent_message_subscriptions
        BEGIN SELECT RAISE(ABORT, 'agent message subscriptions are immutable'); END;
      `);
      assertStoreSchema(db);
    } catch (error) {
      if (error instanceof AgentMessageTransportError) throw error;
      throw new AgentMessageTransportError('message store schema is not canonical', 'AGENT_MESSAGE_STORE_SCOPE_INVALID');
    }
    this.#insert = db.prepare(`INSERT INTO agent_message_events
      (event_id,message_id,sequence,event_type,occurred_at,sender_id,recipient_id,idempotency_key,payload_json)
      VALUES (@event_id,@message_id,@sequence,@event_type,@occurred_at,@sender_id,@recipient_id,@idempotency_key,@payload_json)`);
  }

  #runImmediate(operation) {
    try {
      return this.#db.transaction(operation).immediate();
    } catch (error) {
      if (error instanceof AgentMessageTransportError) throw error;
      if (String(error?.code || '').startsWith('SQLITE_') || /transaction|constraint|locked|busy/i.test(error?.message || '')) {
        throw new AgentMessageTransportError('message store concurrency conflict', 'AGENT_MESSAGE_CONCURRENCY_CONFLICT');
      }
      throw error;
    }
  }

  #readUnsafe(messageIdValue) {
    const messageId = identifier(messageIdValue, 'message_id');
    const rows = this.#db
      .prepare(
        `SELECT position,event_id,message_id,sequence,event_type,occurred_at,sender_id,recipient_id,idempotency_key,payload_json
      FROM agent_message_events WHERE message_id = ? ORDER BY sequence`,
      )
      .all(messageId);
    if (rows.length === 0) return null;
    const state = { message_id: messageId, version: 0 };
    for (const row of rows) applyEvent(state, row);
    return deepFreeze(state);
  }

  read(messageIdValue) {
    return this.#readUnsafe(messageIdValue);
  }

  #statesUnsafe() {
    const ids = this.#db
      .prepare(
        `SELECT message_id, MIN(position) AS first_position FROM agent_message_events
      GROUP BY message_id ORDER BY first_position LIMIT ?`,
      )
      .all(MAX_MESSAGES + 1);
    if (ids.length > MAX_MESSAGES)
      throw new AgentMessageTransportError('message store exceeds its reconstruction bound', 'AGENT_MESSAGE_STORE_FULL');
    return ids.map(({ message_id }) => this.#readUnsafe(message_id));
  }

  states() {
    return this.#statesUnsafe();
  }

  claimSubscription({ subscriptionId, requesterId, agentId, createdAt }) {
    return this.#runImmediate(() => {
      this.#assertStoreTimeUnsafe(createdAt);
      const count = this.#db.prepare('SELECT COUNT(*) AS count FROM agent_message_subscriptions').get().count;
      if (count >= MAX_SUBSCRIPTIONS) return false;
      try {
        this.#db
          .prepare(
            `INSERT INTO agent_message_subscriptions(subscription_id,requester_id,agent_id,created_at)
            VALUES (?,?,?,?)`,
          )
          .run(subscriptionId, requesterId, agentId, createdAt);
        return true;
      } catch (error) {
        if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) return false;
        throw error;
      }
    });
  }

  #findByIdempotencyUnsafe(senderId, idempotencyKey) {
    const row = this.#db
      .prepare(
        "SELECT message_id FROM agent_message_events WHERE event_type = 'agent.message.enqueued' AND sender_id = ? AND idempotency_key = ?",
      )
      .get(senderId, idempotencyKey);
    return row ? this.#readUnsafe(row.message_id) : null;
  }

  #transitionUnsafe(state, status, reason, occurredAt) {
    this.#insert.run({
      event_id: randomUUID(),
      message_id: state.message_id,
      sequence: state.version + 1,
      event_type: STATUS_EVENTS[status],
      occurred_at: occurredAt,
      sender_id: state.sender_id,
      recipient_id: state.recipient_id,
      idempotency_key: state.idempotency_key,
      payload_json: canonicalJson({ reason: boundedReason(reason) }),
    });
    return this.#readUnsafe(state.message_id);
  }

  #assertStoreTimeUnsafe(now) {
    const latest = this.#db.prepare('SELECT occurred_at FROM agent_message_events ORDER BY position DESC LIMIT 1').get();
    if (latest && Date.parse(timestamp(latest.occurred_at, 'latest event time')) > Date.parse(now)) {
      throw new AgentMessageTransportError('message store clock regressed', 'AGENT_MESSAGE_CLOCK_REGRESSION');
    }
  }

  #expireUnsafe(now) {
    const nowMs = Date.parse(now);
    for (const state of this.#statesUnsafe()) {
      if (['held', 'delivered'].includes(state.status) && !state.acknowledged && Date.parse(state.expires_at) <= nowMs) {
        this.#transitionUnsafe(state, 'expired', 'ttl_elapsed', now);
      }
    }
  }

  expire(now) {
    return this.#runImmediate(() => {
      const occurredAt = timestamp(now, 'expiration time');
      this.#assertStoreTimeUnsafe(occurredAt);
      return this.#expireUnsafe(occurredAt);
    });
  }

  atomicSend({ message, now, maxInbox, rateLimit, rateWindowMs, decide }) {
    return this.#runImmediate(() => {
      this.#assertStoreTimeUnsafe(now);
      this.#expireUnsafe(now);
      const replay = this.#findByIdempotencyUnsafe(message.sender_id, message.idempotency_key);
      if (replay) {
        const original = {
          schema_version: replay.schema_version,
          message_id: replay.message_id,
          sender_id: replay.sender_id,
          recipient_id: replay.recipient_id,
          idempotency_key: replay.idempotency_key,
          text: replay.text,
          ttl_ms: replay.ttl_ms,
        };
        if (canonicalJson(original) !== canonicalJson(message))
          throw new AgentMessageTransportError('idempotency key conflicts with another message', 'AGENT_MESSAGE_DEDUP_CONFLICT');
        return deepFreeze({ ...replay, replayed: true });
      }
      const enforceBounds = () => {
        const states = this.#statesUnsafe();
        if (states.length >= MAX_MESSAGES) throw new AgentMessageTransportError('message store is full', 'AGENT_MESSAGE_STORE_FULL');
        const cutoff = Date.parse(now) - rateWindowMs;
        if (states.filter((state) => state.sender_id === message.sender_id && Date.parse(state.created_at) >= cutoff).length >= rateLimit) {
          throw new AgentMessageTransportError('sender rate limit exceeded', 'AGENT_MESSAGE_RATE_LIMITED');
        }
        if (
          states.filter(
            (state) => state.recipient_id === message.recipient_id && ['held', 'delivered'].includes(state.status) && !state.acknowledged,
          ).length >= maxInbox
        ) {
          throw new AgentMessageTransportError('recipient inbox is full', 'AGENT_MESSAGE_INBOX_FULL');
        }
      };
      enforceBounds();
      const decision = decide();
      if (!['accept', 'hold', 'refuse'].includes(decision))
        throw new AgentMessageTransportError('inbound policy returned an invalid decision');
      if (this.#findByIdempotencyUnsafe(message.sender_id, message.idempotency_key))
        throw new AgentMessageTransportError('message changed during policy evaluation', 'AGENT_MESSAGE_CONCURRENCY_CONFLICT');
      enforceBounds();
      const common = {
        message_id: message.message_id,
        occurred_at: now,
        sender_id: message.sender_id,
        recipient_id: message.recipient_id,
        idempotency_key: message.idempotency_key,
      };
      const expiresAt = addMilliseconds(now, message.ttl_ms);
      this.#insert.run({
        ...common,
        event_id: randomUUID(),
        sequence: 1,
        event_type: 'agent.message.enqueued',
        payload_json: canonicalJson({ ...message, created_at: now, expires_at: expiresAt }),
      });
      this.#insert.run({
        ...common,
        event_id: randomUUID(),
        sequence: 2,
        event_type: STATUS_EVENTS[{ accept: 'delivered', hold: 'held', refuse: 'refused' }[decision]],
        payload_json: canonicalJson({ reason: `inbound_${decision}` }),
      });
      return deepFreeze({ ...this.#readUnsafe(message.message_id), replayed: false });
    });
  }

  acknowledgeAtomic({ messageId, recipientId, now }) {
    const outcome = this.#runImmediate(() => {
      this.#assertStoreTimeUnsafe(now);
      this.#expireUnsafe(now);
      const state = this.#readUnsafe(messageId);
      if (
        !state ||
        state.recipient_id !== recipientId ||
        state.status !== 'delivered' ||
        state.acknowledged ||
        Date.parse(state.expires_at) <= Date.parse(now)
      ) {
        return null;
      }
      return this.#transitionUnsafe(state, 'acknowledged', 'recipient_ack', now);
    });
    if (!outcome) throw new AgentMessageTransportError('message cannot be acknowledged', 'AGENT_MESSAGE_ACK_INVALID');
    return outcome;
  }

  flushHeldAtomic({ recipientId, now, decide }) {
    return this.#runImmediate(() => {
      this.#assertStoreTimeUnsafe(now);
      this.#expireUnsafe(now);
      const outcomes = [];
      for (const state of this.#statesUnsafe().filter((item) => item.recipient_id === recipientId && item.status === 'held')) {
        const decision = decide(state);
        if (!['accept', 'hold', 'refuse'].includes(decision))
          throw new AgentMessageTransportError('inbound policy returned an invalid decision');
        outcomes.push(
          decision === 'hold'
            ? state
            : this.#transitionUnsafe(state, decision === 'accept' ? 'delivered' : 'refused', `inbound_${decision}`, now),
        );
      }
      return deepFreeze(outcomes);
    });
  }
}

class LocalAgentMessageRelay {
  #idle = new Set();
  #waiters = new Map();
  #sending = false;
  #lastNowMs = Number.NEGATIVE_INFINITY;
  #store;
  #principalId;
  #presenceControl;
  #inboundPolicy;
  #presencePolicy;
  #clock;
  #maxInbox;
  #rateLimit;
  #rateWindowMs;

  constructor({
    store,
    principal_id,
    presence_control,
    inbound_policy,
    presence_policy,
    clock = () => new Date().toISOString(),
    max_inbox = 128,
    rate_limit = 64,
    rate_window_ms = 60_000,
  }) {
    if (!(store instanceof SqliteAgentMessageStore)) throw new AgentMessageTransportError('local relay requires the nominal SQLite store');
    const principalId = identifier(principal_id, 'principal_id');
    if (!presence_control || typeof presence_control !== 'object') {
      throw new AgentMessageTransportError('an opaque presence control capability is required');
    }
    if (typeof inbound_policy !== 'function' || typeof presence_policy !== 'function' || typeof clock !== 'function') {
      throw new AgentMessageTransportError('relay inbound, presence, and clock policies are required');
    }
    for (const [label, value] of Object.entries({ max_inbox, rate_limit, rate_window_ms })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new AgentMessageTransportError(`${label} is invalid`);
    }
    Object.defineProperty(this, 'transport', { value: 'local', enumerable: true });
    this.#store = store;
    this.#principalId = principalId;
    this.#presenceControl = presence_control;
    this.#inboundPolicy = inbound_policy;
    this.#presencePolicy = presence_policy;
    this.#clock = clock;
    this.#maxInbox = max_inbox;
    this.#rateLimit = rate_limit;
    this.#rateWindowMs = rate_window_ms;
    RELAYS.add(this);
    Object.freeze(this);
  }

  #now() {
    const value = timestamp(this.#clock(), 'relay clock');
    const milliseconds = Date.parse(value);
    if (milliseconds < this.#lastNowMs) throw new AgentMessageTransportError('relay clock regressed', 'AGENT_MESSAGE_CLOCK_REGRESSION');
    this.#lastNowMs = milliseconds;
    return value;
  }

  send(value) {
    if (this.#sending) throw new AgentMessageTransportError('reentrant send is forbidden', 'AGENT_MESSAGE_CONCURRENCY_CONFLICT');
    const message = parseSend(value);
    if (message.sender_id !== this.#principalId) {
      throw new AgentMessageTransportError('sender claim is not bound to this relay principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    }
    const now = this.#now();
    this.#sending = true;
    try {
      return this.#store.atomicSend({
        message,
        now,
        maxInbox: this.#maxInbox,
        rateLimit: this.#rateLimit,
        rateWindowMs: this.#rateWindowMs,
        decide: () =>
          this.#inboundPolicy(deepFreeze({ sender_id: message.sender_id, recipient_id: message.recipient_id, text: message.text })),
      });
    } finally {
      this.#sending = false;
    }
  }

  receive(value) {
    exactKeys(value, ['schema_version', 'recipient_id', 'limit'], 'receive request');
    if (value.schema_version !== SCHEMA_VERSION) throw new AgentMessageTransportError('receive schema version is unsupported');
    const recipientId = identifier(value.recipient_id, 'recipient_id');
    if (recipientId !== this.#principalId) {
      throw new AgentMessageTransportError('recipient claim is not bound to this relay principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    }
    if (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 128)
      throw new AgentMessageTransportError('receive limit is invalid');
    this.#store.expire(this.#now());
    return deepFreeze(
      this.#store
        .states()
        .filter((state) => state.recipient_id === recipientId && state.status === 'delivered' && !state.acknowledged)
        .slice(0, value.limit),
    );
  }

  acknowledge(value) {
    exactKeys(value, ['schema_version', 'recipient_id', 'message_id'], 'ack request');
    if (value.schema_version !== SCHEMA_VERSION) throw new AgentMessageTransportError('ack schema version is unsupported');
    const recipientId = identifier(value.recipient_id, 'recipient_id');
    if (recipientId !== this.#principalId) {
      throw new AgentMessageTransportError('recipient claim is not bound to this relay principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    }
    return this.#store.acknowledgeAtomic({
      messageId: identifier(value.message_id, 'message_id'),
      recipientId,
      now: this.#now(),
    });
  }

  flushHeld(value) {
    exactKeys(value, ['schema_version', 'recipient_id'], 'flush request');
    if (value.schema_version !== SCHEMA_VERSION) throw new AgentMessageTransportError('flush schema version is unsupported');
    const recipientId = identifier(value.recipient_id, 'recipient_id');
    if (recipientId !== this.#principalId) {
      throw new AgentMessageTransportError('recipient claim is not bound to this relay principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    }
    return this.#store.flushHeldAtomic({
      recipientId,
      now: this.#now(),
      decide: (state) =>
        this.#inboundPolicy(deepFreeze({ sender_id: state.sender_id, recipient_id: state.recipient_id, text: state.text })),
    });
  }

  setIdle(value) {
    exactKeys(value, ['schema_version', 'agent_id', 'idle', 'control'], 'presence update');
    if (value.schema_version !== SCHEMA_VERSION) throw new AgentMessageTransportError('presence schema version is unsupported');
    const agentId = identifier(value.agent_id, 'agent_id');
    if (value.control !== this.#presenceControl) {
      throw new AgentMessageTransportError('presence control capability is invalid', 'AGENT_MESSAGE_PRESENCE_DENIED');
    }
    if (typeof value.idle !== 'boolean') throw new AgentMessageTransportError('idle state must be boolean');
    if (value.idle) this.#idle.add(agentId);
    else this.#idle.delete(agentId);
    if (value.idle) {
      for (const [key, waiter] of this.#waiters) {
        if (waiter.agent_id === agentId) {
          this.#waiters.delete(key);
          clearTimeout(waiter.timer);
          waiter.resolve(deepFreeze({ agent_id: agentId, subscription_id: waiter.subscription_id, idle: true }));
        }
      }
    }
  }

  notifyWhenIdle(value) {
    exactKeys(value, ['schema_version', 'requester_id', 'agent_id', 'subscription_id', 'timeout_ms'], 'idle notification request');
    if (value.schema_version !== SCHEMA_VERSION) throw new AgentMessageTransportError('idle notification schema version is unsupported');
    const requesterId = identifier(value.requester_id, 'requester_id');
    if (requesterId !== this.#principalId) {
      throw new AgentMessageTransportError('requester claim is not bound to this relay principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    }
    const agentId = identifier(value.agent_id, 'agent_id');
    const subscriptionId = identifier(value.subscription_id, 'subscription_id');
    if (!Number.isSafeInteger(value.timeout_ms) || value.timeout_ms < 1 || value.timeout_ms > 300_000)
      throw new AgentMessageTransportError('idle timeout is invalid');
    if (this.#presencePolicy(deepFreeze({ requester_id: requesterId, agent_id: agentId })) !== true) {
      throw new AgentMessageTransportError('presence subscription is unauthorized', 'AGENT_MESSAGE_PRESENCE_DENIED');
    }
    if (this.#waiters.size >= 1024 || !this.#store.claimSubscription({ subscriptionId, requesterId, agentId, createdAt: this.#now() })) {
      throw new AgentMessageTransportError('idle subscription is duplicate or full', 'AGENT_MESSAGE_SUBSCRIPTION_INVALID');
    }
    if (this.#idle.has(agentId)) return Promise.resolve(deepFreeze({ agent_id: agentId, subscription_id: subscriptionId, idle: true }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(subscriptionId);
        reject(new AgentMessageTransportError('idle notification expired', 'AGENT_MESSAGE_IDLE_TIMEOUT'));
      }, value.timeout_ms);
      timer.unref?.();
      this.#waiters.set(subscriptionId, { agent_id: agentId, subscription_id: subscriptionId, resolve, timer });
    });
  }
}

function validateMessageState(value, { replayed = false } = {}) {
  const keys = [
    'message_id',
    'version',
    'schema_version',
    'sender_id',
    'recipient_id',
    'idempotency_key',
    'text',
    'ttl_ms',
    'created_at',
    'expires_at',
    'status',
    'acknowledged',
    'reason',
    'last_occurred_at',
  ];
  if (replayed) keys.push('replayed');
  exactKeys(value, keys, 'relay message result');
  const message = parseSend({
    schema_version: value.schema_version,
    message_id: value.message_id,
    sender_id: value.sender_id,
    recipient_id: value.recipient_id,
    idempotency_key: value.idempotency_key,
    text: value.text,
    ttl_ms: value.ttl_ms,
  });
  const createdAt = timestamp(value.created_at, 'result created_at');
  const expiresAt = timestamp(value.expires_at, 'result expires_at');
  const occurredAt = timestamp(value.last_occurred_at, 'result last_occurred_at');
  const statuses = ['delivered', 'held', 'refused', 'expired'];
  if (
    !Number.isSafeInteger(value.version) ||
    value.version < 2 ||
    value.version > 4 ||
    !statuses.includes(value.status) ||
    typeof value.acknowledged !== 'boolean' ||
    (replayed && typeof value.replayed !== 'boolean') ||
    Date.parse(expiresAt) !== Date.parse(createdAt) + message.ttl_ms ||
    (value.acknowledged && value.status !== 'delivered')
  ) {
    throw new AgentMessageTransportError('relay message result violates its state contract', 'AGENT_MESSAGE_ADAPTER_INVALID');
  }
  const expectedReason = value.acknowledged
    ? 'recipient_ack'
    : {
        delivered: 'inbound_accept',
        held: 'inbound_hold',
        refused: 'inbound_refuse',
        expired: 'ttl_elapsed',
      }[value.status];
  const atOrAfterExpiry = Date.parse(occurredAt) >= Date.parse(expiresAt);
  if (value.reason !== expectedReason || (value.status === 'expired' ? !atOrAfterExpiry : atOrAfterExpiry)) {
    throw new AgentMessageTransportError('relay message result has invalid transition evidence', 'AGENT_MESSAGE_ADAPTER_INVALID');
  }
  return deepFreeze({ ...value });
}

function invokeAdapter(method, request, validate) {
  try {
    const result = method(request);
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result)
        .then(validate)
        .catch((error) => {
          if (error instanceof AgentMessageTransportError) throw error;
          throw new AgentMessageTransportError('relay adapter failed', 'AGENT_MESSAGE_ADAPTER_FAILURE');
        });
    }
    return validate(result);
  } catch (error) {
    if (error instanceof AgentMessageTransportError) throw error;
    throw new AgentMessageTransportError('relay adapter failed', 'AGENT_MESSAGE_ADAPTER_FAILURE');
  }
}

function createAgentMessageRelayAdapter(value) {
  exactKeys(value, ['transport', 'principal_id', 'send', 'receive', 'acknowledge', 'flushHeld', 'notifyWhenIdle'], 'relay adapter');
  if (!['mcp', 'http', 'remote'].includes(value.transport)) throw new AgentMessageTransportError('relay transport is unsupported');
  const principalId = identifier(value.principal_id, 'principal_id');
  for (const method of ['send', 'receive', 'acknowledge', 'flushHeld', 'notifyWhenIdle']) {
    if (typeof value[method] !== 'function') throw new AgentMessageTransportError(`relay ${method} port is invalid`);
  }
  const methods = Object.freeze({
    send: value.send.bind(value),
    receive: value.receive.bind(value),
    acknowledge: value.acknowledge.bind(value),
    flushHeld: value.flushHeld.bind(value),
    notifyWhenIdle: value.notifyWhenIdle.bind(value),
  });
  const relay = { transport: value.transport };
  relay.send = (request) => {
    const parsed = parseSend(request);
    if (parsed.sender_id !== principalId)
      throw new AgentMessageTransportError('sender claim is not bound to adapter principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    return invokeAdapter(methods.send, parsed, (result) => {
      const state = validateMessageState(result, { replayed: true });
      const immutableResult = {
        schema_version: state.schema_version,
        message_id: state.message_id,
        sender_id: state.sender_id,
        recipient_id: state.recipient_id,
        idempotency_key: state.idempotency_key,
        text: state.text,
        ttl_ms: state.ttl_ms,
      };
      if (canonicalJson(immutableResult) !== canonicalJson(parsed)) {
        throw new AgentMessageTransportError('relay send result is not bound to its request', 'AGENT_MESSAGE_ADAPTER_INVALID');
      }
      return state;
    });
  };
  relay.receive = (request) => {
    exactKeys(request, ['schema_version', 'recipient_id', 'limit'], 'receive request');
    if (
      request.schema_version !== SCHEMA_VERSION ||
      identifier(request.recipient_id, 'recipient_id') !== principalId ||
      !Number.isSafeInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 128
    ) {
      throw new AgentMessageTransportError('receive request is not bound to adapter principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    }
    return invokeAdapter(methods.receive, deepFreeze({ ...request }), (result) => {
      if (!Array.isArray(result) || result.length > request.limit)
        throw new AgentMessageTransportError('relay receive result is invalid', 'AGENT_MESSAGE_ADAPTER_INVALID');
      const states = result.map((state) => validateMessageState(state));
      if (states.some((state) => state.recipient_id !== principalId || state.status !== 'delivered' || state.acknowledged)) {
        throw new AgentMessageTransportError(
          'relay receive result crosses its principal or state boundary',
          'AGENT_MESSAGE_ADAPTER_INVALID',
        );
      }
      return deepFreeze(states);
    });
  };
  relay.acknowledge = (request) => {
    exactKeys(request, ['schema_version', 'recipient_id', 'message_id'], 'ack request');
    if (request.schema_version !== SCHEMA_VERSION || identifier(request.recipient_id, 'recipient_id') !== principalId) {
      throw new AgentMessageTransportError('ack request is not bound to adapter principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    }
    identifier(request.message_id, 'message_id');
    return invokeAdapter(methods.acknowledge, deepFreeze({ ...request }), (result) => {
      const state = validateMessageState(result);
      if (state.recipient_id !== principalId || state.message_id !== request.message_id || !state.acknowledged) {
        throw new AgentMessageTransportError('relay ack result is invalid', 'AGENT_MESSAGE_ADAPTER_INVALID');
      }
      return state;
    });
  };
  relay.flushHeld = (request) => {
    exactKeys(request, ['schema_version', 'recipient_id'], 'flush request');
    if (request.schema_version !== SCHEMA_VERSION || identifier(request.recipient_id, 'recipient_id') !== principalId) {
      throw new AgentMessageTransportError('flush request is not bound to adapter principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    }
    return invokeAdapter(methods.flushHeld, deepFreeze({ ...request }), (result) => {
      if (!Array.isArray(result) || result.length > 128)
        throw new AgentMessageTransportError('relay flush result is invalid', 'AGENT_MESSAGE_ADAPTER_INVALID');
      const states = result.map((state) => validateMessageState(state));
      if (states.some((state) => state.recipient_id !== principalId || !['held', 'delivered', 'refused'].includes(state.status))) {
        throw new AgentMessageTransportError('relay flush result crosses its principal boundary', 'AGENT_MESSAGE_ADAPTER_INVALID');
      }
      return deepFreeze(states);
    });
  };
  relay.notifyWhenIdle = (request) => {
    exactKeys(request, ['schema_version', 'requester_id', 'agent_id', 'subscription_id', 'timeout_ms'], 'idle notification request');
    if (request.schema_version !== SCHEMA_VERSION || identifier(request.requester_id, 'requester_id') !== principalId) {
      throw new AgentMessageTransportError('presence request is not bound to adapter principal', 'AGENT_MESSAGE_PRINCIPAL_MISMATCH');
    }
    identifier(request.agent_id, 'agent_id');
    identifier(request.subscription_id, 'subscription_id');
    if (!Number.isSafeInteger(request.timeout_ms) || request.timeout_ms < 1 || request.timeout_ms > 300_000) {
      throw new AgentMessageTransportError('idle timeout is invalid');
    }
    return invokeAdapter(methods.notifyWhenIdle, deepFreeze({ ...request }), (result) => {
      exactKeys(result, ['agent_id', 'subscription_id', 'idle'], 'idle notification result');
      if (result.agent_id !== request.agent_id || result.subscription_id !== request.subscription_id || result.idle !== true) {
        throw new AgentMessageTransportError('idle notification result is invalid', 'AGENT_MESSAGE_ADAPTER_INVALID');
      }
      return deepFreeze({ ...result });
    });
  };
  Object.freeze(relay);
  RELAYS.add(relay);
  return relay;
}

function assertAgentMessageRelay(value) {
  if (!value || !RELAYS.has(value)) throw new AgentMessageTransportError('relay port is not nominally registered');
  return value;
}

module.exports = {
  AgentMessageTransportError,
  LocalAgentMessageRelay,
  MAX_TEXT_BYTES,
  SCHEMA_VERSION,
  SqliteAgentMessageStore,
  assertAgentMessageRelay,
  createAgentMessageRelayAdapter,
};
