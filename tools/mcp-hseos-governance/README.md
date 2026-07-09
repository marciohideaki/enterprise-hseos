# `mcp-hseos-governance` — HSEOS Governance MCP Server

> **Status: implemented.** All five tools live, covered by `test/test-mcp-hseos-governance.js` in `npm test`. Declared in `.agents/mcp/bundles/core.yaml`.

## Purpose

Expose HSEOS governance queries via the Model Context Protocol so any MCP-aware coding agent — not only the original platform — can read constitution articles, validate ADR requirements, and check agent authorities without re-loading the full `.enterprise/.specs/` tree on every call.

## Tools

| Tool | Input | Output |
|---|---|---|
| `query_constitution` | `{ article: string }` | Article text + paths |
| `validate_adr` | `{ change_kind: string }` | `{ required: bool, reason: string }` |
| `check_authority` | `{ agent_code: string }` | `authority.md + constraints.md` content |
| `list_skills` | `{ filter?: string, tier?: 1\|2 }` | Skill catalog (id, description, tier) |
| `list_workflows` | `{ profile?: string }` | Workflow catalog (id, owner, phases) |

## Why an MCP server, not a Bash script

Bash scripts only work in shell-capable adapter environments. An MCP server is consumable by every MCP-aware coding agent in the 2026 ecosystem (12,000+ servers reachable). Tool calls are also cacheable on the host side — far cheaper than re-reading `.enterprise/.specs/` markdown on every invocation.

## Implementation

- `index.js` — MCP server entrypoint. Hand-rolled JSON-RPC 2.0 over the shared
  `tools/lib/mcp-transport.js` (stdio + HTTP); does **not** use `@modelcontextprotocol/sdk`.
  Supports `initialize`, `tools/list`, `tools/call` (protocolVersion `2024-11-05`).
- `tools/<tool-name>.js` — one file per exposed tool, loaded dynamically
- `lib/spec-reader.js` — reads `.enterprise/.specs/` once per tool call, caches in-memory
- Test: `test/test-mcp-hseos-governance.js` — protocol round-trip (initialize, list_tools, call_tool with each tool)

## Acceptance

- [x] All five tools implemented and tested
- [ ] `hseos mcp doctor` (Wave 6) reports server reachable
- [ ] Published as `@hseos/mcp-server-governance` on npm and Smithery
