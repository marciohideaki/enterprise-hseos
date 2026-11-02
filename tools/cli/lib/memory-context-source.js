'use strict';

const { MemoryStore } = require('../../../packages/agent-memory');
const { AUTHORITY, MAX_CONTENT_BYTES, sha256Text } = require('../../../packages/agent-memory/policy');
const { containsCredential } = require('./campaign-evidence-store');

const MAX_AXON_RESULTS = 10;
const DEFAULT_LIMIT = 5;

function axonItems(result) {
  const list = Array.isArray(result)
    ? result
    : (result?.results ?? result?.memories ?? result?.items ?? (typeof result === 'string' ? [result] : []));
  return Array.isArray(list) ? list : [];
}

function axonText(item) {
  const text = typeof item === 'string' ? item : (item?.content ?? item?.text ?? item?.summary);
  return typeof text === 'string' ? text.trim() : '';
}

/** Governed memory bound to the host ledger, with the repository credential scanner injected. */
function createGovernedMemory({ ledger, now, maxTtlSeconds, approvalVerifier, db = null }) {
  const scanCredential = (text) => containsCredential(text);
  const promotionAttestation = db ? createPromotionAttestation(db) : null;
  return new MemoryStore({ ledger, scanCredential, now, maxTtlSeconds, approvalVerifier, promotionAttestation });
}

/**
 * Host attestation of a promotion: the single-use approval of that exact operation exists, was approved and was consumed
 * (an `execution_approval_uses` row). Reads the same database the ledger lives in; it never writes.
 */
function createPromotionAttestation(db) {
  const statement = db.prepare(
    `SELECT 1 FROM execution_approval_uses u JOIN execution_approvals a ON a.approval_id = u.approval_id
     WHERE u.approval_id = ? AND u.operation_id = ? AND a.operation_id = ? AND a.decision = 'approved'`,
  );
  return ({ approval_id: approvalId, operation_id: operationId }) => statement.get(approvalId, operationId, operationId) !== undefined;
}

/**
 * Collects `memory[]` sources for a context assembly. Governed memory comes first; the optional axon bridge is
 * read-only, untrusted, and only consulted when the policy includes untrusted memory. A missing or failing
 * bridge is a no-op.
 */
async function collectMemorySources({
  store,
  project_id,
  query,
  limit = DEFAULT_LIMIT,
  include_untrusted = false,
  searchProvider = null,
  now = Date.now,
}) {
  const sources = store.retrieve({ project_id, query, limit, include_untrusted }, { boundary: 'context' });
  // The query leaves the process: it never goes to the bridge when it looks like a credential.
  if (include_untrusted !== true || typeof searchProvider !== 'function' || containsCredential(query)) return sources;
  let items;
  try {
    items = axonItems(await searchProvider(query)).slice(0, MAX_AXON_RESULTS);
  } catch {
    return sources;
  }
  const retrievedAt = new Date(now()).toISOString();
  const bridged = [];
  const seen = new Set();
  for (const item of items) {
    const content = axonText(item);
    if (content.length === 0 || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES || containsCredential(content)) continue;
    const digest = sha256Text(content);
    if (seen.has(digest)) continue;
    seen.add(digest);
    bridged.push({
      source_ref: `axon://memory/${digest.slice(0, 16)}`,
      classification: 'internal',
      priority: 0,
      content,
      authority: AUTHORITY,
      provenance: {
        origin: 'mcp',
        source_ref: `axon://memory/${digest.slice(0, 16)}`,
        digest,
        retrieved_at: retrievedAt,
        trust: 'untrusted',
        transform: [{ id: 'memory.axon.search', version: '1', input_digest: sha256Text(query) }],
      },
    });
  }
  return [...sources, ...bridged.slice(0, Math.max(0, limit - sources.length))];
}

const OPERATOR_POLICY_VERSION = 'hseos-operational-v1';

/**
 * Operator-side memory promotion over one ACTIVATED project database. This is host code behind the operator CLI: no MCP
 * tool, task contract or environment reaches it. The single-use approval is issued here from the operator's explicit
 * confirmation, bound to project, memory and content digest, spent by the store inside the promotion transaction and
 * never reusable. `inspect` shows the content and digest; `promote` needs the digest the operator confirmed.
 */
function openOperatorMemory({ databasePath, operator, now = Date.now, ttl_ms = 30_000, id = require('node:crypto').randomUUID }) {
  const fs = require('node:fs');
  const { openOperationalStateDatabase } = require('../../mcp-project-state/lib/operational-state-db');
  const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
  const { ExecutionApprovalStore } = require('../../mcp-project-state/lib/execution-approval-store');
  const { createExecutionEventRegistry } = require('../../lib/governed-execution/event-registry');
  const { createExecutionApprovalVerifier, memoryPromoteOperation } = require('../../../packages/agent-memory');
  if (!fs.existsSync(databasePath)) throw new TypeError(`no state database at ${databasePath}`);
  if (operator?.kind !== 'operator' || typeof operator.id !== 'string') throw new TypeError('an operator identity is required');
  const db = openOperationalStateDatabase(databasePath, { openActivated: true });
  const approvalStore = new ExecutionApprovalStore(db);
  const granted = new Map();
  // The operator CLI is not the task compositor: it builds its own store, over the ledger of the database it opened.
  const store = new MemoryStore({
    ledger: new ExecutionEventLedger(db, { event_registry: createExecutionEventRegistry() }),
    scanCredential: (text) => containsCredential(text),
    now,
    promotionAttestation: createPromotionAttestation(db),
    approvalVerifier: createExecutionApprovalVerifier({
      approvalStore,
      resolveApprovalId: ({ operation_id: operationId }) => granted.get(operationId),
      policyVersion: OPERATOR_POLICY_VERSION,
      now,
    }),
  });
  return Object.freeze({
    inspect: (projectId, memoryId) => store.inspect(projectId, memoryId),
    promote({ project_id: projectId, memory_id: memoryId, content_sha256: digest, reason }) {
      const { operation_id: operationId, resource_scope: resourceScope } = memoryPromoteOperation(projectId, memoryId, digest);
      const approvalId = id();
      const issued = now();
      approvalStore.issue({
        approval_id: approvalId,
        operation_id: operationId,
        authorizer: { id: operator.id, type: 'human' },
        resource_scope: resourceScope,
        issued_at: new Date(issued).toISOString(),
        expires_at: new Date(issued + ttl_ms).toISOString(),
        decision: 'approved',
        policy_version: OPERATOR_POLICY_VERSION,
        evidence_ref: `hseos://operator/memory-promotion/${approvalId}`,
      });
      granted.set(operationId, approvalId);
      try {
        return store.promote({ project_id: projectId, memory_id: memoryId, content_sha256: digest, reason }, { actor: operator });
      } finally {
        granted.delete(operationId);
      }
    },
    close: () => db.close(),
  });
}

module.exports = { collectMemorySources, createGovernedMemory, openOperatorMemory };
