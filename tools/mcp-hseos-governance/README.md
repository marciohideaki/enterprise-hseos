# `mcp-hseos-governance` — HSEOS Governance MCP Server

> **Status: implemented.** Five portable tools are always usable. Nine additional read-only
> managed-shadow tools are declared by the server and require the project-local optional control
> plane configuration when called. The server is declared in `.agents/mcp/bundles/core.yaml` and
> covered by the MCP and managed-governance suites in `npm test`.

## Purpose

Expose HSEOS governance queries via the Model Context Protocol so any MCP-aware coding agent — not only the original platform — can read constitution articles, validate ADR requirements, and check agent authorities without re-loading the full `.enterprise/.specs/` tree on every call.

## Tools

| Tool                 | Input                              | Output                                  |
| -------------------- | ---------------------------------- | --------------------------------------- |
| `query_constitution` | `{ article: string }`              | Article text + paths                    |
| `validate_adr`       | `{ change_kind: string }`          | `{ required: bool, reason: string }`    |
| `check_authority`    | `{ agent_code: string }`           | `authority.md + constraints.md` content |
| `list_skills`        | `{ filter?: string, tier?: 1\|2 }` | Skill catalog (id, description, tier)   |
| `list_workflows`     | `{ profile?: string }`             | Workflow catalog (id, owner, phases)    |

Managed-shadow queries use the same project-local MCP server and the loopback endpoint in
`.hseos/config/managed-governance.json`:

| Tool                               | Purpose                                                                |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `get_effective_governance_context` | Read the active structured catalog projection                          |
| `evaluate_governed_action`         | Evaluate a shadow action without changing local authority              |
| `explain_governance_decision`      | Explain a shadow decision                                              |
| `get_governance_artifact`          | Read one projected artifact                                            |
| `get_governance_release`           | Read one immutable release when published                              |
| `diff_governance_releases`         | Compare two published releases                                         |
| `verify_governance_snapshot`       | Verify a supplied snapshot reference                                   |
| `get_governance_session_status`    | Read sidecar and projection readiness                                  |
| `get_governance_session_preflight` | Compare local and remote Constitution digests without persisting state |

## Why an MCP server, not a Bash script

Bash scripts only work in shell-capable adapter environments. The MCP server gives MCP-aware agents
a typed, bounded query surface without requiring the full governance tree to be loaded for every
focused lookup. Markdown remains the portable source and session bootstrap authority.

## Implementation

- `index.js` — MCP server entrypoint. Hand-rolled JSON-RPC 2.0 over the shared
  `tools/lib/mcp-transport.js` (stdio + HTTP); does **not** use `@modelcontextprotocol/sdk`.
  Supports `initialize`, `tools/list`, `tools/call` (protocolVersion `2024-11-05`).
- `tools/<tool-name>.js` — one file per exposed tool, loaded dynamically
- `lib/spec-reader.js` — reads `.enterprise/.specs/` once per tool call, caches in-memory
- Test: `test/test-mcp-hseos-governance.js` — protocol round-trip (initialize, list_tools, call_tool with each tool)

## Acceptance

- [x] Five portable and nine optional managed-shadow tools implemented and tested
- [ ] `hseos mcp doctor` (Wave 6) reports server reachable
- [ ] Published as `@hseos/mcp-server-governance` on npm and Smithery
