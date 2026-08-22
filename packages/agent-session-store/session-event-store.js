'use strict';

const { createHash } = require('node:crypto');
const { AgentSessionSpecSchema, IdentifierSchema, SessionEventSchema, deepFreeze, parseContract } = require('../agent-runtime-contracts');
const { buildRecoveryPlan, reconstructModelRequest, replaySessionEvents } = require('./replay');

const AGGREGATE_TYPE = 'agent_session';
const LEDGER_EVENT_TYPE = 'AgentSessionEventRecorded';
const RELATIONAL_SESSION_STORES = new WeakSet();
const SENSITIVE_KEYS = new Set([
  'access_token',
  'api_key',
  'approval_token',
  'auth',
  'authentication',
  'authorization',
  'client_secret',
  'cookie',
  'credential',
  'credentials',
  'password',
  'private_key',
  'refresh_token',
  'secret',
  'session_cookie',
  'set_cookie',
  'token',
]);
const SENSITIVE_KEY_SUFFIX = /(?:^|_)(?:credential|credentials|password|secret|token)$/;

class SessionEventStoreError extends Error {
  constructor(message, code = 'AGENT_SESSION_STORE_INVALID', details = {}) {
    super(message);
    this.name = 'SessionEventStoreError';
    this.code = code;
    this.details = details;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function ledgerEventId(sessionId, eventId) {
  const hex = createHash('sha256').update(`${sessionId}\0${eventId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function canonicalTimestamp(timestamp) {
  return new Date(timestamp).toISOString();
}

function normalizeKey(key) {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/[^a-zA-Z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .toLowerCase();
}

function assertNoSensitiveFields(value, path = 'event') {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoSensitiveFields(item, `${path}[${index}]`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (SENSITIVE_KEYS.has(normalizedKey) || SENSITIVE_KEY_SUFFIX.test(normalizedKey)) {
      throw new SessionEventStoreError('credential-bearing fields are forbidden in session events', 'AGENT_SESSION_SECRET_FORBIDDEN', {
        path: `${path}.${key}`,
      });
    }
    assertNoSensitiveFields(nested, `${path}.${key}`);
  }
}

function assertStrictJson(value, path, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SessionEventStoreError(`${path} contains a non-finite number`, 'AGENT_SESSION_ACTOR_INVALID');
    return;
  }
  if (typeof value !== 'object') {
    throw new SessionEventStoreError(`${path} contains a non-JSON value`, 'AGENT_SESSION_ACTOR_INVALID');
  }
  if (ancestors.has(value)) throw new SessionEventStoreError(`${path} contains a cycle`, 'AGENT_SESSION_ACTOR_INVALID');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new SessionEventStoreError(`${path} must contain only plain objects`, 'AGENT_SESSION_ACTOR_INVALID');
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new SessionEventStoreError(`${path} contains a sparse array`, 'AGENT_SESSION_ACTOR_INVALID');
      assertStrictJson(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    for (const [key, nested] of Object.entries(value)) assertStrictJson(nested, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function cloneActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    throw new SessionEventStoreError('actor must be a plain JSON object', 'AGENT_SESSION_ACTOR_INVALID');
  }
  assertStrictJson(actor, 'actor');
  return deepFreeze(JSON.parse(JSON.stringify(actor)));
}

function hydrateSessionEvent(row) {
  if (row.aggregate_type !== AGGREGATE_TYPE || row.event_type !== LEDGER_EVENT_TYPE) {
    throw new SessionEventStoreError('ledger row is not an agent-session envelope', 'AGENT_SESSION_ENVELOPE_INVALID');
  }
  if (!row.payload || typeof row.payload.session_event_json !== 'string') {
    throw new SessionEventStoreError('session envelope payload is missing', 'AGENT_SESSION_ENVELOPE_INVALID');
  }
  let decoded;
  try {
    decoded = JSON.parse(row.payload.session_event_json);
  } catch (error) {
    throw new SessionEventStoreError('session envelope contains invalid JSON', 'AGENT_SESSION_ENVELOPE_INVALID', {
      cause: error.message,
    });
  }
  const event = parseContract(SessionEventSchema, decoded, 'persisted session event');
  assertNoSensitiveFields(event);
  if (
    event.session_id !== row.aggregate_id ||
    event.sequence !== row.stream_sequence ||
    row.event_id !== ledgerEventId(event.session_id, event.event_id)
  ) {
    throw new SessionEventStoreError('session envelope identity does not match the ledger row', 'AGENT_SESSION_ENVELOPE_MISMATCH');
  }
  if (row.operation_id !== (event.event_type === 'tool.operation_linked' ? event.payload.operation_id : null)) {
    throw new SessionEventStoreError('session operation reference does not match the ledger row', 'AGENT_SESSION_OPERATION_MISMATCH');
  }
  return event;
}

class RelationalSessionEventStore {
  constructor({ ledger, actor = { type: 'hseos', id: 'agent-kernel' } }) {
    if (
      !ledger ||
      typeof ledger.append !== 'function' ||
      typeof ledger.appendBatch !== 'function' ||
      typeof ledger.readStream !== 'function' ||
      typeof ledger.readGlobal !== 'function'
    ) {
      throw new SessionEventStoreError('a relational ledger port with append/appendBatch/readStream/readGlobal is required');
    }
    const parsedActor = cloneActor(actor);
    Object.defineProperties(this, {
      ledger: { value: ledger, enumerable: true },
      actor: { value: parsedActor, enumerable: true },
    });
    RELATIONAL_SESSION_STORES.add(this);
    Object.freeze(this);
  }

  _prepareAppend({ session_id, expected_version, events, correlation_id = session_id, causation_id = null, actor = this.actor }) {
    const parsedSessionId = parseContract(IdentifierSchema, session_id, 'session id');
    if (!Number.isInteger(expected_version) || expected_version < 0) {
      throw new SessionEventStoreError('expected_version must be a non-negative integer');
    }
    if (!Array.isArray(events) || events.length === 0) {
      throw new SessionEventStoreError('events must be a non-empty array');
    }
    const parsedActor = cloneActor(actor);
    const parsedEvents = events.map((event) => parseContract(SessionEventSchema, event, 'session event'));
    for (const [index, event] of parsedEvents.entries()) {
      assertNoSensitiveFields(event);
      if (event.session_id !== parsedSessionId) throw new SessionEventStoreError('event belongs to a different session');
      if (event.sequence !== expected_version + index + 1) {
        throw new SessionEventStoreError('event sequence does not continue expected_version', 'AGENT_SESSION_SEQUENCE_INVALID');
      }
    }
    const eventIds = new Set(parsedEvents.map((event) => event.event_id));
    if (eventIds.size !== parsedEvents.length) throw new SessionEventStoreError('event identifiers must be unique within an append');

    const currentEvents = this.readSession(parsedSessionId);
    if (currentEvents.length === expected_version) {
      replaySessionEvents([...currentEvents, ...parsedEvents]);
    } else if (
      currentEvents.length > expected_version &&
      stableJson(currentEvents.slice(expected_version, expected_version + parsedEvents.length)) === stableJson(parsedEvents)
    ) {
      // Exact retries are delegated to the relational ledger's idempotency check.
    } else {
      throw new SessionEventStoreError('expected_version does not match the durable session stream', 'AGENT_SESSION_VERSION_CONFLICT', {
        expected_version,
        current_version: currentEvents.length,
      });
    }
    return {
      aggregate_type: AGGREGATE_TYPE,
      aggregate_id: parsedSessionId,
      expected_version,
      events: parsedEvents.map((event) => ({
        event_id: ledgerEventId(parsedSessionId, event.event_id),
        event_type: LEDGER_EVENT_TYPE,
        schema_version: 1,
        occurred_at: canonicalTimestamp(event.occurred_at),
        correlation_id,
        causation_id: causation_id || event.event_id,
        actor: parsedActor,
        operation_id: event.event_type === 'tool.operation_linked' ? event.payload.operation_id : null,
        payload: { session_event_json: stableJson(event) },
        evidence_refs: [],
      })),
    };
  }

  _formatResult(result) {
    return deepFreeze({
      current_version: result.current_version,
      idempotent: result.idempotent,
      events: result.events.map(hydrateSessionEvent),
      positions: result.events.map((event) => event.position),
    });
  }

  append(request) {
    return this._formatResult(this.ledger.append(this._prepareAppend(request)));
  }

  readSession(sessionId, options) {
    const parsedSessionId = parseContract(IdentifierSchema, sessionId, 'session id');
    return deepFreeze(this.ledger.readStream(AGGREGATE_TYPE, parsedSessionId, options).map(hydrateSessionEvent));
  }

  readGlobal({ after_position = 0, limit = 100 } = {}) {
    return deepFreeze(
      this.ledger
        .readGlobal({ after_position, limit, aggregate_type: AGGREGATE_TYPE })
        .filter((row) => row.aggregate_type === AGGREGATE_TYPE)
        .map((row) => ({ position: row.position, event: hydrateSessionEvent(row) })),
    );
  }

  replay(sessionId, { to_version = Number.MAX_SAFE_INTEGER } = {}) {
    return replaySessionEvents(this.readSession(sessionId, { from_version: 1, to_version }));
  }

  reconstructRequest(sessionId, options) {
    return reconstructModelRequest(this.readSession(sessionId), options);
  }

  recoveryPlan(sessionId) {
    return buildRecoveryPlan(this.readSession(sessionId));
  }

  forkSession({ parent_session_id, parent_sequence, child_spec, child_request = null, event_ids, occurred_at, correlation_id, actor = this.actor }) {
    const sourceEvents = this.readSession(parent_session_id, { from_version: 1, to_version: parent_sequence });
    const sourceState = replaySessionEvents(sourceEvents);
    if (sourceState.current_sequence !== parent_sequence) {
      throw new SessionEventStoreError('fork source sequence does not exist', 'AGENT_SESSION_FORK_SOURCE_NOT_FOUND');
    }
    const currentParentEvents = this.readSession(parent_session_id);
    const parentState = replaySessionEvents(currentParentEvents);
    const spec = parseContract(AgentSessionSpecSchema, child_spec, 'child session spec');
    if (spec.parent_session_id !== parent_session_id) {
      throw new SessionEventStoreError('child session spec must name the fork parent', 'AGENT_SESSION_FORK_PARENT_MISMATCH');
    }
    if (spec.authority_ref !== parentState.spec.authority_ref || spec.policy_ref !== parentState.spec.policy_ref) {
      throw new SessionEventStoreError('fork cannot alter authority or policy', 'AGENT_SESSION_FORK_AUTHORITY_WIDENING');
    }
    for (const [limit, value] of Object.entries(spec.limits)) {
      if (value > parentState.spec.limits[limit]) {
        throw new SessionEventStoreError('fork resource limits cannot exceed the parent', 'AGENT_SESSION_FORK_LIMIT_WIDENING', {
          limit,
        });
      }
    }
    if (
      !event_ids ||
      typeof event_ids.attached !== 'string' ||
      typeof event_ids.created !== 'string' ||
      typeof event_ids.forked !== 'string' ||
      (child_request && typeof event_ids.requested !== 'string')
    ) {
      throw new SessionEventStoreError('fork requires explicit attached, created, forked and optional request event identifiers');
    }
    const existingAttachment = currentParentEvents.find(
      (event) => event.event_type === 'child.attached' && event.payload.child_session_id === spec.session_id,
    );
    if (existingAttachment && existingAttachment.event_id !== event_ids.attached) {
      throw new SessionEventStoreError('child session is already attached with a different event', 'AGENT_SESSION_CHILD_ID_CONFLICT');
    }
    if (!existingAttachment && parentState.children.length >= parentState.spec.limits.max_children) {
      throw new SessionEventStoreError('parent session child limit is exhausted', 'AGENT_SESSION_CHILD_LIMIT_EXCEEDED');
    }
    const attachmentSequence = existingAttachment ? existingAttachment.sequence : currentParentEvents.length + 1;
    const parentRequest = this._prepareAppend({
      session_id: parent_session_id,
      expected_version: attachmentSequence - 1,
      correlation_id: correlation_id || parent_session_id,
      causation_id: event_ids.attached,
      actor,
      events: [
        {
          schema_version: 1,
          event_id: event_ids.attached,
          session_id: parent_session_id,
          sequence: attachmentSequence,
          occurred_at,
          event_type: 'child.attached',
          payload: { child_session_id: spec.session_id, authority_ceiling_ref: spec.authority_ref },
        },
      ],
    });
    const childEvents = [
      {
        schema_version: 1,
        event_id: event_ids.created,
        session_id: spec.session_id,
        sequence: 1,
        occurred_at,
        event_type: 'session.created',
        payload: { spec },
      },
      {
        schema_version: 1,
        event_id: event_ids.forked,
        session_id: spec.session_id,
        sequence: 2,
        occurred_at,
        event_type: 'session.forked',
        payload: { parent_session_id, parent_sequence },
      },
    ];
    if (child_request) {
      childEvents.push({
        schema_version: 1,
        event_id: event_ids.requested,
        session_id: spec.session_id,
        sequence: 3,
        occurred_at,
        event_type: 'subagent.requested',
        payload: child_request,
      });
    }
    const childRequest = this._prepareAppend({
      session_id: spec.session_id,
      expected_version: 0,
      correlation_id: correlation_id || parent_session_id,
      causation_id: event_ids.created,
      actor,
      events: childEvents,
    });
    const [parentResult, childResult] = this.ledger.appendBatch([parentRequest, childRequest]);
    return deepFreeze({ parent: this._formatResult(parentResult), child: this._formatResult(childResult) });
  }
}

function isRelationalSessionEventStore(value) {
  return (
    RELATIONAL_SESSION_STORES.has(value) &&
    Object.getPrototypeOf(value) === RelationalSessionEventStore.prototype &&
    ['append', 'readSession', 'readGlobal', 'replay', 'reconstructRequest', 'recoveryPlan', 'forkSession'].every(
      (method) => value[method] === RelationalSessionEventStore.prototype[method],
    )
  );
}

Object.freeze(RelationalSessionEventStore.prototype);

module.exports = {
  AGGREGATE_TYPE,
  LEDGER_EVENT_TYPE,
  RelationalSessionEventStore,
  SessionEventStoreError,
  hydrateSessionEvent,
  isRelationalSessionEventStore,
  ledgerEventId,
};
