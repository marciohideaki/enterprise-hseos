# `mcp-axon-bridge` — Axon Code-Index Wrapper

> **Status: scaffolded.** Implementation lands as a follow-up PR within Wave 3. Declared in `.agents/mcp/bundles/extended.yaml`.

## Purpose

Provide an HSEOS-shipped wrapper around the `axon` code-indexing binary so projects opt into Axon-powered exploration (`-76-98% tokens` saved per the migration plan research) without depending on a host-machine global install. Resolves binary location via a four-step chain that always degrades gracefully.

## Binary resolver chain

1. `tools/vendor/axon/` — repo-vendored binary, if shipped via release
2. `$AXON_BIN` — explicit env var override
3. `axon` on `$PATH` — global install fallback
4. **No-op fallback** — returns empty results so downstream skills (repo-radar, etc.) degrade to `Read` + `Grep`

This satisfies ADR-0006 P5 (zero global path) and P6 (graceful degradation): the bridge never hard-fails on Axon absence.

## Tools (planned, mirroring upstream Axon MCP API)

| Tool | Purpose |
|---|---|
| `code_search` | Semantic + keyword search across the indexed codebase |
| `dep_graph` | Cross-file dependency analysis for a given file or symbol |
| `memory_search` | Cross-session memory query |
| `get_skeleton` | Extract signatures/structure of a file |
| `get_overview` | Project-wide overview |
| `run_pipeline` | Refresh the Axon index |

## Implementation plan

- `index.js` — bridge entrypoint, talks to upstream Axon binary via stdio
- `lib/binary-resolver.js` — implements the four-step chain
- `lib/no-op-fallback.js` — empty-result responses when binary absent
- Test: `test/test-mcp-axon-bridge.js` — mocks the upstream binary, asserts fallback path returns empty cleanly

## Acceptance

- [ ] All six tools forwarded when binary is reachable
- [ ] No-op fallback returns valid empty MCP responses (never throws)
- [ ] `hseos mcp doctor` reports either reachable or fallback-active (never error)
- [ ] Published as `@hseos/mcp-server-axon-bridge` on npm and Smithery
