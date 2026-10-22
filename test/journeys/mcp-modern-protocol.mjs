// Modern (2026-07-28) MCP wire helpers for mcp-journey.mjs --mode modern. Pure functions plus the constants read from the
// INSTALLED package (the journey never imports from the checkout): the meta keys and the protocol version come from
// node_modules/hseos/tools/lib, so a rename in the package breaks the journey instead of silently diverging.
import { createRequire } from 'node:module';
import path from 'node:path';

export const LEGACY_COMPAT_VERSIONS = ['2024-11-05', '2025-06-18', '2025-11-25'];
export const ELICITATION = { elicitation: {} };
export const ACCEPT = { confirm: { action: 'accept', content: { approved: true } } };
export const DECLINE = { confirm: { action: 'decline' } };

const parseText = (result) => {
  try {
    return JSON.parse(result.content[0].text);
  } catch {
    return;
  }
};

export function loadModernProtocol(pkgRoot) {
  const requireFrom = createRequire(path.join(pkgRoot, 'package.json'));
  const adapter = requireFrom('./tools/lib/mcp-2026-adapter.js');
  const { MCP_MODERN_PROTOCOL_VERSION: VERSION } = requireFrom('./tools/lib/mcp-protocol.js');

  /** params with the per-request _meta the modern protocol requires (no session: every request carries it). */
  const withMeta = (params = {}, { capabilities = ELICITATION, key } = {}) => ({
    ...params,
    _meta: {
      ...params._meta,
      [adapter.PROTOCOL_VERSION_META_KEY]: VERSION,
      [adapter.CLIENT_INFO_META_KEY]: { name: 'mcp-journey-modern', version: '1.0.0' },
      [adapter.CLIENT_CAPABILITIES_META_KEY]: capabilities,
      ...(key ? { [adapter.HSEOS_IDEMPOTENCY_META_KEY]: key } : {}),
    },
  });

  /** HTTP routing headers: Mcp-Name is only sent for named operations (tools/call). */
  const httpHeaders = (method, name) => ({
    'content-type': 'application/json',
    'mcp-protocol-version': VERSION,
    'mcp-method': method,
    ...(name ? { 'mcp-name': name } : {}),
  });

  /**
   * Maps a modern tools/call reply to the shape the legacy journey judges, WITHOUT loosening anything:
   * - envelope ok:true  -> result.content[0].text = JSON of data.result (the same body the legacy server returned);
   * - envelope ok:false -> a JSON-RPC-style error carrying the DOMAIN code (string) and message, marked `domain: true`;
   * - JSON-RPC errors (schema, unknown tool, headers) and unknown shapes pass through untouched.
   * The raw envelope stays in `result.envelope` / `error.envelope` for evidence.
   */
  const normalize = (method, resp) => {
    if (!resp || resp === 'TIMEOUT' || resp.error || method !== 'tools/call' || !resp.result) return resp;
    const envelope = resp.result.structuredContent ?? parseText(resp.result);
    if (!envelope || typeof envelope.ok !== 'boolean') return resp;
    if (envelope.ok) {
      return {
        jsonrpc: resp.jsonrpc,
        id: resp.id,
        result: { content: [{ type: 'text', text: JSON.stringify(envelope.data?.result ?? null) }], isError: false, envelope },
      };
    }
    return {
      jsonrpc: resp.jsonrpc,
      id: resp.id,
      error: { code: envelope.error?.code, message: envelope.error?.message, domain: true, envelope },
    };
  };

  /** Shape of a governed envelope (schema_version, operation id, evidence) used by the contract step. */
  const envelopeProblems = (resp) => {
    const envelope = resp?.result?.envelope;
    if (!envelope) return ['no envelope'];
    const problems = [];
    if (envelope.schema_version !== 1) problems.push(`schema_version=${envelope.schema_version}`);
    if (typeof envelope.data?.operation_id !== 'string') problems.push('no data.operation_id');
    if (!Array.isArray(envelope.evidence)) problems.push('evidence is not an array');
    if (!Array.isArray(envelope.warnings)) problems.push('warnings is not an array');
    return problems;
  };

  return { VERSION, withMeta, httpHeaders, normalize, envelopeProblems };
}
