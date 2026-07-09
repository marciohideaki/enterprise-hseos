# Architecture Decision Records — Index

**Shard:** Decision Records
**Path:** `.enterprise/.specs/decisions/`
**Authority:** Stack/Cross override only when explicitly approved and versioned
**Format:** ADR-XXXX (zero-padded 4 digits)

---

## Active Decisions

| ID | Title | Status | Affects |
|---|---|---|---|
| [ADR-0001](./ADR-0001-hexagonal-architecture-mandatory.md) | Hexagonal Architecture as Default | Accepted | All stacks |
| [ADR-0002](./ADR-0002-event-sourcing-opt-in.md) | Event Sourcing is Opt-In | Accepted | All stacks |
| [ADR-0003](./ADR-0003-cqrs-with-relational-source-of-truth.md) | CQRS: Relational DB as Source of Truth, Non-Relational for Read Models | Accepted | All stacks |
| [ADR-0004](./ADR-0004-flutter-architecture-decisions.md) | Flutter Architecture Decisions | Proposed (empty template — content pending) | Flutter stack |
| [ADR-0005](./ADR-0005-performance-engineering-activation-template.md) | Performance Engineering Activation Template | Proposed (activation template — copy per service) | All stacks |
| [ADR-0006](./ADR-0006-standalone-architecture.md) | HSEOS Standalone Architecture (v2.0) | Accepted (2026-07-08) | Constitution, CLAUDE.md, AGENTS.md, SKILLS-REGISTRY |
| [ADR-0007](./ADR-0007-compiler-v2-multi-adapter-contract.md) | Agent-Core Compiler v2 (Multi-Adapter Contract) | Accepted (2026-07-08) | Compiler module, manifest schema, install lifecycle |
| [ADR-0008](./ADR-0008-mcp-project-local-bundle-policy.md) | MCP Project-Local + Three-Tier Bundle Policy | Accepted (2026-07-08) | MCP configuration, mcp-governance skill, quality gates |
| [ADR-0009](./ADR-0009-plugin-marketplace.md) | HSEOS Plugin Marketplace (Dual-Format) | Accepted (2026-07-08) | Compiler, install lifecycle, documentation policy |
| [ADR-0010](./ADR-0010-shared-otel-collector.md) | Shared OpenTelemetry Collector in `platform-shared-dev` | Accepted (2026-07-08) | `shared-infrastructure.md` canonical mapping table |
| [ADR-0011](./ADR-0011-ado-ops-module.md) | ADO-Ops Module: Azure DevOps Integration for HSEOS | Accepted | ADO lifecycle, dev-squad protocol, SWARM granularity, `.hseos/agents/`, hook registry |
| [ADR-0012](./ADR-0012-agent-os-sandboxing.md) | Optional Agent OS Sandboxing | Accepted (2026-07-08) | CLI, agent-core doctor, sandbox policy |
| [ADR-0013](./ADR-0013-pr-closeout-and-branch-lifecycle.md) | PR Closeout and Branch Lifecycle | Accepted | Execution governance, branch lifecycle, PR closeout |
| [ADR-0014](./ADR-0014-telemetry-export-bridge.md) | Telemetry Export Bridge: Optional OTLP/Loki Sidecar for Agent-State Events | Accepted | `ai-observability` skill, `.agents/hooks/registry.yaml` |
| [ADR-0015](./ADR-0015-dev-squad-canonical-authority.md) | dev-squad Canonical Authority Hierarchy | Accepted | SKILLS-REGISTRY, `.hseos/workflows/dev-squad/`, `.hseos/agents/swarm.agent.yaml` |
| [ADR-0016](./ADR-0016-capability-packaging.md) | Capability Packaging and Install Planning | Accepted (2026-07-08) | install lifecycle, agent-core compiler, skill packaging |

---

## Status Definitions

| Status | Meaning |
|---|---|
| **Proposed** | Draft — not yet approved |
| **Accepted** | Approved — binding |
| **Superseded** | Replaced by newer ADR (link to successor) |
| **Deprecated** | No longer applies — link to removal reason |
| **Rejected** | Formally rejected — kept for history |

---

## Rules

- ADRs are append-only — never edit accepted ADRs
- ADRs MUST reference the standard(s) they affect
- ADRs MUST be approved before implementation
- A new ADR is required for: performance standard activation, security exception, architectural deviation, dependency exception
- Use `_TEMPLATE.md` for all new ADRs

---

## Creating a New ADR

1. Copy `_TEMPLATE.md` → `ADR-XXXX-short-title.md`
2. Fill all sections — do not leave placeholders
3. Set status to `Proposed`
4. Submit via PR with affected-standards linked
5. After approval: set status to `Accepted`, add to this index
