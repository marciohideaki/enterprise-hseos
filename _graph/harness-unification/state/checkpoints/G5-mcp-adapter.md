# G5 Checkpoint — MCP 2026 Adapter

**Status:** completed and independently verified; operational activation prohibited
**Baseline:** feature integration `35fac2892651a519270bb1bd0e96344ada59301f`
**Decision:** accepted ADR-0022 and ADR-0023

## Delivered

- A transport-neutral adapter for MCP `2026-07-28`, with stateless per-request metadata, `server/discover`, deterministic/cacheable `tools/list`, server identity stamping, and modern HTTP header validation.
- A single governed execution port. Tool declarations carry no executable handlers, and every call preserves the canonical six-field HSEOS envelope.
- Public `outputSchema` adaptation around that canonical envelope while the original tool result schema validates `data.result`; bounded local references are rebased and external references are rejected.
- JSON Schema 2020-12 compilation through Ajv 8 and isolated worker validation with body, depth, schema, concurrency, validation-time, and absolute execution-deadline limits.
- MRTR approval with operation/input/actor/scope/idempotency binding, policy-version checks, expiry, 16 KiB state limit, AES-256-GCM confidentiality, and a domain-separated outer HMAC.
- Streamable HTTP hardening: explicit Origin allowlist, strict UTF-8, JSON content type, 403/404/405/413 mappings, standard and `x-mcp-header` parity, nested-property routing, and HTTP disconnect cancellation.
- Stdio cancellation keyed by request id and validated as a complete JSON-RPC notification before any abort.
- A bounded legacy `2024-11-05` compatibility subset with per-identity/overflow telemetry, deprecation metadata, explicit approval refusal, and an enforced sunset at `2026-11-30T00:00:00Z`.

## Deliberate boundaries

- `MCP_PROTOCOL_VERSION` remains `2024-11-05`. The modern constant and adapter exist, but none of the four operational servers advertises modern conformance until G6 wires them through this boundary.
- Legacy compatibility is accepted only before the ADR-0023 sunset. The adapter fails closed at and after the cutoff.
- `Accept: application/json, text/event-stream` remains a normative client obligation in the 2026 specification. This JSON-only server does not reject a missing `Accept` header, preserving bounded legacy interoperability; G6 may enforce a stricter deployment-edge policy without changing adapter semantics.
- Migrations 005–007 remain pending activation and the production database runner remains at schema version 4.

## Deterministic evidence

- Focused MCP 2026 suite: `19` passed, `0` failed.
- Existing MCP contract/governance/project-state/stdio/swarm/Axon suites: `50` passed, `0` failed.
- Full governed quality gate: `0` failures, `1` pre-existing documentation-placeholder warning.
- Lint and `git diff --check`: passed.
- Quality log SHA-256: `acf6e33dd4ab3eee439dc4bd2fbe7ab1a92aef6422722e7637bdc61621521a43`.
- Independent verification and targeted errata: `0 BLOCKER / 0 HIGH / 0 MEDIUM`; independent counterexamples covered AEAD tampering/confidentiality, protocol header classification, deadlines, Origin, HTTP statuses, nested headers, sunset, and malformed cancellation.
- `npm audit --omit=dev` no longer reports the Ajv vulnerability. Four unrelated pre-existing production findings remain (`@isaacs/brace-expansion`, `js-yaml`, `minimatch`, and `yaml`) and are not broadened into this node.

## Specification evidence

- MCP 2026-07-28 Streamable HTTP: <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx>
- MCP 2026-07-28 tools and `x-mcp-header`: <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx>
- MCP 2026-07-28 discovery: <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/discover.mdx>

## Required next

G6 must adapt the four operational MCP servers and the remaining CLI/hook/SWARM execution paths to this port, implement scheduler/exclusivity behavior, and prove parity before changing the shared operational protocol constant.

## Rollback

Revert/discard the isolated G5 commit. No operational server, database, migration runner, deployment, or external system was changed.
