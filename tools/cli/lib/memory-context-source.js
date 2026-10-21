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
function createGovernedMemory({ ledger, now, maxTtlSeconds, approvalVerifier }) {
  return new MemoryStore({ ledger, scanCredential: (text) => containsCredential(text), now, maxTtlSeconds, approvalVerifier });
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
  const sources = store.retrieve({ project_id, query, limit, include_untrusted });
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

module.exports = { collectMemorySources, createGovernedMemory };
