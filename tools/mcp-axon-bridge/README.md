# `mcp-axon-bridge` — Axon Code-Index Wrapper

> **Status: implemented.** Declared in `.agents/mcp/bundles/extended.yaml`; contract and fallback behavior are covered by `test/test-mcp-axon-bridge.js` and `test/test-mcp-contract.js`.

## Purpose

Provide an HSEOS-shipped wrapper around the `axon` code-indexing binary so projects opt into Axon-powered exploration (`-76-98% tokens` saved per the migration plan research) without depending on a host-machine global install. Resolves binary location via a four-step chain that always degrades gracefully.

## Binary resolver chain

1. `tools/vendor/axon/` — repo-vendored binary, if shipped via release
2. `$AXON_BIN` — explicit env var override
3. `axon` on `$PATH` — global install fallback
4. **Unavailable** — every tool fails with an explicit `AXON_UNAVAILABLE` error

The bridge never answers with an empty result that looks like success. Callers distinguish the failure and degrade to `Read` + `Grep` themselves. Error codes (JSON-RPC `-32000`, code prefix in the message):

| Code                | Meaning                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `AXON_UNAVAILABLE`  | no executable axon binary found                                                                          |
| `AXON_INCOMPATIBLE` | binary does not speak MCP over `axon serve`, or lacks the tool; the message carries the detected version |
| `AXON_TOOL_ERROR`   | axon answered with an error (for example, project not indexed)                                           |
| `AXON_TIMEOUT`      | axon did not answer in time                                                                              |

The bridge spawns `axon serve` (MCP stdio), performs the `initialize` handshake and forwards `tools/call` using axon's upstream tool names (`code_search` -> `get_context_capsule`, `dep_graph` -> `get_impact_graph`, `memory_search` -> `search_memory`, `get_skeleton`, `get_overview`, `run_pipeline`).

`code_search` no longer advertises a `limit` argument (it was never forwarded to axon).

## Transport and access control

- Default: **stdio** (stdout carries protocol only; diagnostics go to stderr), like the other HSEOS MCP servers.
- `--http` / `--port=N`: HTTP on `127.0.0.1`. Requires `HSEOS_AXON_BRIDGE_CREDENTIAL` (at least 32 characters) and `Authorization: Bearer <credential>` on every request, including `/health`. Requests with an `Origin` header or a non-loopback `Host` are rejected. Migration: clients that used `http://127.0.0.1:3103/` without credentials must send the bearer header or switch to stdio (`node tools/mcp-axon-bridge/index.js`).

## Tools

| Tool            | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `code_search`   | Semantic + keyword search across the indexed codebase     |
| `dep_graph`     | Cross-file dependency analysis for a given file or symbol |
| `memory_search` | Cross-session memory query                                |
| `get_skeleton`  | Extract signatures/structure of a file                    |
| `get_overview`  | Project-wide overview                                     |
| `run_pipeline`  | Refresh the Axon index                                    |

## Implementation

- `index.js` — bridge entrypoint, talks to the upstream Axon binary via `axon serve` (stdio)
- `lib/binary-resolver.js` — implements the four-step chain
- `test/test-mcp-axon-bridge.js` covers absent, incompatible and compatible axon, plus HTTP authentication and stdio cleanliness.
- `test/test-mcp-contract.js` verifies the shared protocol and tool descriptor contract.

## Acceptance

- [x] Six tool descriptors are exposed by the bridge.
- [x] Absent or incompatible axon is an explicit error.
- [x] Shared MCP contract covers the bridge.
- [x] Reachable-binary forwarding is covered by a controlled fake and by the real binary when present.
