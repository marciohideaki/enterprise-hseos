'use strict';

/**
 * Single source of truth for the MCP protocol revision the native HSEOS
 * servers implement. Every server (the three stdio+HTTP servers via
 * tools/lib/mcp-transport.js and the HTTP-only axon-bridge, which carries its
 * own transport) MUST import this constant — test/test-mcp-contract.js fails
 * if any server reports a different revision at runtime.
 *
 * Upgrade path: the MCP 2026-07-28 GA (stateless core, response caching,
 * extensions framework, redesigned Tasks) is tracked in
 * docs/rfc/2026-07-09-mcp-post-ga-conformance.md — bump here once the
 * conformance work lands, never in per-server code.
 */
const MCP_PROTOCOL_VERSION = '2024-11-05';

module.exports = { MCP_PROTOCOL_VERSION };
