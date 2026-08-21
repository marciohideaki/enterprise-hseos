# ADR-0023 — MCP 2026-07-28 Stateless Adapter and Legacy Boundary

**Status:** Proposed
**Date:** 2026-08-21
**Authors:** Platform Architecture (draft prepared by execution agent)
**Affects Standards:** ADR-0008; ADR-0019; MCP bundles; MCP transport; tool contracts; security and observability boundaries
**Supersedes:** ADR-0019 upon acceptance
**Superseded By:** N/A

---

## Context

ADR-0019 retained a manually implemented subset at protocol revision `2024-11-05` and required a final-spec diff by 2026-08-27. The final MCP `2026-07-28` release is a breaking protocol era: it retires `initialize`/`initialized` and protocol sessions, introduces `server/discover`, carries protocol/client metadata per request, requires HTTP routing headers, makes list responses deterministically cacheable, and formalizes extensions.

HSEOS currently assumes the retired initialization exchange in its shared transport and contract tests. HTTP and stdio adapters also differ in tool-result wrapping. The current transport does not centrally enforce bounded request bodies, deadlines, cancellation, output schemas, or precise JSON-RPC error mapping.

The Governed Execution Runtime proposed by ADR-0022 owns domain policy and execution semantics. MCP must therefore be a stateless boundary adapter and must not introduce its own task or authority model.

## Decision

We propose to migrate every native HSEOS MCP server to a shared adapter for protocol revision `2026-07-28` while retaining an explicit, tested legacy compatibility boundary for supported older clients during one release window.

1. Modern requests are self-contained and carry the protocol era and client metadata per request.
2. HTTP requires and validates `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` where applicable.
3. `server/discover`, `tools/list`, and `tools/call` are implemented through one shared transport.
4. `tools/list` is deterministic and returns cache hints tied to a stable tool-catalog revision.
5. Modern requests never create or depend on protocol sessions.
6. Legacy `2024-11-05` `initialize` support is isolated behind an explicit compatibility adapter for the currently consumed tools subset. It cannot affect modern request semantics.
7. Input and output schemas use bounded JSON Schema 2020-12 validation. External `$ref` dereferencing is disabled.
8. HTTP body size, schema depth, validation time, execution deadline, and cancellation are bounded.
9. JSON-RPC errors use specific standard/protocol codes and never collapse all failures into `-32000`.
10. Tool results have identical structured semantics across stdio and HTTP.
11. All tool calls delegate to the execution port from ADR-0022. MCP does not call handlers directly.
12. HSEOS `as_tasks` remain domain projections. The MCP Tasks extension, if later required, is an adapter extension and triggers a separate adoption review.
13. Approval-required modern calls use MCP Multi Round-Trip Requests: the adapter returns `resultType: input_required` with request state bound to the HSEOS `operation_id`; the retried call supplies `inputResponses`, which the approval provider validates before any `ExecutionStarted` fact or dispatch.
14. A previously recorded HSEOS approval may satisfy the call only when its authorizer, exact scope, operation ID, policy version, and expiry match. Approval secrets/tokens are never exposed in MCP payloads.
15. Clients that do not advertise the required MRTR capability receive a typed `approval_required` failure with no provider dispatch. Legacy clients cannot execute approval-required tools and must use an approval-capable HSEOS surface.

The implementation may use the official TypeScript SDK if dependency and conformance evaluation shows it reduces protocol risk. The wire contract and HSEOS execution boundary remain authoritative regardless of library choice.

## Consequences

### Positive

- Meets the accepted ADR-0019 deadline with the actual final protocol semantics.
- Removes hidden transport sessions and makes HTTP routing and authorization explicit.
- Aligns every native server on one tested wire contract.
- Keeps HSEOS task/state semantics independent from optional MCP extensions.

### Negative / Trade-offs

- Older MCP clients need an explicit compatibility path during migration.
- Contract fixtures and client probes must cover two protocol eras temporarily.
- Manual transport maintenance is no longer a one-line version bump; protocol-era behavior must be explicit.

### Risks

- **False conformance:** changing only the version string would advertise unsupported semantics. Mitigation: era-specific black-box fixtures and rejection of malformed modern requests.
- **Unbounded input:** schemas or bodies could consume excessive resources. Mitigation: hard limits and timed validation.
- **Adapter drift:** servers could override shared semantics. Mitigation: shared transport plus cross-server conformance tests.
- **Compatibility permanence:** legacy paths may never be removed. Mitigation: warnings, usage counters, documented sunset, and zero-use acceptance evidence.
- **Approval replay or widening:** a retried stateless request could reuse approval context. Mitigation: single-operation approval records, request-state integrity, expiry, and atomic consumption bound to `operation_id`.

## Mitigations

- Implement the project-state server as the reference adapter before migrating the remaining servers.
- Test modern-only, legacy-only, and auto-negotiating client scenarios.
- Pin any SDK dependency and validate licenses, provenance, and lockfile integrity.
- Keep protocol translation outside the domain runtime.
- The compatibility window starts in activation release `R`, supports only `2024-11-05` through `R`, and is removed no earlier than `R+1`. Release `R` may activate only after 30 consecutive days of zero legacy requests across all native servers and no later than 2026-10-31; otherwise activation is blocked pending a new accepted ADR. The compatibility path must be removed by 2026-11-30. Owner: `platform-governance`; any schedule extension requires a new accepted ADR with usage evidence.

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| ADR-0008 | Project-local MCP bundle | Updates every bundle to the modern stateless transport contract |
| ADR-0019 | Manual post-GA subset | Supersedes its initialize-era assumptions with the final 2026-07-28 behavior |
| Security & Identity | Input and authorization boundaries | Adds bounded validation and header-visible routing metadata |
| Observability | Trace and request metadata | Carries request-scoped metadata through the governed execution context |
| Tool Design Governance | Tool schemas and results | Requires input/output schema parity and deterministic discovery |

## Compliance

- [ ] Approved by Engineering Leadership
- [ ] ADR-0019 marked superseded and index updated
- [ ] All four native MCP servers pass modern contract tests
- [ ] Legacy compatibility window and removal version documented
- [ ] Teams notified
- [ ] Activation date: pending approval
- [ ] Review date: end of compatibility release

## Validation

- Modern `server/discover`, `tools/list`, and `tools/call` black-box fixtures pass over stdio and HTTP where supported.
- Modern HTTP requests without required routing/version headers fail with specific errors.
- Tool list order and catalog revision are stable across repeated calls.
- Input/output schema, size, depth, timeout, and cancellation limits are exercised.
- Legacy initialization works only through the compatibility adapter and emits a deprecation signal.
- Legacy requests increment a local counter by server/client identity and emit a deprecation warning containing the fixed sunset date.
- MRTR approval binds request state and input responses to one operation; missing, expired, mismatched, or replayed approval fails before dispatch.
- All servers return the same result envelope for the same execution-port outcome.

## Rollback

- Keep the legacy adapter available only as source code after the compatibility window; runtime enablement after sunset requires a new accepted ADR.
- Revert individual server routing to the prior shared transport if modern conformance fails before release.
- Do not advertise `2026-07-28` unless all modern invariants pass.
- Any permanent return to initialize-era semantics requires a superseding ADR.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Change only `MCP_PROTOCOL_VERSION` | Advertises a breaking era without implementing its wire semantics |
| Preserve initialize as the primary path | Conflicts with the current stateless protocol and prolongs server-specific session assumptions |
| Adopt MCP Tasks as the HSEOS task model | Couples the domain to an optional transport extension and duplicates `as_tasks` |
| Maintain separate transports per server | Repeats the existing drift and inconsistent result behavior |
| Drop all legacy support immediately | Creates avoidable client breakage without usage evidence |

## References

- ADR-0008 and ADR-0019
- ADR-0022 (proposed)
- MCP 2026-07-28 release: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- TypeScript SDK migration guide: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
