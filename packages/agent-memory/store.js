'use strict';

const { createHash } = require('node:crypto');

const {
  AUTHORITY,
  AgentMemoryError,
  CONTRACT,
  MAX_TTL_SECONDS,
  admitWrite,
  assertNoCredential,
  normalizeEntry,
  sha256Text,
} = require('./policy');

const AGGREGATE_TYPE = 'agent_memory';
const EVENTS = Object.freeze({
  WRITTEN: 'memory.written',
  SUPERSEDED: 'memory.superseded',
  EXPIRED: 'memory.expired',
  DELETED: 'memory.deleted',
});
const DEFAULT_ACTOR = Object.freeze({ kind: 'host', id: 'agent-memory' });
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const iso = (milliseconds) => new Date(milliseconds).toISOString();

function tokenize(text) {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].sort();
}

// Deterministic UUID per (project, event type, memory): a retried append is an idempotent replay, never a duplicate.
function eventId(projectId, type, memoryId) {
  const hex = createHash('sha256').update(`${projectId}\0${type}\0${memoryId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function foldEvents(events) {
  const records = new Map();
  const transition = (event, from, to, patch = {}) => {
    const record = records.get(event.payload.memory_id);
    if (!record || !from.includes(record.status)) {
      throw new AgentMemoryError(`memory event ${event.event_type} does not apply to the current state`, 'AGENT_MEMORY_EVENT_INVALID');
    }
    Object.assign(record, { status: to }, patch);
  };
  for (const event of events) {
    switch (event.event_type) {
      case EVENTS.WRITTEN: {
        records.set(event.payload.entry.memory_id, {
          entry: event.payload.entry,
          status: 'active',
          tokens: tokenize(event.payload.entry.content),
        });
        break;
      }
      case EVENTS.SUPERSEDED: {
        transition(event, ['active'], 'superseded', { superseded_by: event.payload.superseded_by });
        break;
      }
      case EVENTS.EXPIRED: {
        transition(event, ['active'], 'expired');
        break;
      }
      case EVENTS.DELETED: {
        transition(event, ['active', 'superseded', 'expired'], 'deleted');
        break;
      }
      default: {
        throw new AgentMemoryError(`unknown memory event type: ${event.event_type}`, 'AGENT_MEMORY_EVENT_UNKNOWN');
      }
    }
  }
  return records;
}

/**
 * Governed memory over the execution ledger. The ledger holds the events (aggregate `agent_memory`, one stream per
 * project); the lexical index is a disposable projection rebuilt from them. Entries are always `data`.
 */
class MemoryStore {
  /**
   * @param {{ledger: object, scanCredential: (text: string) => boolean, now?: () => number, maxTtlSeconds?: number}} options
   */
  constructor({ ledger, scanCredential, now = Date.now, maxTtlSeconds = MAX_TTL_SECONDS }) {
    if (!ledger || typeof ledger.append !== 'function' || typeof ledger.readStream !== 'function') {
      throw new AgentMemoryError('memory requires the execution ledger', 'AGENT_MEMORY_LEDGER_REQUIRED');
    }
    this.ledger = ledger;
    this.scanCredential = scanCredential;
    this.now = now;
    this.maxTtlSeconds = maxTtlSeconds;
    this._projection = new Map();
  }

  /** Drops the projection; the next read replays the events. */
  rebuild() {
    this._projection.clear();
  }

  _state(projectId) {
    const version = this.ledger.getVersion(AGGREGATE_TYPE, projectId);
    const cached = this._projection.get(projectId);
    if (cached?.version === version) return cached;
    const state = { version, records: foldEvents(this.ledger.readStream(AGGREGATE_TYPE, projectId)) };
    this._projection.set(projectId, state);
    return state;
  }

  _append(projectId, state, expectedVersion, actor, facts) {
    const occurredAt = iso(this.now());
    const result = this.ledger.append({
      aggregate_id: projectId,
      aggregate_type: AGGREGATE_TYPE,
      expected_version: expectedVersion ?? state.version,
      events: facts.map(({ type, memory_id, payload }) => ({
        event_id: eventId(projectId, type, memory_id),
        event_type: type,
        schema_version: 1,
        occurred_at: occurredAt,
        correlation_id: `memory:${projectId}`,
        causation_id: `memory:${projectId}:${memory_id}`,
        actor,
        operation_id: null,
        payload: { contract: CONTRACT, memory_id, ...payload },
        evidence_refs: [],
      })),
    });
    this._projection.delete(projectId);
    return result;
  }

  /** Writes one entry. Needs an admitting policy rule and a clean credential scan; `created_at` comes from the clock. */
  write({ rules, approved, actor = DEFAULT_ACTOR, expected_version, ...input }) {
    const entry = normalizeEntry({ ...input, created_at: iso(this.now()) }, { maxTtlSeconds: this.maxTtlSeconds });
    entry.write_policy_ref = admitWrite({ rules, approved });
    assertNoCredential(entry, this.scanCredential);
    const projectId = entry.scope.project_id;
    const state = this._state(projectId);
    if (state.records.has(entry.memory_id)) {
      throw new AgentMemoryError('memory_id is already used in this project', 'AGENT_MEMORY_DUPLICATE', { memory_id: entry.memory_id });
    }
    const facts = [{ type: EVENTS.WRITTEN, memory_id: entry.memory_id, payload: { entry } }];
    if (entry.supersedes !== undefined) {
      if (state.records.get(entry.supersedes)?.status !== 'active') {
        throw new AgentMemoryError('only an active entry can be superseded', 'AGENT_MEMORY_SUPERSEDE_INVALID', {
          memory_id: entry.supersedes,
        });
      }
      facts.push({ type: EVENTS.SUPERSEDED, memory_id: entry.supersedes, payload: { superseded_by: entry.memory_id } });
    }
    this._append(projectId, state, expected_version, actor, facts);
    return Object.freeze({ memory_id: entry.memory_id, write_policy_ref: entry.write_policy_ref });
  }

  /** Records `memory.expired` for every active entry whose TTL has elapsed. Returns the expired ids. */
  sweepExpired(projectId, { actor = DEFAULT_ACTOR } = {}) {
    const state = this._state(projectId);
    const nowMs = this.now();
    const due = [...state.records.values()].filter((record) => record.status === 'active' && this._isExpired(record, nowMs));
    if (due.length === 0) return [];
    const facts = due.map((record) => ({ type: EVENTS.EXPIRED, memory_id: record.entry.memory_id, payload: { expired_at: iso(nowMs) } }));
    this._append(projectId, state, undefined, actor, facts);
    return due.map((record) => record.entry.memory_id);
  }

  /** Explicit operator command: the entry stops being retrievable and the deletion is a ledger event. */
  forget({ project_id: projectId, memory_id: memoryId, actor, reason = 'operator command' }) {
    if (actor?.kind !== 'operator' || typeof actor.id !== 'string') {
      throw new AgentMemoryError('deleting memory requires an operator actor', 'AGENT_MEMORY_OPERATOR_REQUIRED');
    }
    const state = this._state(projectId);
    const record = state.records.get(memoryId);
    if (!record || record.status === 'deleted') {
      throw new AgentMemoryError('memory entry does not exist', 'AGENT_MEMORY_NOT_FOUND', { memory_id: memoryId });
    }
    this._append(projectId, state, undefined, actor, [{ type: EVENTS.DELETED, memory_id: memoryId, payload: { reason } }]);
  }

  _isExpired(record, nowMs) {
    return Date.parse(record.entry.created_at) + record.entry.ttl_seconds * 1000 <= nowMs;
  }

  /** Lists entries of one project with their status; expiry is evaluated against the clock. */
  list(projectId) {
    const nowMs = this.now();
    return [...this._state(projectId).records.values()].map((record) => ({
      memory_id: record.entry.memory_id,
      status: record.status === 'active' && this._isExpired(record, nowMs) ? 'expired' : record.status,
      trust: record.entry.trust,
    }));
  }

  /**
   * Deterministic lexical retrieval. Returns `MemorySource` v2 items (authority `data`, origin `memory`) whose
   * provenance carries the original write. Untrusted entries stay out unless the policy includes them.
   */
  retrieve({ project_id: projectId, query, limit = DEFAULT_LIMIT, include_untrusted: includeUntrusted = false }) {
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new AgentMemoryError('query must be a non-empty string', 'AGENT_MEMORY_INVALID', { field: 'query' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new AgentMemoryError('limit is out of range', 'AGENT_MEMORY_INVALID', { field: 'limit' });
    }
    const terms = tokenize(query);
    const nowMs = this.now();
    const ranked = [];
    for (const record of this._state(projectId).records.values()) {
      const { entry } = record;
      if (record.status !== 'active' || this._isExpired(record, nowMs)) continue;
      if (entry.trust === 'untrusted' && includeUntrusted !== true) continue;
      const score = terms.filter((term) => record.tokens.includes(term)).length;
      if (score > 0) ranked.push({ entry, score });
    }
    ranked.sort(
      (a, b) =>
        b.score - a.score || compareText(b.entry.created_at, a.entry.created_at) || compareText(a.entry.memory_id, b.entry.memory_id),
    );
    const retrievedAt = iso(nowMs);
    return ranked.slice(0, limit).map(({ entry }, index) => ({
      source_ref: `memory://${projectId}/${entry.memory_id}`,
      classification: entry.classification,
      priority: Math.max(0, 100 - index),
      content: entry.content,
      authority: AUTHORITY,
      provenance: {
        origin: 'memory',
        source_ref: `memory://${projectId}/${entry.memory_id}`,
        digest: sha256Text(entry.content),
        retrieved_at: retrievedAt,
        // Memory is never trusted at the context boundary; the stored trust only decides default retrieval.
        trust: 'untrusted',
        transform: [
          { id: `memory.write.${entry.origin}`, version: CONTRACT, input_digest: entry.source_digest },
          { id: 'memory.retrieve', version: '1', input_digest: sha256Text(entry.content) },
        ],
      },
    }));
  }
}

module.exports = { AGGREGATE_TYPE, EVENTS, MemoryStore, foldEvents, tokenize };
