'use strict';

const { createHash } = require('node:crypto');

const { AUTHORITY_RANK, DIRECTIVE_ORIGINS, UNTRUSTED_ORIGINS, deepFreeze, minAuthority } = require('../agent-runtime-contracts');

class ContextAuthorityError extends Error {
  constructor(message, code = 'AGENT_CONTEXT_AUTHORITY_INVALID', details = {}) {
    super(message);
    this.name = 'ContextAuthorityError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

// Layer -> the only authority that layer can carry and the origin v1 inputs are read as.
const LAYERS = deepFreeze({
  instructions: { authority: 'directive', origin: 'config', trusted: true },
  current_turn: { authority: 'operator', origin: 'operator', trusted: false },
  runtime_context: { authority: 'data', origin: 'config', trusted: false },
  references: { authority: 'data', origin: 'tool', trusted: false },
  memory: { authority: 'data', origin: 'memory', trusted: false },
  media: { authority: 'data', origin: 'tool', trusted: false },
});

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sourceText(source) {
  return source.content ?? source.message?.content ?? '';
}

function reject(code, message, source, layer) {
  throw new ContextAuthorityError(message, code, { source_ref: source.source_ref, layer });
}

/**
 * Validates one source declared in a layer and returns its resolved { authority, provenance }.
 * A source without `authority`/`provenance` is read as v1 and derived from its layer; a v2 source is checked
 * on the boundary, before any assembly, and can only ever carry the authority its layer allows.
 */
function resolveSourceAuthority(layer, source, { retrieved_at }) {
  const rule = LAYERS[layer];
  if (!rule) throw new ContextAuthorityError(`unknown context layer: ${layer}`, 'AGENT_CONTEXT_AUTHORITY_INVALID');
  const declared = source.authority !== undefined || source.provenance !== undefined;
  if (!declared) {
    const authority = rule.authority;
    const provenance = {
      origin: rule.origin,
      source_ref: source.source_ref,
      digest: sha256Text(sourceText(source)),
      retrieved_at,
      trust: rule.trusted ? 'trusted' : 'untrusted',
      transform: [],
    };
    return { authority, provenance, declared: false };
  }
  if (source.authority === undefined || source.provenance === undefined) {
    reject('AGENT_CONTEXT_PROVENANCE_MISSING', 'a v2 source requires both authority and provenance', source, layer);
  }
  const { authority, provenance } = source;
  if (AUTHORITY_RANK[authority] > AUTHORITY_RANK[rule.authority]) {
    reject('AGENT_CONTEXT_AUTHORITY_ESCALATION', `${authority} authority is not allowed in ${layer}`, source, layer);
  }
  if (layer === 'instructions' && authority !== 'directive') {
    reject('AGENT_CONTEXT_AUTHORITY_INVALID', 'instruction layers carry directive authority only', source, layer);
  }
  if (authority === 'directive') {
    if (!DIRECTIVE_ORIGINS.includes(provenance.origin) || provenance.trust !== 'trusted') {
      reject('AGENT_CONTEXT_AUTHORITY_ESCALATION', 'directive authority requires a trusted config or operator origin', source, layer);
    }
    if (provenance.transform.length > 0) {
      reject('AGENT_CONTEXT_AUTHORITY_ESCALATION', 'a transformed source cannot hold directive authority', source, layer);
    }
  }
  if (authority === 'operator' && (layer !== 'current_turn' || provenance.origin !== 'operator')) {
    reject(
      'AGENT_CONTEXT_AUTHORITY_ESCALATION',
      'operator authority is valid only for the current turn from the operator origin',
      source,
      layer,
    );
  }
  // Data layers and media can only be declared untrusted: a trusted label is refused, never silently downgraded.
  if (provenance.trust !== 'untrusted' && (rule.authority === 'data' || UNTRUSTED_ORIGINS.includes(provenance.origin))) {
    reject('AGENT_CONTEXT_TRUST_ESCALATION', `${layer} content must be declared untrusted`, source, layer);
  }
  if (source.source_ref !== provenance.source_ref) {
    reject('AGENT_CONTEXT_PROVENANCE_MISSING', 'provenance does not describe this source', source, layer);
  }
  if (layer !== 'media' && provenance.digest !== sha256Text(sourceText(source))) {
    reject('AGENT_CONTEXT_PROVENANCE_DIGEST_MISMATCH', 'provenance digest does not match the source content', source, layer);
  }
  return { authority, provenance, declared: true };
}

/** A transformation (summary, truncation, OCR, resize) can keep the minimum input authority, never raise it. */
function deriveTransformedAuthority(inputAuthorities, requested = null) {
  const derived = minAuthority(inputAuthorities);
  if (requested !== null && AUTHORITY_RANK[requested] > AUTHORITY_RANK[derived]) {
    throw new ContextAuthorityError(
      `transformation cannot raise authority from ${derived} to ${requested}`,
      'AGENT_CONTEXT_AUTHORITY_ESCALATION',
    );
  }
  return requested ?? derived;
}

/**
 * Resolves every source of an assembly input. Returns a Map(source_ref -> resolved) and whether any source
 * declared v2 authority (which selects the v2 `context.assembled` payload).
 */
function resolveInputAuthority(input) {
  const retrievedAt = input.occurred_at;
  const resolved = new Map();
  let v2 = false;
  const visit = (layer, sources) => {
    for (const source of sources) {
      const entry = resolveSourceAuthority(layer, source, { retrieved_at: retrievedAt });
      v2 ||= entry.declared;
      resolved.set(source.source_ref, { layer, ...entry });
    }
  };
  for (const sources of Object.values(input.instructions)) visit('instructions', sources);
  visit('runtime_context', input.runtime_context);
  visit('references', input.references);
  visit('memory', input.memory);
  // A media descriptor always declares its own authority and provenance fields (media-source v1).
  visit(
    'media',
    input.media.map((media) => ({
      source_ref: media.source_ref,
      authority: media.authority,
      provenance: {
        origin: media.origin,
        source_ref: media.source_ref,
        digest: media.digest,
        retrieved_at: retrievedAt,
        trust: media.trust,
        transform: media.transform,
      },
    })),
  );
  visit('current_turn', [input.current_turn]);
  return { resolved, v2 };
}

module.exports = {
  ContextAuthorityError,
  deriveTransformedAuthority,
  resolveInputAuthority,
  resolveSourceAuthority,
  sha256Text,
};
