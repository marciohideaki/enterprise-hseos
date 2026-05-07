# ADR-0008 — MCP Project-Local Configuration and Three-Tier Bundle Policy

**Status:** Proposed
**Date:** 2026-05-07
**Authors:** Platform Architecture
**Affects Standards:** CLAUDE.md §"MCP Server Configuration"; mcp-governance skill; installer/uninstaller; quality gates (`scripts/governance/quality-gates.sh`)
**Supersedes:** N/A
**Superseded By:** N/A
**Depends on:** ADR-0006 (Standalone Architecture), ADR-0007 (Compiler v2)

---

## Context

MCP (Model Context Protocol, spec 2025-11-25) is the de-facto protocol for connecting agents to tools and data; the 2026 roadmap adds streamable HTTP, the Tasks primitive (SEP-1686), and enterprise readiness features. The ecosystem currently exposes 12,000+ MCP servers (Smithery 7,000+, Glama, PulseMCP).

HSEOS today configures a single MCP server (the Axon binary) only in the global user file `~/.claude/.mcp.json`. The project has no `.mcp.json`, `allowedMcpServers: []` blocks global MCP usage at the project level, and HSEOS-internal capabilities (state-tracking, governance queries, dev-squad orchestration) are exposed only as Bash scripts that no non-Anthropic adapter can consume.

This violates ADR-0006 P5 (zero global path) and P6 (graceful degradation), and prevents HSEOS from publishing its own MCP servers to the public registries.

---

## Decision

We will move all MCP configuration to project-local artifacts and organize servers in three opt-in tiers.

**Project-local configuration:**
- Authoritative declaration: `.agents/mcp/registry.yaml` (vendor-neutral)
- Compiled outputs (per adapter): `.mcp.json` (root, used by Anthropic CLI and most other adapters), `.codex/config.toml`, `.cursor/mcp.json`, etc.
- Compiler emits all three from the single registry; secrets never inlined (env-var references only).

**Three-tier bundle policy** (`.agents/mcp/bundles/`):

| Tier | File | Required | Servers |
|---|---|---|---|
| `core` | `core.yaml` | Yes | `hseos-governance`, `mcp-project-state` (already exists), `filesystem` (scoped to repo root) |
| `extended` | `extended.yaml` | No (opt-in) | `axon-bridge`, `hseos-swarm`, `sequential-thinking`, `fetch`, `memory` |
| `enterprise` | `enterprise.yaml` | No (opt-in, requires secrets) | `github`, `postgres`, `kubernetes`, `sentry` |

**HSEOS-native MCP servers** (new, shipped under `tools/`):

1. **`tools/mcp-hseos-governance/`** — exposes `query_constitution(article)`, `validate_adr(change_kind)`, `check_authority(agent_code)`, `list_skills(filter)`, `list_workflows(profile)`. Tier: core. Replaces ad-hoc reads of `.enterprise/.specs/`.
2. **`tools/mcp-hseos-swarm/`** — exposes `plan_squad(batch)`, `dispatch_wave(plan, wave)`, `consolidate_handoff(wave_id)`, `get_run_state(run_id)`. Tier: extended. Replaces Bash-only dev-squad orchestration so non-Anthropic adapters can drive parallel execution.
3. **`tools/mcp-axon-bridge/`** — wrapper around the Axon binary. Resolves the binary via (1) `tools/vendor/axon/`, (2) `$AXON_BIN`, (3) `axon` on `$PATH`, (4) no-op fallback returning empty results so downstream skills degrade to Read+Grep. Tier: extended.

**Existing MCP server**: `tools/mcp-project-state/` is formalized and published as `@hseos/mcp-project-state` on npm and Smithery.

**Discovery and install:**
- `hseos mcp install --bundle <core|extended|enterprise>` resolves dependencies via npm and writes the bundle's servers into `.mcp.json` and adapter-specific configs.
- `hseos mcp doctor` performs the MCP `initialize` handshake against each declared server and reports unreachable ones.
- `hseos mcp list` shows currently active servers per bundle.

**Settings fix** (Wave 3): the project's `.claude/settings.json` removes the empty `allowedMcpServers: []` restriction (or populates it explicitly with the bundle's servers) so the compiled `.mcp.json` is honoured.

---

## Consequences

### Positive
- HSEOS gains three publishable MCP servers (`hseos-governance`, `hseos-swarm`, `hseos-state-tracking`) — distribution via npm + Smithery becomes possible.
- Capabilities consumable by any MCP-aware adapter, not only the original platform.
- `hseos doctor --mcp` provides single-command MCP health for any installation.
- Three-tier model lets installations stay minimal (`core` only) and grow as needed; offline/airgapped installs work with `core` plus stdio servers shipped in-repo.

### Negative / Trade-offs
- Three new `tools/mcp-*/` subprojects to maintain (governance, swarm, axon-bridge); plus formalization work for the existing project-state server.
- Each new MCP server carries its own dependency surface and security posture.
- `.mcp.json` plus per-adapter MCP configs increase the surface area of compiled artifacts.

### Risks
- Axon binary path drift (binaries move between `~/.claude/`, `/opt/`, custom locations) — mitigated by the four-step resolver and the no-op fallback so HSEOS never hard-fails on Axon absence.
- MCP server version skew between bundle declaration and installed npm version — mitigated by hash-pinning in `manifest.yaml` v2 (per ADR-0007).
- Enterprise tier requires secrets — credential path protection (defined in CLAUDE.md §Credential Path Protection) remains binding; secrets never appear in committed config.

---

## Affected Standards

| Standard | Section | Change |
|---|---|---|
| CLAUDE.md (project) | §"MCP Server Configuration" | Replaced by bundle declaration in `.agents/mcp/registry.yaml`; CLAUDE.md becomes generated. |
| `.agents/mcp/` (NEW) | Directory | Holds `registry.yaml` and `bundles/*.yaml` |
| mcp-governance skill | Behaviour | Now consumes `.agents/mcp/registry.yaml` as input rather than scanning per-adapter configs |
| `tools/mcp-project-state/` | Publication | Published as `@hseos/mcp-project-state` (npm + Smithery) |
| Quality Gates (`scripts/governance/quality-gates.sh`) | New gate | Optional `mcp-handshake` gate (off by default in Wave 3, mandatory after Wave 6) |

---

## Compliance

- [ ] Approved by Engineering Leadership (Marcio Hideaki)
- [ ] Wave 3 PR (`feature/standalone-w3-mcp-bundle`) merged with the four `tools/mcp-*/` subprojects + bundle registry
- [ ] `hseos mcp doctor` exits 0 on a fresh clone with bundle `core`
- [ ] `@hseos/mcp-project-state` published on npm
- [ ] Activation date: upon merge of Wave 3

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep MCPs at user/global level only, document the path in setup guide | Violates ADR-0006 P5 (zero global path); breaks clean-clone smoke test; impossible to distribute via npm with reproducible behaviour. |
| Bundle every MCP into a single monolith | Forces Axon and enterprise servers (postgres, kubernetes) onto every install; violates P6 graceful degradation; bloats install footprint. |
| Use an external orchestrator (Smithery) as the source of truth | Coupling HSEOS to Smithery violates P1 (single SoT). Smithery becomes a destination for HSEOS-published servers, not a dependency. |
| Skip HSEOS-native MCPs and expose governance only as documentation | Non-Anthropic adapters cannot read `.enterprise/.specs/` repeatedly without burning context tokens; an MCP tool call is cacheable and adapter-agnostic. |
