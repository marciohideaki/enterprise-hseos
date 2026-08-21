# `mcp-axon-bridge` — Axon Code-Index Wrapper

> **Status: implemented.** Declared in `.agents/mcp/bundles/extended.yaml`; contract and fallback behavior are covered by `test/test-mcp-axon-bridge.js` and `test/test-mcp-contract.js`.

## Purpose

Provide an HSEOS-shipped wrapper around the `axon` code-indexing binary so projects opt into Axon-powered exploration (`-76-98% tokens` saved per the migration plan research) without depending on a host-machine global install. Resolves binary location via a four-step chain that always degrades gracefully.

## Binary resolver chain

1. `tools/vendor/axon/` — repo-vendored binary, if shipped via release
2. `$AXON_BIN` — explicit env var override
3. `axon` on `$PATH` — global install fallback
4. **No-op fallback** — returns empty results so downstream skills (repo-radar, etc.) degrade to `Read` + `Grep`

This satisfies ADR-0006 P5 (zero global path) and P6 (graceful degradation): the bridge never hard-fails on Axon absence.

## Tools

| Tool | Purpose |
|---|---|
| `code_search` | Semantic + keyword search across the indexed codebase |
| `dep_graph` | Cross-file dependency analysis for a given file or symbol |
| `memory_search` | Cross-session memory query |
| `get_skeleton` | Extract signatures/structure of a file |
| `get_overview` | Project-wide overview |
| `run_pipeline` | Refresh the Axon index |

## Implementation

- `index.js` — bridge entrypoint, talks to upstream Axon binary via stdio
- `lib/binary-resolver.js` — implements the four-step chain
- `lib/no-op-fallback.js` — empty-result responses when binary absent
- `test/test-mcp-axon-bridge.js` exercises the no-binary fallback path.
- `test/test-mcp-contract.js` verifies the shared protocol and tool descriptor contract.

## Acceptance

- [x] Six tool descriptors are exposed by the bridge.
- [x] No-op fallback returns valid MCP responses without throwing.
- [x] Shared MCP contract covers the bridge.
- [ ] Reachable-binary forwarding requires an integration fixture.
