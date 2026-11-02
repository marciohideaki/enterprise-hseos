'use strict';

const { createHash } = require('node:crypto');

const {
  AUTHORITY,
  AgentMemoryError,
  CONTRACT,
  MAX_TTL_SECONDS,
  admitWrite,
  assertEntryInputFields,
  assertNoCredential,
  isPromotedEntry,
  memoryDeleteOperation,
  memoryPromoteOperation,
  normalizeActor,
  normalizeEntry,
  normalizeReason,
  PROMOTE_POLICY_REF,
  PROMOTED_SUFFIX,
  promotedSourceRef,
  requireIdentifier,
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
          promotion: event.payload.promotion ?? null,
          operation_id: event.operation_id ?? null,
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
   * `approvalVerifier` is host code that consumes the single-use approval backing a deletion and returns `true`.
   * @param {{ledger: object, scanCredential: (text: string) => boolean, now?: () => number, maxTtlSeconds?: number, approvalVerifier?: Function}} options
   */
  constructor({
    ledger,
    scanCredential,
    now = Date.now,
    maxTtlSeconds = MAX_TTL_SECONDS,
    approvalVerifier = null,
    promotionAttestation = null,
  }) {
    if (!ledger || typeof ledger.append !== 'function' || typeof ledger.readStream !== 'function') {
      throw new AgentMemoryError('memory requires the execution ledger', 'AGENT_MEMORY_LEDGER_REQUIRED');
    }
    this.ledger = ledger;
    this.scanCredential = scanCredential;
    this.now = now;
    this.maxTtlSeconds = maxTtlSeconds;
    this.approvalVerifier = approvalVerifier;
    this.promotionAttestation = promotionAttestation;
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
      events: facts.map(({ type, memory_id, payload, operation_id: operationId = null }) => ({
        event_id: eventId(projectId, type, memory_id),
        event_type: type,
        schema_version: 1,
        occurred_at: occurredAt,
        correlation_id: `memory:${projectId}`,
        causation_id: `memory:${projectId}:${memory_id}`,
        actor,
        operation_id: operationId,
        payload: { contract: CONTRACT, memory_id, ...payload },
        evidence_refs: [],
      })),
    });
    this._projection.delete(projectId);
    return result;
  }

  /**
   * Writes one entry. `input` is the entry as the caller proposes it; `host` is what only the trusted host may
   * supply: the policy `rules`, the human `approved` flag, the authenticated `actor` and the CAS `expected_version`.
   * `created_at` comes from the clock, and `origin: operator` needs an operator actor.
   */
  write(input, { rules, approved, actor = DEFAULT_ACTOR, execution_mode, expected_version } = {}) {
    assertEntryInputFields(input);
    const entry = normalizeEntry({ ...input, created_at: iso(this.now()) }, { maxTtlSeconds: this.maxTtlSeconds });
    if (entry.source_digest !== sha256Text(entry.content)) {
      throw new AgentMemoryError('source_digest does not match the content', 'AGENT_MEMORY_INVALID', { field: 'source_digest' });
    }
    if (entry.memory_id.endsWith(PROMOTED_SUFFIX)) {
      throw new AgentMemoryError('the :promoted suffix is reserved for operator promotions', 'AGENT_MEMORY_ID_RESERVED', {
        memory_id: entry.memory_id,
      });
    }
    const resolvedActor = normalizeActor(actor, this.scanCredential);
    if (entry.origin === 'operator' && resolvedActor.kind !== 'operator') {
      throw new AgentMemoryError('operator origin needs an operator actor', 'AGENT_MEMORY_ORIGIN_ACTOR_MISMATCH', { origin: entry.origin });
    }
    entry.write_policy_ref = admitWrite({ rules, approved, execution_mode });
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
    this._append(projectId, state, expected_version, resolvedActor, facts);
    return Object.freeze({ memory_id: entry.memory_id, write_policy_ref: entry.write_policy_ref });
  }

  /** Records `memory.expired` for every active entry whose TTL has elapsed. Returns the expired ids. */
  sweepExpired(projectId, { actor = DEFAULT_ACTOR } = {}) {
    requireIdentifier(projectId, 'project_id');
    const resolvedActor = normalizeActor(actor, this.scanCredential);
    const state = this._state(projectId);
    const nowMs = this.now();
    const due = [...state.records.values()].filter((record) => record.status === 'active' && this._isExpired(record, nowMs));
    if (due.length === 0) return [];
    const facts = due.map((record) => ({ type: EVENTS.EXPIRED, memory_id: record.entry.memory_id, payload: { expired_at: iso(nowMs) } }));
    this._append(projectId, state, undefined, resolvedActor, facts);
    return due.map((record) => record.entry.memory_id);
  }

  /**
   * Explicit operator command (`host.actor` must be the authenticated operator) backed by a single-use approval bound
   * to this memory (`memory.delete` requires approval in the execution contract). The approval is verified by the
   * host-injected `approvalVerifier` (which must call `onConsumed` inside its consuming transaction), never read from `input`; without one the deletion is refused. The entry stops
   * being retrievable and the deletion is a ledger event. The ledger is append-only, so the content itself stays in earlier events.
   */
  forget({ project_id: projectId, memory_id: memoryId, reason = 'operator command' }, { actor } = {}) {
    requireIdentifier(projectId, 'project_id');
    requireIdentifier(memoryId, 'memory_id');
    if (actor?.kind !== 'operator') {
      throw new AgentMemoryError('deleting memory requires an operator actor', 'AGENT_MEMORY_OPERATOR_REQUIRED');
    }
    const resolvedActor = normalizeActor(actor, this.scanCredential);
    const safeReason = normalizeReason(reason, this.scanCredential);
    const state = this._state(projectId);
    const record = state.records.get(memoryId);
    if (!record || record.status === 'deleted') {
      throw new AgentMemoryError('memory entry does not exist', 'AGENT_MEMORY_NOT_FOUND', { memory_id: memoryId });
    }
    // The approval is consumed and the deletion appended in one transaction: no append, no spent approval.
    this._deleteWithApproval(projectId, memoryId, resolvedActor, (approval, operationId) =>
      this._append(projectId, state, undefined, resolvedActor, [
        {
          type: EVENTS.DELETED,
          memory_id: memoryId,
          operation_id: operationId,
          payload: { reason: safeReason, ...(approval?.approval_id ? { approval_id: approval.approval_id } : {}) },
        },
      ]),
    );
  }

  _deleteWithApproval(projectId, memoryId, actor, append) {
    this._withApproval(memoryDeleteOperation(projectId, memoryId), 'deleting memory', actor, append);
  }

  _withApproval({ operation, operation_id, resource_scope }, what, actor, append) {
    const refuse = (cause) => {
      throw new AgentMemoryError(`${what} needs a single-use approval for this operation`, 'AGENT_MEMORY_APPROVAL_REQUIRED', {
        operation: operation_id,
        ...(cause ? { cause } : {}),
      });
    };
    if (typeof this.approvalVerifier !== 'function') refuse();
    let appended = false;
    let appendFailure = null;
    const onConsumed = (approval) => {
      try {
        append(approval, operation_id);
        appended = true;
      } catch (error) {
        appendFailure = error;
        throw error;
      }
    };
    let confirmed;
    try {
      confirmed = this.approvalVerifier({ operation, operation_id, resource_scope, actor, onConsumed });
    } catch (error) {
      if (appendFailure) throw appendFailure;
      refuse(typeof error?.code === 'string' ? error.code : 'VERIFIER_FAILED');
    }
    if (confirmed !== true || !appended) refuse();
  }

  /**
   * Operator command that lifts one agent note to `trusted`. The note is never edited (the ledger is append-only): the
   * promotion is a NEW operator-origin entry with the same content that supersedes the original and whose `source_ref`
   * names it at the content digest. `content_sha256` is the digest the operator was shown; it must equal the digest of
   * the stored content, and the single-use approval is bound to project, memory and that digest. The content is scanned
   * for credentials again. This method is host code: it is not a contract capability and no tool reaches it.
   */
  promote({ project_id: projectId, memory_id: memoryId, content_sha256: contentSha256, reason = 'operator promotion' }, { actor } = {}) {
    requireIdentifier(projectId, 'project_id');
    requireIdentifier(memoryId, 'memory_id');
    if (actor?.kind !== 'operator') {
      throw new AgentMemoryError('promoting memory requires an operator actor', 'AGENT_MEMORY_OPERATOR_REQUIRED');
    }
    const resolvedActor = normalizeActor(actor, this.scanCredential);
    const safeReason = normalizeReason(reason, this.scanCredential);
    const state = this._state(projectId);
    const record = state.records.get(memoryId);
    const nowMs = this.now();
    if (!record || record.status !== 'active' || this._isExpired(record, nowMs)) {
      throw new AgentMemoryError('only an active memory entry of this project can be promoted', 'AGENT_MEMORY_NOT_FOUND', {
        memory_id: memoryId,
      });
    }
    const original = record.entry;
    if (original.trust === 'trusted') {
      throw new AgentMemoryError('the memory entry is already trusted', 'AGENT_MEMORY_PROMOTE_INVALID', { memory_id: memoryId });
    }
    const digest = sha256Text(original.content);
    if (contentSha256 !== digest) {
      throw new AgentMemoryError('the approved digest does not match the stored content', 'AGENT_MEMORY_DIGEST_MISMATCH', {
        memory_id: memoryId,
      });
    }
    assertNoCredential(original, this.scanCredential);
    // The suffix is reserved (see `write`), and the original must be active: the promoted id cannot be taken yet.
    const promotedId = `${memoryId}${PROMOTED_SUFFIX}`;
    const remaining = Math.ceil((Date.parse(original.created_at) + original.ttl_seconds * 1000 - nowMs) / 1000);
    const promoted = normalizeEntry(
      {
        memory_id: promotedId,
        scope: { project_id: projectId },
        content: original.content,
        origin: 'operator',
        trust: 'trusted',
        classification: original.classification,
        source_ref: promotedSourceRef(projectId, memoryId, digest),
        source_digest: digest,
        ttl_seconds: Math.max(1, remaining),
        supersedes: memoryId,
        write_policy_ref: PROMOTE_POLICY_REF,
        created_at: iso(nowMs),
      },
      { maxTtlSeconds: this.maxTtlSeconds },
    );
    // The approval is consumed and both events appended in one transaction: no append, no spent approval.
    this._withApproval(memoryPromoteOperation(projectId, memoryId, digest), 'promoting memory', resolvedActor, (approval, operationId) =>
      this._append(projectId, state, undefined, resolvedActor, [
        {
          type: EVENTS.WRITTEN,
          memory_id: promotedId,
          operation_id: operationId,
          payload: {
            entry: promoted,
            promotion: {
              promoted_from: memoryId,
              promoted_by: resolvedActor.id,
              reason: safeReason,
              content_sha256: digest,
              ...(approval?.approval_id ? { approval_id: approval.approval_id } : {}),
            },
          },
        },
        { type: EVENTS.SUPERSEDED, memory_id: memoryId, operation_id: operationId, payload: { superseded_by: promotedId } },
      ]),
    );
    return Object.freeze({ memory_id: promotedId, promoted_from: memoryId, content_sha256: digest });
  }

  /** What an operator is shown before promoting: the stored content and its digest. */
  inspect(projectId, memoryId) {
    requireIdentifier(projectId, 'project_id');
    requireIdentifier(memoryId, 'memory_id');
    const record = this._state(projectId).records.get(memoryId);
    if (!record) throw new AgentMemoryError('memory entry does not exist', 'AGENT_MEMORY_NOT_FOUND', { memory_id: memoryId });
    const { entry } = record;
    return Object.freeze({
      memory_id: memoryId,
      status: record.status,
      origin: entry.origin,
      trust: entry.trust,
      content: entry.content,
      content_sha256: sha256Text(entry.content),
    });
  }

  /**
   * A promotion is trusted only if the STORE can prove it: the entry has the exact promotion shape, supersedes a memory
   * that exists, its event carries the promotion facts of that memory, and the host attests that the single-use approval
   * of that very operation was consumed. Without an attestation hook nothing is trusted (fail closed).
   */
  _isAttestedPromotion(record, projectId, records) {
    const { entry } = record;
    if (!isPromotedEntry(entry, projectId) || typeof this.promotionAttestation !== 'function') return false;
    const { promotion } = record;
    if (!records.has(entry.supersedes) || promotion?.promoted_from !== entry.supersedes) return false;
    if (promotion.content_sha256 !== entry.source_digest || typeof promotion.approval_id !== 'string') return false;
    const { operation_id: operationId } = memoryPromoteOperation(projectId, entry.supersedes, entry.source_digest);
    return (
      record.operation_id === operationId &&
      this.promotionAttestation({ approval_id: promotion.approval_id, operation_id: operationId }) === true
    );
  }

  _isExpired(record, nowMs) {
    return Date.parse(record.entry.created_at) + record.entry.ttl_seconds * 1000 <= nowMs;
  }

  /** Lists entries of one project with their status; expiry is evaluated against the clock. */
  list(projectId) {
    requireIdentifier(projectId, 'project_id');
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
  retrieve(
    { project_id: projectId, query, limit = DEFAULT_LIMIT, include_untrusted: includeUntrusted = false },
    { boundary = 'tool' } = {},
  ) {
    requireIdentifier(projectId, 'project_id');
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new AgentMemoryError('query must be a non-empty string', 'AGENT_MEMORY_INVALID', { field: 'query' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new AgentMemoryError('limit is out of range', 'AGENT_MEMORY_INVALID', { field: 'limit' });
    }
    const terms = tokenize(query);
    const nowMs = this.now();
    const ranked = [];
    const { records } = this._state(projectId);
    for (const record of records.values()) {
      const { entry } = record;
      if (record.status !== 'active' || this._isExpired(record, nowMs)) continue;
      if (entry.trust === 'untrusted' && includeUntrusted !== true) continue;
      const score = terms.filter((term) => record.tokens.includes(term)).length;
      if (score > 0) ranked.push({ entry, score, record });
    }
    ranked.sort(
      (a, b) =>
        b.score - a.score || compareText(b.entry.created_at, a.entry.created_at) || compareText(a.entry.memory_id, b.entry.memory_id),
    );
    const retrievedAt = iso(nowMs);
    return ranked.slice(0, limit).map(({ entry, record }, index) => {
      const promoted = boundary === 'context' && this._isAttestedPromotion(record, projectId, records);
      return {
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
          // Memory is untrusted at every boundary except a task context, and there only an operator promotion is trusted.
          trust: promoted ? 'trusted' : 'untrusted',
          transform: [
            { id: `memory.write.${entry.origin}`, version: CONTRACT, input_digest: entry.source_digest },
            ...(promoted ? [{ id: 'memory.promote', version: CONTRACT, input_digest: sha256Text(entry.content) }] : []),
            { id: 'memory.retrieve', version: '1', input_digest: sha256Text(entry.content) },
          ],
        },
      };
    });
  }
}

module.exports = { AGGREGATE_TYPE, EVENTS, MemoryStore, foldEvents, tokenize };
