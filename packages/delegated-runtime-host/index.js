'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { canonicalTraceId } = require('../agent-trace-lineage');

const {
  AgentMessageSchema,
  AgentSessionSpecSchema,
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  NormalizedErrorCodeSchema,
  RuntimeEventSchema,
  RuntimeProviderManifestSchema,
  assertPortShape,
  deepFreeze,
  parseContract,
  strictObject,
  validatePortResult,
  z,
} = require('../agent-runtime-contracts');

const AGGREGATE_TYPE = 'delegated_runtime';
const MAX_OPERATION_TIMEOUT_MS = 2_147_483_647;
const MAX_WORKER_LEASE_MS = 300_000;
const MAX_DEFER_SHUTDOWN_MS = 900_000;

const CreatedSchema = strictObject({ request_id: IdentifierSchema, spec: AgentSessionSpecSchema });
const BoundSchema = strictObject({
  runtime_session_id: z.string().min(1).max(1024),
  manifest: RuntimeProviderManifestSchema,
});
const TurnSchema = strictObject({ request_id: IdentifierSchema, turn_id: IdentifierSchema, message: AgentMessageSchema });
const RequestSchema = strictObject({ request_id: IdentifierSchema });
const CancelSchema = strictObject({ request_id: IdentifierSchema, reason: z.string().min(1).max(2048) });
const FailedSchema = strictObject({
  request_id: IdentifierSchema,
  error_code: NormalizedErrorCodeSchema,
  message: z.string().min(1).max(4096),
  retryable: z.boolean(),
});
const RecordedSchema = strictObject({ event: RuntimeEventSchema });
const WorkerLeaseSchema = strictObject({
  request_id: IdentifierSchema,
  worker_id: IdentifierSchema,
  lease_epoch: z.number().int().positive().safe(),
  lease_ttl_ms: z.number().int().positive().max(MAX_WORKER_LEASE_MS),
  lease_expires_at: z.string().min(20).max(32),
});
const WorkerDrainSchema = strictObject({
  request_id: IdentifierSchema,
  worker_id: IdentifierSchema,
  lease_epoch: z.number().int().positive().safe(),
  defer_shutdown_ms: z.number().int().positive().max(MAX_DEFER_SHUTDOWN_MS),
  drain_deadline_at: z.string().min(20).max(32),
  reason: z.string().min(1).max(256),
});
const WorkerCheckpointSchema = strictObject({
  request_id: IdentifierSchema,
  worker_id: IdentifierSchema,
  lease_epoch: z.number().int().positive().safe(),
  checkpoint_sequence: z.number().int().nonnegative().safe(),
  reason: z.string().min(1).max(256),
});
const WorkerTerminalSchema = strictObject({
  request_id: IdentifierSchema,
  worker_id: IdentifierSchema,
  lease_epoch: z.number().int().positive().safe(),
  reason: z.string().min(1).max(256),
});
const WorkerClaimInputSchema = strictObject({
  request_id: IdentifierSchema,
  session_id: IdentifierSchema,
  worker_id: IdentifierSchema,
  lease_ttl_ms: z.number().int().positive().max(MAX_WORKER_LEASE_MS),
});
const WorkerFencedInputSchema = strictObject({
  request_id: IdentifierSchema,
  session_id: IdentifierSchema,
  worker_id: IdentifierSchema,
  lease_epoch: z.number().int().positive().safe(),
});
const WorkerDrainInputSchema = WorkerFencedInputSchema.extend({
  defer_shutdown_ms: z.number().int().positive().max(MAX_DEFER_SHUTDOWN_MS),
  reason: z.string().min(1).max(256),
}).strict();
const WorkerParkInputSchema = WorkerFencedInputSchema.extend({ reason: z.string().min(1).max(256) }).strict();
const WorkerSweepInputSchema = strictObject({ request_id: IdentifierSchema, session_id: IdentifierSchema });

const EVENT_SCHEMAS = Object.freeze({
  'delegated.runtime.created': CreatedSchema,
  'delegated.runtime.bound': BoundSchema,
  'delegated.turn.requested': TurnSchema,
  'delegated.turn.dispatch_started': RequestSchema,
  'delegated.cancel.requested': CancelSchema,
  'delegated.runtime.failed': FailedSchema,
  'delegated.runtime.outcome_uncertain': FailedSchema,
  'delegated.runtime.event_recorded': RecordedSchema,
  'delegated.worker.attached': WorkerLeaseSchema,
  'delegated.worker.heartbeat': WorkerLeaseSchema,
  'delegated.worker.drain_requested': WorkerDrainSchema,
  'delegated.worker.parked': WorkerCheckpointSchema,
  'delegated.worker.orphaned': WorkerTerminalSchema,
  'delegated.worker.retired': WorkerTerminalSchema,
});

class DelegatedRuntimeHostError extends Error {
  constructor(message, code = 'DELEGATED_RUNTIME_INVALID', details = {}) {
    super(message);
    this.name = 'DelegatedRuntimeHostError';
    this.code = code;
    this.details = details;
  }
}

function eventId(sessionId, eventType, key) {
  const hex = createHash('sha256').update(`${sessionId}\0${eventType}\0${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function canonicalTimestamp(value) {
  try {
    const timestamp = new Date(value).toISOString();
    if (timestamp !== value) throw new Error('non-canonical');
    return timestamp;
  } catch {
    throw new DelegatedRuntimeHostError('clock must return a canonical UTC timestamp');
  }
}

function addMilliseconds(timestamp, milliseconds) {
  const result = Date.parse(timestamp) + milliseconds;
  if (!Number.isSafeInteger(result) || result > 8_640_000_000_000_000) {
    throw new DelegatedRuntimeHostError('worker deadline exceeds the supported clock range');
  }
  return new Date(result).toISOString();
}

function initialState(sessionId) {
  return {
    session_id: sessionId,
    trace_id: null,
    version: 0,
    spec: null,
    manifest: null,
    runtime_session_id: null,
    runtime_sequence: 0,
    terminal: false,
    terminal_event: null,
    pending_turn: null,
    dispatch_started: false,
    cancel_request: null,
    failed: null,
    runtime_events: [],
    last_occurred_at: null,
    worker: {
      status: 'unassigned',
      worker_id: null,
      lease_epoch: 0,
      lease_ttl_ms: null,
      lease_expires_at: null,
      drain_deadline_at: null,
      drain_request_id: null,
      drain_reason: null,
      drain_defer_shutdown_ms: null,
      checkpoint_sequence: null,
    },
  };
}

function assertWorkerIdentity(state, payload) {
  if (state.worker.worker_id !== payload.worker_id || state.worker.lease_epoch !== payload.lease_epoch) {
    throw new DelegatedRuntimeHostError('delegated worker fencing token is invalid', 'DELEGATED_WORKER_FENCED');
  }
}

function applyFact(state, row) {
  const schema = EVENT_SCHEMAS[row.event_type];
  if (!schema || row.aggregate_type !== AGGREGATE_TYPE || row.aggregate_id !== state.session_id) {
    throw new DelegatedRuntimeHostError('delegated runtime ledger envelope is invalid', 'DELEGATED_RUNTIME_ENVELOPE_INVALID');
  }
  if (row.stream_sequence !== state.version + 1) {
    throw new DelegatedRuntimeHostError('delegated runtime ledger sequence is discontinuous', 'DELEGATED_RUNTIME_SEQUENCE_INVALID');
  }
  const occurredAt = canonicalTimestamp(row.occurred_at);
  if (state.last_occurred_at && Date.parse(occurredAt) < Date.parse(state.last_occurred_at)) {
    throw new DelegatedRuntimeHostError('delegated runtime clock regressed', 'DELEGATED_RUNTIME_SEQUENCE_INVALID');
  }
  const payload = parseContract(schema, row.payload, `persisted ${row.event_type}`);
  const rowTraceId = canonicalTraceId(row.correlation_id);
  if (state.trace_id && state.trace_id !== rowTraceId) {
    throw new DelegatedRuntimeHostError('delegated runtime trace lineage is fragmented', 'DELEGATED_RUNTIME_TRACE_FRAGMENTED');
  }
  state.trace_id = rowTraceId;
  if (row.event_type === 'delegated.runtime.created') {
    if (state.version !== 0 || payload.spec.session_id !== state.session_id || payload.spec.execution.mode !== 'delegated') {
      throw new DelegatedRuntimeHostError('delegated runtime creation fact is invalid');
    }
    state.spec = payload.spec;
  } else if (row.event_type === 'delegated.runtime.bound') {
    if (!state.spec || state.manifest || payload.manifest.provider_id !== state.spec.execution.runtime_provider_id) {
      throw new DelegatedRuntimeHostError('delegated runtime binding fact is invalid');
    }
    state.manifest = payload.manifest;
    state.runtime_session_id = payload.runtime_session_id;
  } else if (row.event_type === 'delegated.runtime.event_recorded') {
    const event = payload.event;
    if (
      !state.manifest ||
      event.provider_id !== state.manifest.provider_id ||
      event.runtime_session_id !== state.runtime_session_id ||
      event.sequence !== state.runtime_sequence + 1
    ) {
      throw new DelegatedRuntimeHostError('runtime event does not continue the durable provider binding');
    }
    if (event.event_type === 'runtime.session.started' && event.payload.hseos_session_id !== state.session_id) {
      throw new DelegatedRuntimeHostError('runtime start event belongs to another HSEOS session');
    }
    if (state.terminal) throw new DelegatedRuntimeHostError('runtime event follows a terminal fact');
    state.runtime_sequence = event.sequence;
    state.runtime_events.push(event);
    if (['runtime.session.completed', 'runtime.session.failed'].includes(event.event_type)) {
      state.terminal = true;
      state.terminal_event = event;
      state.pending_turn = null;
    }
  } else if (row.event_type === 'delegated.turn.requested') {
    if (!state.manifest || state.terminal || state.pending_turn) throw new DelegatedRuntimeHostError('delegated turn fact is invalid');
    state.pending_turn = payload;
    state.dispatch_started = false;
  } else if (row.event_type === 'delegated.turn.dispatch_started') {
    if (!state.pending_turn || state.pending_turn.request_id !== payload.request_id || state.dispatch_started || state.terminal) {
      throw new DelegatedRuntimeHostError('delegated dispatch fact is invalid');
    }
    state.dispatch_started = true;
  } else if (row.event_type === 'delegated.cancel.requested') {
    if (!state.manifest || state.terminal) throw new DelegatedRuntimeHostError('delegated cancellation fact is invalid');
    if (state.cancel_request) throw new DelegatedRuntimeHostError('duplicate delegated cancellation fact');
    state.cancel_request = payload;
  } else if (['delegated.runtime.failed', 'delegated.runtime.outcome_uncertain'].includes(row.event_type)) {
    if (state.terminal) throw new DelegatedRuntimeHostError('delegated failure follows a terminal fact');
    state.failed = payload;
    state.terminal = true;
    state.pending_turn = null;
  } else if (row.event_type === 'delegated.worker.attached') {
    canonicalTimestamp(payload.lease_expires_at);
    const canonicalExpiry = addMilliseconds(occurredAt, payload.lease_ttl_ms);
    if (
      !state.manifest ||
      state.terminal ||
      !['unassigned', 'parked', 'orphaned', 'retired'].includes(state.worker.status) ||
      payload.lease_epoch !== state.worker.lease_epoch + 1 ||
      payload.lease_expires_at !== canonicalExpiry ||
      (state.worker.status === 'retired' && state.worker.worker_id === payload.worker_id)
    ) {
      throw new DelegatedRuntimeHostError('delegated worker attachment fact is invalid');
    }
    state.worker = {
      status: 'attached',
      worker_id: payload.worker_id,
      lease_epoch: payload.lease_epoch,
      lease_ttl_ms: payload.lease_ttl_ms,
      lease_expires_at: payload.lease_expires_at,
      drain_deadline_at: null,
      drain_request_id: null,
      drain_reason: null,
      drain_defer_shutdown_ms: null,
      checkpoint_sequence: null,
    };
  } else if (row.event_type === 'delegated.worker.heartbeat') {
    canonicalTimestamp(payload.lease_expires_at);
    assertWorkerIdentity(state, payload);
    const requestedExpiry = addMilliseconds(occurredAt, payload.lease_ttl_ms);
    const canonicalExpiry = state.worker.drain_deadline_at
      ? new Date(Math.min(Date.parse(requestedExpiry), Date.parse(state.worker.drain_deadline_at))).toISOString()
      : requestedExpiry;
    if (
      !['attached', 'draining'].includes(state.worker.status) ||
      payload.lease_ttl_ms !== state.worker.lease_ttl_ms ||
      payload.lease_expires_at !== canonicalExpiry ||
      Date.parse(payload.lease_expires_at) <= Date.parse(state.worker.lease_expires_at)
    ) {
      throw new DelegatedRuntimeHostError('delegated worker heartbeat fact is invalid');
    }
    state.worker.lease_expires_at = payload.lease_expires_at;
  } else if (row.event_type === 'delegated.worker.drain_requested') {
    canonicalTimestamp(payload.drain_deadline_at);
    assertWorkerIdentity(state, payload);
    const requestedDeadline = addMilliseconds(occurredAt, payload.defer_shutdown_ms);
    const canonicalDeadline = new Date(Math.min(Date.parse(requestedDeadline), Date.parse(state.worker.lease_expires_at))).toISOString();
    if (
      state.worker.status !== 'attached' ||
      payload.drain_deadline_at !== canonicalDeadline ||
      Date.parse(payload.drain_deadline_at) <= Date.parse(occurredAt)
    ) {
      throw new DelegatedRuntimeHostError('delegated worker drain fact is invalid');
    }
    state.worker.status = 'draining';
    state.worker.drain_deadline_at = payload.drain_deadline_at;
    state.worker.drain_request_id = payload.request_id;
    state.worker.drain_reason = payload.reason;
    state.worker.drain_defer_shutdown_ms = payload.defer_shutdown_ms;
  } else if (row.event_type === 'delegated.worker.parked') {
    assertWorkerIdentity(state, payload);
    if (
      state.worker.status !== 'draining' ||
      state.dispatch_started ||
      payload.checkpoint_sequence !== state.runtime_sequence ||
      payload.reason !== state.worker.drain_reason ||
      Date.parse(occurredAt) >= Date.parse(state.worker.lease_expires_at) ||
      Date.parse(occurredAt) >= Date.parse(state.worker.drain_deadline_at)
    ) {
      throw new DelegatedRuntimeHostError('delegated worker checkpoint fact is invalid');
    }
    state.worker.status = 'parked';
    state.worker.checkpoint_sequence = payload.checkpoint_sequence;
    state.worker.lease_expires_at = null;
    state.worker.drain_deadline_at = null;
  } else if (row.event_type === 'delegated.worker.orphaned') {
    assertWorkerIdentity(state, payload);
    const drainExpired = state.worker.drain_deadline_at && Date.parse(occurredAt) >= Date.parse(state.worker.drain_deadline_at);
    const leaseExpired = Date.parse(occurredAt) >= Date.parse(state.worker.lease_expires_at);
    const expectedReason = drainExpired ? 'defer_expired' : 'lease_expired';
    if (!['attached', 'draining'].includes(state.worker.status) || (!drainExpired && !leaseExpired) || payload.reason !== expectedReason) {
      throw new DelegatedRuntimeHostError('delegated worker orphan fact is invalid');
    }
    state.worker.status = 'orphaned';
    state.worker.lease_expires_at = null;
    state.worker.drain_deadline_at = null;
  } else if (row.event_type === 'delegated.worker.retired') {
    assertWorkerIdentity(state, payload);
    if (!state.terminal && !['parked', 'orphaned'].includes(state.worker.status)) {
      throw new DelegatedRuntimeHostError('delegated worker retirement fact is invalid');
    }
    state.worker.status = 'retired';
  }
  state.version = row.stream_sequence;
  state.last_occurred_at = occurredAt;
  return state;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

class DelegatedRuntimeStore {
  constructor({ ledger, actor = { type: 'hseos', id: 'delegated-runtime-host' }, clock = () => new Date().toISOString() }) {
    if (!ledger || typeof ledger.append !== 'function' || typeof ledger.readStream !== 'function') {
      throw new DelegatedRuntimeHostError('a relational append/readStream ledger is required');
    }
    if (typeof clock !== 'function') throw new DelegatedRuntimeHostError('clock must be a function');
    this.ledger = ledger;
    this.actor = structuredClone(actor);
    this.clock = clock;
  }

  read(sessionIdValue) {
    const sessionId = parseContract(IdentifierSchema, sessionIdValue, 'delegated session id');
    const state = initialState(sessionId);
    for (const row of this.ledger.readStream(AGGREGATE_TYPE, sessionId)) applyFact(state, row);
    return deepFreeze(state);
  }

  now() {
    return canonicalTimestamp(this.clock());
  }

  append({ session_id, expected_version, event_type, payload, key, occurred_at = null, trace_id }) {
    const schema = EVENT_SCHEMAS[event_type];
    if (!schema) throw new DelegatedRuntimeHostError('unregistered delegated runtime event type');
    const parsedPayload = parseContract(schema, payload, event_type);
    const timestamp = occurred_at === null ? this.now() : canonicalTimestamp(occurred_at);
    const current = this.read(session_id);
    const resolvedTraceId = current.trace_id || canonicalTraceId(trace_id || session_id);
    if (trace_id !== undefined && canonicalTraceId(trace_id) !== resolvedTraceId) {
      throw new DelegatedRuntimeHostError('append cannot replace the durable delegated trace', 'DELEGATED_RUNTIME_TRACE_FRAGMENTED');
    }
    if (current.last_occurred_at && Date.parse(timestamp) < Date.parse(current.last_occurred_at)) {
      throw new DelegatedRuntimeHostError('delegated runtime clock regressed', 'DELEGATED_RUNTIME_SEQUENCE_INVALID');
    }
    applyFact(structuredClone(current), {
      aggregate_type: AGGREGATE_TYPE,
      aggregate_id: session_id,
      stream_sequence: expected_version + 1,
      event_type,
      occurred_at: timestamp,
      correlation_id: resolvedTraceId,
      payload: parsedPayload,
    });
    const result = this.ledger.append({
      aggregate_type: AGGREGATE_TYPE,
      aggregate_id: session_id,
      expected_version,
      events: [
        {
          event_id: eventId(session_id, event_type, key),
          event_type,
          schema_version: CONTRACT_SCHEMA_VERSION,
          occurred_at: timestamp,
          correlation_id: resolvedTraceId,
          causation_id: key,
          actor: this.actor,
          operation_id: null,
          payload: parsedPayload,
          evidence_refs: [],
        },
      ],
    });
    return { result, state: this.read(session_id) };
  }
}

function normalizedFailure(error) {
  const allowed = new Set([
    'budget_exceeded',
    'capability_unavailable',
    'cancelled',
    'internal_error',
    'invalid_request',
    'policy_denied',
    'provider_unavailable',
    'protocol_error',
    'rate_limited',
    'timeout',
    'tool_failed',
    'unauthorized',
  ]);
  const code = allowed.has(error?.error_code) ? error.error_code : 'provider_unavailable';
  return { error_code: code, message: 'delegated runtime operation failed', retryable: error?.retryable === true };
}

class DelegatedRuntimeHost {
  constructor({ store, provider_factory, operation_timeout_ms = 60_000 }) {
    if (!(store instanceof DelegatedRuntimeStore)) throw new DelegatedRuntimeHostError('a DelegatedRuntimeStore is required');
    if (typeof provider_factory !== 'function') throw new DelegatedRuntimeHostError('provider_factory must be a function');
    if (!Number.isSafeInteger(operation_timeout_ms) || operation_timeout_ms < 1 || operation_timeout_ms > MAX_OPERATION_TIMEOUT_MS) {
      throw new DelegatedRuntimeHostError('operation_timeout_ms is invalid');
    }
    this.store = store;
    this.providerFactory = provider_factory;
    this.operationTimeoutMs = operation_timeout_ms;
  }

  claimWorker(value) {
    const input = parseContract(WorkerClaimInputSchema, value, 'delegated worker claim');
    let state = this.store.read(input.session_id);
    if (!state.manifest || state.terminal) throw new DelegatedRuntimeHostError('worker requires a live durably bound session');
    const now = this.store.now();
    state = this.#expireWorkerIfNeeded(state, now, input.request_id);
    if (state.worker.status === 'retired' && state.worker.worker_id === input.worker_id) {
      throw new DelegatedRuntimeHostError('retired worker cannot reclaim its former binding', 'DELEGATED_WORKER_FENCED');
    }
    if (!['unassigned', 'parked', 'orphaned', 'retired'].includes(state.worker.status)) {
      throw new DelegatedRuntimeHostError('session already has a live worker lease', 'DELEGATED_WORKER_LEASE_CONFLICT');
    }
    return this.store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.worker.attached',
      payload: {
        request_id: input.request_id,
        worker_id: input.worker_id,
        lease_epoch: state.worker.lease_epoch + 1,
        lease_ttl_ms: input.lease_ttl_ms,
        lease_expires_at: addMilliseconds(now, input.lease_ttl_ms),
      },
      key: input.request_id,
      occurred_at: now,
    }).state;
  }

  heartbeatWorker(value) {
    const input = parseContract(WorkerFencedInputSchema, value, 'delegated worker heartbeat');
    let state = this.store.read(input.session_id);
    const now = this.store.now();
    state = this.#expireWorkerIfNeeded(state, now, input.request_id);
    this.#assertWorkerLease(state, input, now);
    let leaseExpiresAt = addMilliseconds(now, state.worker.lease_ttl_ms);
    if (state.worker.drain_deadline_at && Date.parse(leaseExpiresAt) > Date.parse(state.worker.drain_deadline_at)) {
      leaseExpiresAt = state.worker.drain_deadline_at;
    }
    if (Date.parse(leaseExpiresAt) <= Date.parse(state.worker.lease_expires_at)) {
      throw new DelegatedRuntimeHostError('heartbeat does not advance the worker lease');
    }
    return this.store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.worker.heartbeat',
      payload: {
        request_id: input.request_id,
        worker_id: input.worker_id,
        lease_epoch: input.lease_epoch,
        lease_ttl_ms: state.worker.lease_ttl_ms,
        lease_expires_at: leaseExpiresAt,
      },
      key: input.request_id,
      occurred_at: now,
    }).state;
  }

  drainWorker(value) {
    const input = parseContract(WorkerDrainInputSchema, value, 'delegated worker drain');
    let state = this.store.read(input.session_id);
    if (
      state.worker.status === 'draining' &&
      state.worker.worker_id === input.worker_id &&
      state.worker.lease_epoch === input.lease_epoch &&
      state.worker.drain_request_id === input.request_id &&
      state.worker.drain_reason === input.reason &&
      state.worker.drain_defer_shutdown_ms === input.defer_shutdown_ms
    ) {
      return state;
    }
    const now = this.store.now();
    state = this.#expireWorkerIfNeeded(state, now, input.request_id);
    this.#assertWorkerLease(state, input, now, ['attached']);
    const requestedDeadline = addMilliseconds(now, input.defer_shutdown_ms);
    const drainDeadline = new Date(Math.min(Date.parse(requestedDeadline), Date.parse(state.worker.lease_expires_at))).toISOString();
    if (Date.parse(drainDeadline) <= Date.parse(now)) throw new DelegatedRuntimeHostError('worker has no bounded drain window');
    return this.store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.worker.drain_requested',
      payload: {
        request_id: input.request_id,
        worker_id: input.worker_id,
        lease_epoch: input.lease_epoch,
        defer_shutdown_ms: input.defer_shutdown_ms,
        drain_deadline_at: drainDeadline,
        reason: input.reason,
      },
      key: input.request_id,
      occurred_at: now,
    }).state;
  }

  parkWorker(value) {
    const input = parseContract(WorkerParkInputSchema, value, 'delegated worker park');
    let state = this.store.read(input.session_id);
    if (
      state.worker.status === 'parked' &&
      state.worker.worker_id === input.worker_id &&
      state.worker.lease_epoch === input.lease_epoch &&
      state.worker.drain_request_id === input.request_id &&
      state.worker.drain_reason === input.reason
    ) {
      return state;
    }
    const now = this.store.now();
    state = this.#expireWorkerIfNeeded(state, now, input.request_id);
    this.#assertWorkerLease(state, input, now, ['draining']);
    if (state.dispatch_started) {
      throw new DelegatedRuntimeHostError('worker cannot checkpoint an outcome-in-doubt dispatch', 'DELEGATED_RUNTIME_OUTCOME_IN_DOUBT');
    }
    return this.store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.worker.parked',
      payload: {
        request_id: input.request_id,
        worker_id: input.worker_id,
        lease_epoch: input.lease_epoch,
        checkpoint_sequence: state.runtime_sequence,
        reason: input.reason,
      },
      key: input.request_id,
      occurred_at: now,
    }).state;
  }

  drainAndParkWorker(value) {
    const input = parseContract(WorkerDrainInputSchema, value, 'delegated worker shutdown');
    const state = this.store.read(input.session_id);
    if (
      ['draining', 'parked'].includes(state.worker.status) &&
      (state.worker.worker_id !== input.worker_id ||
        state.worker.lease_epoch !== input.lease_epoch ||
        state.worker.drain_request_id !== input.request_id ||
        state.worker.drain_reason !== input.reason ||
        state.worker.drain_defer_shutdown_ms !== input.defer_shutdown_ms)
    ) {
      throw new DelegatedRuntimeHostError('delegated worker shutdown does not match the durable drain', 'DELEGATED_WORKER_FENCED');
    }
    if (state.worker.status === 'parked') return state;
    if (state.worker.status !== 'draining') this.drainWorker(input);
    return this.parkWorker({
      request_id: input.request_id,
      session_id: input.session_id,
      worker_id: input.worker_id,
      lease_epoch: input.lease_epoch,
      reason: input.reason,
    });
  }

  sweepWorker(value) {
    const input = parseContract(WorkerSweepInputSchema, value, 'delegated worker sweep');
    return this.#expireWorkerIfNeeded(this.store.read(input.session_id), this.store.now(), input.request_id);
  }

  retireWorker(value) {
    const input = parseContract(WorkerParkInputSchema, value, 'delegated worker retirement');
    const state = this.store.read(input.session_id);
    if (state.worker.worker_id !== input.worker_id || state.worker.lease_epoch !== input.lease_epoch) {
      throw new DelegatedRuntimeHostError('stale worker cannot retire this binding', 'DELEGATED_WORKER_FENCED');
    }
    return this.store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.worker.retired',
      payload: {
        request_id: input.request_id,
        worker_id: input.worker_id,
        lease_epoch: input.lease_epoch,
        reason: input.reason,
      },
      key: input.request_id,
    }).state;
  }

  async create({ request_id, spec: specValue, trace_id }) {
    const requestId = parseContract(IdentifierSchema, request_id, 'delegated create request id');
    const spec = parseContract(AgentSessionSpecSchema, specValue, 'delegated runtime spec');
    if (spec.execution.mode !== 'delegated') throw new DelegatedRuntimeHostError('delegated host requires delegated execution');
    let state = this.store.read(spec.session_id);
    if (state.version > 0) {
      if (trace_id !== undefined && canonicalTraceId(trace_id) !== state.trace_id) {
        throw new DelegatedRuntimeHostError('create cannot replace the durable delegated trace', 'DELEGATED_RUNTIME_TRACE_FRAGMENTED');
      }
      if (state.spec && canonicalJson(state.spec) === canonicalJson(spec)) {
        if (state.manifest || state.terminal) return state;
        throw new DelegatedRuntimeHostError('delegated create outcome is uncertain', 'DELEGATED_RUNTIME_OUTCOME_IN_DOUBT');
      }
      throw new DelegatedRuntimeHostError('delegated session already exists');
    }
    if (spec.parent_session_id !== null && trace_id === undefined) {
      throw new DelegatedRuntimeHostError('a delegated child requires its inherited trace root', 'DELEGATED_RUNTIME_TRACE_REQUIRED');
    }
    state = this.store.append({
      session_id: spec.session_id,
      expected_version: 0,
      event_type: 'delegated.runtime.created',
      payload: { request_id: requestId, spec },
      key: requestId,
      trace_id,
    }).state;
    let crossedCreateBoundary = false;
    try {
      const provider = this.#provider(spec);
      const input = { schema_version: CONTRACT_SCHEMA_VERSION, command: 'create', provider_id: spec.execution.runtime_provider_id, spec };
      crossedCreateBoundary = true;
      const result = validatePortResult('RuntimeProvider', 'create', await this.#bounded(provider.create(input)), input);
      if (!result.accepted || result.terminal || result.session_id !== spec.session_id) {
        throw new DelegatedRuntimeHostError('runtime provider rejected or terminalized create');
      }
      const manifest = this.#manifest(provider, spec.execution.runtime_provider_id);
      state = this.store.append({
        session_id: spec.session_id,
        expected_version: state.version,
        event_type: 'delegated.runtime.bound',
        payload: { runtime_session_id: result.runtime_session_id, manifest },
        key: `${requestId}:bound`,
      }).state;
      return await this.#recordInitialEvent(provider, state, requestId);
    } catch (error) {
      return this.#fail(state, requestId, error, crossedCreateBoundary);
    }
  }

  async resumeAndSend({ request_id, session_id, turn_id, message: messageValue, worker_id, lease_epoch }) {
    const requestId = parseContract(IdentifierSchema, request_id, 'delegated send request id');
    const turnId = parseContract(IdentifierSchema, turn_id, 'delegated turn id');
    const message = parseContract(AgentMessageSchema, messageValue, 'delegated turn message');
    let state = this.#continuable(session_id, { worker_id, lease_epoch });
    if (state.pending_turn) {
      if (
        state.pending_turn.request_id !== requestId ||
        state.pending_turn.turn_id !== turnId ||
        canonicalJson(state.pending_turn.message) !== canonicalJson(message)
      ) {
        throw new DelegatedRuntimeHostError('a different delegated turn is already pending');
      }
    }
    const provider = await this.#reattach(state);
    try {
      state = this.#continuable(session_id, { worker_id, lease_epoch });
    } catch (error) {
      await this.#closeProvider(provider);
      throw error;
    }
    if (!state.pending_turn) {
      state = this.store.append({
        session_id: state.session_id,
        expected_version: state.version,
        event_type: 'delegated.turn.requested',
        payload: { request_id: requestId, turn_id: turnId, message },
        key: requestId,
      }).state;
    }
    state = this.store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.turn.dispatch_started',
      payload: { request_id: requestId },
      key: `${requestId}:dispatch`,
    }).state;
    try {
      const input = {
        schema_version: CONTRACT_SCHEMA_VERSION,
        command: 'send',
        provider_id: state.manifest.provider_id,
        runtime_session_id: state.runtime_session_id,
        session_id: state.session_id,
        turn_id: turnId,
        message,
      };
      const result = validatePortResult('RuntimeProvider', 'send', await this.#bounded(provider.send(input)), input);
      if (!result.accepted || result.session_id !== state.session_id) throw new DelegatedRuntimeHostError('runtime provider rejected send');
      return await this.#drainToTerminal(provider, state, requestId);
    } catch (error) {
      return this.#fail(state, requestId, error, true);
    }
  }

  async resumeAndCancel({ request_id, session_id, reason, worker_id, lease_epoch }) {
    const requestId = parseContract(IdentifierSchema, request_id, 'delegated cancel request id');
    let state = this.store.read(session_id);
    if (state.terminal) return state;
    state = this.#continuable(session_id, { worker_id, lease_epoch });
    if (state.cancel_request && (state.cancel_request.request_id !== requestId || state.cancel_request.reason !== reason)) {
      throw new DelegatedRuntimeHostError('a different delegated cancellation is already pending');
    }
    const provider = await this.#reattach(state);
    try {
      state = this.#continuable(session_id, { worker_id, lease_epoch });
    } catch (error) {
      await this.#closeProvider(provider);
      throw error;
    }
    if (!state.cancel_request) {
      state = this.store.append({
        session_id: state.session_id,
        expected_version: state.version,
        event_type: 'delegated.cancel.requested',
        payload: { request_id: requestId, reason },
        key: requestId,
      }).state;
    }
    try {
      const input = {
        schema_version: CONTRACT_SCHEMA_VERSION,
        command: 'cancel',
        provider_id: state.manifest.provider_id,
        runtime_session_id: state.runtime_session_id,
        session_id: state.session_id,
        reason,
        cascade: true,
      };
      const result = validatePortResult('RuntimeProvider', 'cancel', await this.#bounded(provider.cancel(input)), input);
      if (!result.accepted || !result.terminal) throw new DelegatedRuntimeHostError('runtime provider did not settle cancellation');
      return await this.#drainToTerminal(provider, state, requestId);
    } catch (error) {
      return this.#fail(state, requestId, error, true);
    }
  }

  read(sessionId) {
    return this.store.read(sessionId);
  }

  #continuable(sessionId, lease = {}) {
    const state = this.store.read(sessionId);
    if (!state.manifest)
      throw new DelegatedRuntimeHostError('delegated runtime is not durably bound', 'DELEGATED_RUNTIME_OUTCOME_IN_DOUBT');
    if (state.terminal) throw new DelegatedRuntimeHostError('delegated runtime is terminal');
    if (state.dispatch_started) {
      throw new DelegatedRuntimeHostError('delegated dispatch outcome is uncertain', 'DELEGATED_RUNTIME_OUTCOME_IN_DOUBT');
    }
    if (state.worker.status === 'unassigned') {
      if (lease.worker_id !== undefined || lease.lease_epoch !== undefined) {
        throw new DelegatedRuntimeHostError('session has no worker lease', 'DELEGATED_WORKER_FENCED');
      }
    } else {
      this.#assertWorkerLease(state, lease, this.store.now(), ['attached']);
    }
    return state;
  }

  #assertWorkerLease(state, input, now, statuses = ['attached', 'draining']) {
    if (
      !statuses.includes(state.worker.status) ||
      state.worker.worker_id !== input.worker_id ||
      state.worker.lease_epoch !== input.lease_epoch ||
      Date.parse(state.worker.lease_expires_at) <= Date.parse(now) ||
      (state.worker.drain_deadline_at && Date.parse(state.worker.drain_deadline_at) <= Date.parse(now))
    ) {
      throw new DelegatedRuntimeHostError('delegated worker lease is stale or fenced', 'DELEGATED_WORKER_FENCED');
    }
  }

  #expireWorkerIfNeeded(state, now, requestId) {
    if (state.terminal || !['attached', 'draining'].includes(state.worker.status)) return state;
    const drainExpired = state.worker.drain_deadline_at && Date.parse(state.worker.drain_deadline_at) <= Date.parse(now);
    const leaseExpired = Date.parse(state.worker.lease_expires_at) <= Date.parse(now);
    if (!drainExpired && !leaseExpired) return state;
    return this.store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.worker.orphaned',
      payload: {
        request_id: requestId,
        worker_id: state.worker.worker_id,
        lease_epoch: state.worker.lease_epoch,
        reason: drainExpired ? 'defer_expired' : 'lease_expired',
      },
      key: `${requestId}:orphan:${state.worker.lease_epoch}`,
      occurred_at: now,
    }).state;
  }

  #provider(spec) {
    const provider = this.providerFactory(spec.execution.runtime_provider_id, spec);
    assertPortShape('RuntimeProvider', provider);
    this.#manifest(provider, spec.execution.runtime_provider_id);
    return provider;
  }

  #manifest(provider, providerId) {
    const input = { schema_version: CONTRACT_SCHEMA_VERSION, provider_id: providerId, request_id: `request:manifest:${randomUUID()}` };
    const manifest = validatePortResult('RuntimeProvider', 'manifest', provider.manifest(input), input);
    if (manifest.provider_id !== providerId) throw new DelegatedRuntimeHostError('runtime provider manifest identity mismatch');
    return manifest;
  }

  async #reattach(state) {
    const provider = this.#provider(state.spec);
    const currentManifest = this.#manifest(provider, state.manifest.provider_id);
    if (canonicalJson(currentManifest) !== canonicalJson(state.manifest)) {
      throw new DelegatedRuntimeHostError('runtime provider manifest drifted from the durable binding');
    }
    const input = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      command: 'resume',
      provider_id: state.manifest.provider_id,
      runtime_session_id: state.runtime_session_id,
      session_id: state.session_id,
      expected_sequence: state.runtime_sequence,
      spec: state.spec,
    };
    const result = validatePortResult('RuntimeProvider', 'resume', await this.#bounded(provider.resume(input)), input);
    if (!result.accepted || result.terminal || result.runtime_session_id !== state.runtime_session_id) {
      throw new DelegatedRuntimeHostError('runtime provider failed exact reattachment');
    }
    return provider;
  }

  async #recordInitialEvent(provider, state, requestId) {
    const event = await this.#next(provider, state);
    if (event.event_type !== 'runtime.session.started' || event.sequence !== 1) {
      throw new DelegatedRuntimeHostError('runtime provider omitted the canonical start event');
    }
    return this.#recordRuntimeEvent(state, event, requestId);
  }

  async #drainToTerminal(provider, state, requestId) {
    let current = state;
    while (!current.terminal) {
      const event = await this.#next(provider, current);
      current = this.#recordRuntimeEvent(current, event, requestId);
    }
    return current;
  }

  async #next(provider, state) {
    const input = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: state.manifest.provider_id,
      runtime_session_id: state.runtime_session_id,
      session_id: state.session_id,
      from_sequence: state.runtime_sequence,
    };
    const stream = validatePortResult('RuntimeProvider', 'events', provider.events(input), input);
    const iterator = stream[Symbol.asyncIterator]();
    try {
      const next = await this.#bounded(iterator.next());
      if (next.done) throw new DelegatedRuntimeHostError('runtime event stream ended without a terminal fact');
      return parseContract(RuntimeEventSchema, next.value, 'delegated runtime event');
    } finally {
      if (typeof iterator.return === 'function') await iterator.return();
    }
  }

  #recordRuntimeEvent(state, event, requestId) {
    return this.store.append({
      session_id: state.session_id,
      expected_version: state.version,
      event_type: 'delegated.runtime.event_recorded',
      payload: { event },
      key: `${requestId}:runtime:${event.sequence}`,
    }).state;
  }

  #fail(state, requestId, error, outcomeUncertain = false) {
    const current = this.store.read(state.session_id);
    if (current.terminal) return current;
    return this.store.append({
      session_id: current.session_id,
      expected_version: current.version,
      event_type: outcomeUncertain ? 'delegated.runtime.outcome_uncertain' : 'delegated.runtime.failed',
      payload: { request_id: requestId, ...normalizedFailure(error) },
      key: `${requestId}:failed`,
    }).state;
  }

  async #bounded(promise) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((unused, reject) => {
          timer = setTimeout(
            () => reject(new DelegatedRuntimeHostError('delegated runtime operation timed out', 'timeout')),
            this.operationTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async #closeProvider(provider) {
    try {
      await this.#bounded(provider.close());
    } catch {
      // The durable fencing decision does not depend on best-effort adapter teardown.
    }
  }
}

module.exports = {
  AGGREGATE_TYPE,
  DelegatedRuntimeHost,
  DelegatedRuntimeHostError,
  DelegatedRuntimeStore,
};
