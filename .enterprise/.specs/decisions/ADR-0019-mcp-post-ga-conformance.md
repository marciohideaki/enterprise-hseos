# ADR-0019 — MCP Post-GA Conformance: Manual Subset with SDK Trigger

**Status:** Accepted (ratified 2026-07-15)
**Date:** 2026-07-15
**Owner:** platform-governance
**Affects:** `tools/mcp-*`, `tools/lib/mcp-transport.js`, `tools/lib/mcp-protocol.js`, `.agents/mcp/bundles/`, `test/test-mcp-contract.js`
**Source RFC:** `docs/rfc/2026-07-09-mcp-post-ga-conformance.md`

---

## Context

The four native HSEOS MCP servers (`project-state`, `governance`, `swarm`, `axon-bridge`) are
hand-rolled JSON-RPC 2.0 implementations covering the minimal subset (`initialize`,
`tools/list`, `tools/call`) at protocol revision `2024-11-05`. The **MCP GA of 2026-07-28**
is the largest revision since launch: stateless core, response caching, an extensions
framework, a redesigned Tasks extension, W3C Trace Context in `_meta`, and new
Streamable-HTTP routing headers.

Foundations already landed in cycle 08: `tools/lib/mcp-protocol.js` centralizes
`MCP_PROTOCOL_VERSION` (bumping the revision is a one-line change) and
`test/test-mcp-contract.js` asserts at runtime that all four servers agree on revision,
`serverInfo`, and tool schemas.

## Decision

Adopt **Option B now, with Option C as the standing trigger rule** (per the source RFC):

1. **Keep the manual subset, tracked and contract-tested.** Within 30 days of GA (by
   **2026-08-27**): read the final 2026-07-28 spec diff and implement in
   `mcp-transport.js` only what affects the consumed subset (expected: version negotiation
   fallback, `tools/list` cache metadata passthrough, HTTP routing headers). Bump
   `MCP_PROTOCOL_VERSION` once; the contract test propagates the requirement to all four
   servers.
2. **SDK trigger (Option C):** the first concrete need for resources, prompts, sampling, or
   the Tasks extension in any HSEOS server means that server adopts the official
   `@modelcontextprotocol/sdk`, becoming the reference migration; a follow-up ADR then
   decides whether the remaining three migrate.
3. **Non-goal:** protocol completeness for its own sake — HSEOS adapters consume tools only;
   the governance value lives in the tools, not the transport.

## Consequences

- Zero new runtime dependencies today (preserves the dependency-light, hermetic-test bias).
- Spec tracking remains deliberate and manual, bounded by the consumed subset and enforced
  by the cross-server contract test.
- Anything beyond tools (resources, prompts, Tasks) stays out of reach until the trigger
  fires — accepted trade-off.

## Compliance checkpoints

- **2026-07-28:** MCP GA published — start the spec diff (Cycle 10).
- **2026-08-27:** conformance deadline for the subset implementation.
