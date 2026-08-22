'use strict';

const { createExecutionEventRegistry, ExecutionEventRegistry } = require('../../lib/governed-execution/event-registry');

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
  ['private', 'key'].join('_'),
  'refresh_token',
  'secret',
  'session_cookie',
  'set_cookie',
  'token',
]);

const SENSITIVE_KEY_SUFFIX = /(?:^|_)(?:credential|credentials|password|secret|token)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function normalizeKey(key) {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/[^a-zA-Z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .toLowerCase();
}

class ExecutionLedgerError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

class ConcurrencyConflictError extends ExecutionLedgerError {
  constructor({ aggregate_id, aggregate_type, expected_version, current_version }) {
    super(
      `Expected ${aggregate_type}/${aggregate_id} at version ${expected_version}, current version is ${current_version}`,
      'EXECUTION_STREAM_VERSION_CONFLICT',
      { aggregate_id, aggregate_type, expected_version, current_version },
    );
  }
}

class DuplicateEventError extends ExecutionLedgerError {
  constructor(eventIds) {
    super('Event identifiers already exist with different or partial content', 'EXECUTION_EVENT_ID_CONFLICT', {
      event_ids: eventIds,
    });
  }
}

class InvalidEventError extends ExecutionLedgerError {
  constructor(message, details = {}) {
    super(message, 'EXECUTION_EVENT_INVALID', details);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function assertStrictJson(value, path, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidEventError(`${path} contains a non-finite number`, { path });
    return;
  }
  if (typeof value !== 'object') {
    throw new InvalidEventError(`${path} contains a non-JSON value`, { path, type: typeof value });
  }
  if (ancestors.has(value)) throw new InvalidEventError(`${path} contains a cyclic reference`, { path });
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidEventError(`${path} must contain only plain JSON objects`, { path });
    }
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new InvalidEventError(`${path} contains a sparse array slot`, { path: `${path}[${index}]` });
      assertStrictJson(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    for (const [key, nested] of Object.entries(value)) assertStrictJson(nested, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function assertNoSensitivePayload(value, path = 'payload') {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoSensitivePayload(item, `${path}[${index}]`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (SENSITIVE_KEYS.has(normalizedKey) || SENSITIVE_KEY_SUFFIX.test(normalizedKey)) {
      throw new InvalidEventError(`Sensitive field is forbidden in event payload: ${path}.${key}`, { path: `${path}.${key}` });
    }
    assertNoSensitivePayload(nested, `${path}.${key}`);
  }
}

function requireString(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidEventError(`${label} must be a non-empty string${nullable ? ' or null' : ''}`);
  }
}

function normalizeEvent(event, stream, sequence) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new InvalidEventError('Each event must be an object');
  }
  requireString(event.event_id, 'event_id');
  if (!UUID_PATTERN.test(event.event_id)) throw new InvalidEventError('event_id must be a UUID');
  requireString(event.event_type, 'event_type');
  requireString(event.occurred_at, 'occurred_at');
  requireString(event.correlation_id, 'correlation_id');
  requireString(event.causation_id, 'causation_id');
  requireString(event.operation_id, 'operation_id', { nullable: stream.aggregate_type !== 'execution' });
  if (!Number.isInteger(event.schema_version) || event.schema_version < 1) {
    throw new InvalidEventError('schema_version must be a positive integer');
  }
  const parsedOccurredAt = new Date(event.occurred_at);
  if (
    !UTC_TIMESTAMP_PATTERN.test(event.occurred_at) ||
    Number.isNaN(parsedOccurredAt.getTime()) ||
    parsedOccurredAt.toISOString() !== event.occurred_at
  ) {
    throw new InvalidEventError('occurred_at must be a canonical UTC timestamp with millisecond precision');
  }
  if (!event.actor || typeof event.actor !== 'object' || Array.isArray(event.actor)) {
    throw new InvalidEventError('actor must be an object');
  }
  if (event.payload === undefined) throw new InvalidEventError('payload is required');
  const evidenceRefs = event.evidence_refs === undefined ? [] : event.evidence_refs;
  if (!Array.isArray(evidenceRefs) || evidenceRefs.some((reference) => typeof reference !== 'string')) {
    throw new InvalidEventError('evidence_refs must be an array of strings');
  }
  assertStrictJson(event.actor, 'actor');
  assertStrictJson(event.payload, 'payload');
  assertNoSensitivePayload(event.actor, 'actor');
  assertNoSensitivePayload(event.payload);

  return {
    event_id: event.event_id,
    event_type: event.event_type,
    aggregate_id: stream.aggregate_id,
    aggregate_type: stream.aggregate_type,
    stream_sequence: sequence,
    schema_version: event.schema_version,
    occurred_at: event.occurred_at,
    correlation_id: event.correlation_id,
    causation_id: event.causation_id,
    actor_json: stableJson(event.actor),
    operation_id: event.operation_id,
    payload_json: stableJson(event.payload),
    evidence_refs_json: stableJson(evidenceRefs),
  };
}

function hydrate(row) {
  if (!row) return row;
  return {
    position: row.position,
    event_id: row.event_id,
    event_type: row.event_type,
    aggregate_id: row.aggregate_id,
    aggregate_type: row.aggregate_type,
    stream_sequence: row.stream_sequence,
    schema_version: row.schema_version,
    occurred_at: row.occurred_at,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    actor: JSON.parse(row.actor_json),
    operation_id: row.operation_id,
    payload: JSON.parse(row.payload_json),
    evidence_refs: JSON.parse(row.evidence_refs_json),
    recorded_at: row.recorded_at,
  };
}

function samePersistedEvent(row, candidate) {
  return (
    row.event_type === candidate.event_type &&
    row.aggregate_id === candidate.aggregate_id &&
    row.aggregate_type === candidate.aggregate_type &&
    row.stream_sequence === candidate.stream_sequence &&
    row.schema_version === candidate.schema_version &&
    row.occurred_at === candidate.occurred_at &&
    row.correlation_id === candidate.correlation_id &&
    row.causation_id === candidate.causation_id &&
    row.actor_json === candidate.actor_json &&
    row.operation_id === candidate.operation_id &&
    row.payload_json === candidate.payload_json &&
    row.evidence_refs_json === candidate.evidence_refs_json
  );
}

class ExecutionEventLedger {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {{event_registry?: import('../../lib/governed-execution/event-registry').ExecutionEventRegistry}} [options]
   */
  constructor(db, { event_registry = createExecutionEventRegistry() } = {}) {
    if (!(event_registry instanceof ExecutionEventRegistry)) {
      throw new ExecutionLedgerError(
        'Execution ledger requires a concrete fail-closed event registry',
        'EXECUTION_EVENT_REGISTRY_BOUNDARY_MISSING',
      );
    }
    this.db = db;
    this.eventRegistry = event_registry;
    this._metrics = {
      append_count: 0,
      append_count_by_aggregate_type: Object.create(null),
      events_appended: 0,
      events_appended_by_aggregate_type: Object.create(null),
      concurrency_conflicts: 0,
      concurrency_conflicts_by_aggregate_type: Object.create(null),
      event_id_conflicts: 0,
      idempotent_replays: 0,
      append_latency_ms: 0,
    };
    this._selectVersion = db.prepare(
      `SELECT COALESCE(MAX(stream_sequence), 0) AS version
       FROM execution_events WHERE aggregate_type = ? AND aggregate_id = ?`,
    );
    this._selectById = db.prepare(`SELECT * FROM execution_events WHERE event_id = ?`);
    this._insert = db.prepare(
      `INSERT INTO execution_events (
         event_id, event_type, aggregate_id, aggregate_type, stream_sequence,
         schema_version, occurred_at, correlation_id, causation_id, actor_json,
         operation_id, payload_json, evidence_refs_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this._appendRows = (stream, expectedVersion, candidates) => {
      const existing = candidates.map((candidate) => this._selectById.get(candidate.event_id));
      if (existing.some(Boolean)) {
        if (existing.every((row, index) => row && samePersistedEvent(row, candidates[index]))) {
          const currentVersion = this._selectVersion.get(stream.aggregate_type, stream.aggregate_id).version;
          return { rows: existing, current_version: currentVersion, idempotent: true };
        }
        throw new DuplicateEventError(candidates.map((candidate) => candidate.event_id));
      }

      const currentVersion = this._selectVersion.get(stream.aggregate_type, stream.aggregate_id).version;
      if (currentVersion !== expectedVersion) {
        throw new ConcurrencyConflictError({ ...stream, expected_version: expectedVersion, current_version: currentVersion });
      }

      for (const candidate of candidates) {
        this._insert.run(
          candidate.event_id,
          candidate.event_type,
          candidate.aggregate_id,
          candidate.aggregate_type,
          candidate.stream_sequence,
          candidate.schema_version,
          candidate.occurred_at,
          candidate.correlation_id,
          candidate.causation_id,
          candidate.actor_json,
          candidate.operation_id,
          candidate.payload_json,
          candidate.evidence_refs_json,
        );
      }
      return {
        rows: candidates.map((candidate) => this._selectById.get(candidate.event_id)),
        current_version: expectedVersion + candidates.length,
        idempotent: false,
      };
    };
    this._appendTransaction = db.transaction(this._appendRows);
    this._appendBatchTransaction = db.transaction((prepared) =>
      prepared.map(({ stream, expected_version, candidates }) => this._appendRows(stream, expected_version, candidates)),
    );
  }

  _prepareAppend({ aggregate_id, aggregate_type, expected_version, events }) {
    requireString(aggregate_id, 'aggregate_id');
    requireString(aggregate_type, 'aggregate_type');
    if (!Number.isInteger(expected_version) || expected_version < 0) {
      throw new InvalidEventError('expected_version must be a non-negative integer');
    }
    if (!Array.isArray(events) || events.length === 0) {
      throw new InvalidEventError('events must be a non-empty array');
    }
    if (aggregate_type === 'execution' && this.eventRegistry) {
      for (const event of events) this.eventRegistry.validateForAppend(event);
    }
    const stream = { aggregate_id, aggregate_type };
    const candidates = events.map((event, index) => normalizeEvent(event, stream, expected_version + index + 1));
    const uniqueIds = new Set(candidates.map((event) => event.event_id));
    if (uniqueIds.size !== candidates.length) throw new InvalidEventError('event_id values must be unique within an append');
    return { aggregate_type, stream, expected_version, candidates };
  }

  _recordAttempt(aggregateType) {
    this._metrics.append_count++;
    this._metrics.append_count_by_aggregate_type[aggregateType] =
      (this._metrics.append_count_by_aggregate_type[aggregateType] || 0) + 1;
  }

  _recordResult(aggregateType, result) {
    if (result.idempotent) this._metrics.idempotent_replays++;
    else {
      this._metrics.events_appended += result.rows.length;
      this._metrics.events_appended_by_aggregate_type[aggregateType] =
        (this._metrics.events_appended_by_aggregate_type[aggregateType] || 0) + result.rows.length;
    }
    return {
      current_version: result.current_version,
      idempotent: result.idempotent,
      events: result.rows.map(hydrate),
    };
  }

  _recordError(error, fallbackAggregateType) {
    const aggregateType = error.details?.aggregate_type || fallbackAggregateType;
    if (error instanceof ConcurrencyConflictError) {
      this._metrics.concurrency_conflicts++;
      this._metrics.concurrency_conflicts_by_aggregate_type[aggregateType] =
        (this._metrics.concurrency_conflicts_by_aggregate_type[aggregateType] || 0) + 1;
    }
    if (error instanceof DuplicateEventError) this._metrics.event_id_conflicts++;
  }

  append(request) {
    const prepared = this._prepareAppend(request);
    const { aggregate_type, stream, expected_version, candidates } = prepared;

    const startedAt = process.hrtime.bigint();
    this._recordAttempt(aggregate_type);
    try {
      const result = this._appendTransaction.immediate(stream, expected_version, candidates);
      return this._recordResult(aggregate_type, result);
    } catch (error) {
      this._recordError(error, aggregate_type);
      throw error;
    } finally {
      this._metrics.append_latency_ms += Number(process.hrtime.bigint() - startedAt) / 1e6;
    }
  }

  appendBatch(requests) {
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new InvalidEventError('append batch must be a non-empty array');
    }
    const prepared = requests.map((request) => this._prepareAppend(request));
    const startedAt = process.hrtime.bigint();
    for (const item of prepared) this._recordAttempt(item.aggregate_type);
    try {
      const results = this._appendBatchTransaction.immediate(prepared);
      return results.map((result, index) => this._recordResult(prepared[index].aggregate_type, result));
    } catch (error) {
      this._recordError(error, prepared[0].aggregate_type);
      throw error;
    } finally {
      this._metrics.append_latency_ms += Number(process.hrtime.bigint() - startedAt) / 1e6;
    }
  }

  getVersion(aggregate_type, aggregate_id) {
    requireString(aggregate_type, 'aggregate_type');
    requireString(aggregate_id, 'aggregate_id');
    return this._selectVersion.get(aggregate_type, aggregate_id).version;
  }

  readStream(aggregate_type, aggregate_id, { from_version = 1, to_version = Number.MAX_SAFE_INTEGER } = {}) {
    requireString(aggregate_type, 'aggregate_type');
    requireString(aggregate_id, 'aggregate_id');
    if (!Number.isInteger(from_version) || from_version < 1 || !Number.isInteger(to_version) || to_version < from_version) {
      throw new InvalidEventError('Invalid stream version range');
    }
    return this.db
      .prepare(
        `SELECT * FROM execution_events
         WHERE aggregate_type = ? AND aggregate_id = ? AND stream_sequence BETWEEN ? AND ?
         ORDER BY stream_sequence`,
      )
      .all(aggregate_type, aggregate_id, from_version, to_version)
      .map(hydrate);
  }

  readGlobal({ after_position = 0, limit = 100, aggregate_type } = {}) {
    if (!Number.isInteger(after_position) || after_position < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new InvalidEventError('Invalid global stream cursor or limit');
    }
    if (aggregate_type !== undefined) requireString(aggregate_type, 'aggregate_type');
    if (aggregate_type !== undefined) {
      return this.db
        .prepare(`SELECT * FROM execution_events WHERE position > ? AND aggregate_type = ? ORDER BY position LIMIT ?`)
        .all(after_position, aggregate_type, limit)
        .map(hydrate);
    }
    return this.db
      .prepare(`SELECT * FROM execution_events WHERE position > ? ORDER BY position LIMIT ?`)
      .all(after_position, limit)
      .map(hydrate);
  }

  metrics() {
    return {
      ...this._metrics,
      append_count_by_aggregate_type: { ...this._metrics.append_count_by_aggregate_type },
      events_appended_by_aggregate_type: { ...this._metrics.events_appended_by_aggregate_type },
      concurrency_conflicts_by_aggregate_type: { ...this._metrics.concurrency_conflicts_by_aggregate_type },
    };
  }
}

module.exports = {
  ConcurrencyConflictError,
  DuplicateEventError,
  ExecutionEventLedger,
  ExecutionLedgerError,
  InvalidEventError,
};
