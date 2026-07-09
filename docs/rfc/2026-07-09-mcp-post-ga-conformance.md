# RFC — MCP Post-GA Conformance Plan for the Native Servers

> **Status:** Proposed (promote to an ADR after human review) · **Date:** 2026-07-09
> **Owner:** platform-governance · **Affects:** `tools/mcp-*`, `tools/lib/mcp-transport.js`, `.agents/mcp/bundles/`

## Problem

The four native HSEOS MCP servers (`project-state`, `governance`, `swarm`, `axon-bridge`) are
hand-rolled JSON-RPC 2.0 implementations covering the minimal subset (`initialize`,
`tools/list`, `tools/call`) at protocol revision `2024-11-05`. The **MCP 2026-07-28 GA**
(release candidate locked 2026-05-21) is the largest revision since launch: stateless core,
response caching (`ttlMs`/`cacheScope`), an extensions framework, a redesigned Tasks
extension, W3C Trace Context in `_meta`, and new Streamable-HTTP routing headers.

Two structural risks existed before this RFC's companion changes: the protocol revision was
hardcoded in two independent places (shared transport + axon-bridge's own transport), and
nothing asserted the four servers agree with each other.

## Already landed (cycle 08, alongside this RFC)

- `tools/lib/mcp-protocol.js` — single source of truth for `MCP_PROTOCOL_VERSION`; both
  transports import it. Bumping the revision is now a one-line change.
- `test/test-mcp-contract.js` — cross-server contract in `npm test`: all four servers must
  report the identical protocol revision at runtime (stdio-probed ×3, HTTP-probed ×1),
  return `serverInfo`, and expose uniquely-named tools with `name`/`description`/`inputSchema`.

## Options for GA adoption

### A — Adopt the official `@modelcontextprotocol/sdk`
*Pros:* protocol completeness (resources, prompts, Tasks, caching negotiated for free);
spec tracking outsourced to the SDK; stateless-core semantics handled upstream.
*Cons:* new runtime dependency in a deliberately dependency-light core (P5/hermetic bias);
refactor of 4 servers + their 6 test suites; the SDK's transport abstractions would replace
`mcp-transport.js` (and axon-bridge needs its HTTP-only mode preserved); HSEOS adapters
today only consume the tools subset — most SDK surface would be dead weight.

### B — Keep the manual subset, tracked and contract-tested *(recommended, short term)*
*Pros:* zero new dependencies; the emitted surface equals the consumed surface; version is
centralized and contract-enforced; upgrade cost proportional to what HSEOS actually uses.
*Cons:* spec tracking is manual — each GA change relevant to the subset (e.g. the
`Mcp-Method`/`Mcp-Name` HTTP headers for the streamable transport, cache metadata on
`tools/list` results) must be implemented deliberately; anything beyond tools (resources,
prompts, Tasks) stays out of reach until revisited.

### C — Hybrid
Keep B for the four existing servers; any NEW server (or the first one that needs
resources/prompts/Tasks) starts on the official SDK, making it the reference migration.

## Recommendation

**B now, C as the trigger rule.** Concretely:

1. **Within 30 days of GA (by 2026-08-27):** read the final 2026-07-28 spec diff; implement
   in `mcp-transport.js` only what affects the subset (expected: version negotiation
   fallback, `tools/list` cache metadata passthrough, HTTP routing headers). Bump
   `MCP_PROTOCOL_VERSION` once; the contract test propagates the requirement to all four.
2. **Trigger for A/C:** the first concrete need for resources, prompts, sampling, or the
   Tasks extension in any HSEOS server → that server adopts the official SDK (option C),
   and a follow-up ADR decides whether the remaining three migrate.
3. **Non-goal:** chasing protocol completeness for its own sake — HSEOS adapters consume
   tools only; the governance value lives in the tools, not the transport.

## Decision requested

Ratify B-with-C-trigger as the standing policy (promote this RFC to an Accepted ADR), or
direct an immediate SDK migration (option A) instead.
