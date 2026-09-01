# Architecture Decision Records — Index

**Shard:** Decision Records
**Path:** `.enterprise/.specs/decisions/`
**Authority:** Stack/Cross override only when explicitly approved and versioned
**Format:** ADR-XXXX (zero-padded 4 digits)

---

## Active Decisions

| ID                                                                  | Title                                                                      | Status                              | Affects                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| [ADR-0001](./ADR-0001-hexagonal-architecture-mandatory.md)          | Hexagonal Architecture as Default                                          | Accepted                            | All stacks                                                                            |
| [ADR-0002](./ADR-0002-event-sourcing-opt-in.md)                     | Event Sourcing is Opt-In                                                   | Accepted                            | All stacks                                                                            |
| [ADR-0003](./ADR-0003-cqrs-with-relational-source-of-truth.md)      | CQRS: Relational DB as Source of Truth, Non-Relational for Read Models     | Accepted                            | All stacks                                                                            |
| [ADR-0006](./ADR-0006-standalone-architecture.md)                   | HSEOS Standalone Architecture (v2.0)                                       | Accepted (2026-07-08)               | Constitution, CLAUDE.md, AGENTS.md, SKILLS-REGISTRY                                   |
| [ADR-0007](./ADR-0007-compiler-v2-multi-adapter-contract.md)        | Agent-Core Compiler v2 (Multi-Adapter Contract)                            | Accepted (2026-07-08)               | Compiler module, manifest schema, install lifecycle                                   |
| [ADR-0008](./ADR-0008-mcp-project-local-bundle-policy.md)           | MCP Project-Local + Three-Tier Bundle Policy                               | Accepted (2026-07-08)               | MCP configuration, mcp-governance skill, quality gates                                |
| [ADR-0009](./ADR-0009-plugin-marketplace.md)                        | HSEOS Plugin Marketplace (Dual-Format)                                     | Accepted (2026-07-08)               | Compiler, install lifecycle, documentation policy                                     |
| [ADR-0010](./ADR-0010-shared-otel-collector.md)                     | Shared OpenTelemetry Collector in `platform-shared-dev`                    | Accepted (2026-07-08)               | `shared-infrastructure.md` canonical mapping table                                    |
| [ADR-0011](./ADR-0011-ado-ops-module.md)                            | ADO-Ops Module: Azure DevOps Integration for HSEOS                         | Accepted                            | ADO lifecycle, dev-squad protocol, SWARM granularity, `.hseos/agents/`, hook registry |
| [ADR-0012](./ADR-0012-agent-os-sandboxing.md)                       | Optional Agent OS Sandboxing                                               | Accepted (2026-07-08)               | CLI, agent-core doctor, sandbox policy                                                |
| [ADR-0013](./ADR-0013-pr-closeout-and-branch-lifecycle.md)          | PR Closeout and Branch Lifecycle                                           | Accepted                            | Execution governance, branch lifecycle, PR closeout                                   |
| [ADR-0014](./ADR-0014-telemetry-export-bridge.md)                   | Telemetry Export Bridge: Optional OTLP/Loki Sidecar for Agent-State Events | Accepted                            | `ai-observability` skill, `.agents/hooks/registry.yaml`                               |
| [ADR-0015](./ADR-0015-dev-squad-canonical-authority.md)             | dev-squad Canonical Authority Hierarchy                                    | Accepted                            | SKILLS-REGISTRY, `.hseos/workflows/dev-squad/`, `.hseos/agents/swarm.agent.yaml`      |
| [ADR-0016](./ADR-0016-capability-packaging.md)                      | Capability Packaging and Install Planning                                  | Accepted (2026-07-08)               | install lifecycle, agent-core compiler, skill packaging                               |
| [ADR-0017](./ADR-0017-stacked-feature-branch-chains.md)             | Stacked Feature Branch Chains                                              | Accepted                            | Execution governance, branch lifecycle, dev-squad protocol                            |
| [ADR-0018](./ADR-0018-provider-gateway-repo-topology.md)            | Provider/Integration Gateway: New Repo vs. Folder in an Existing Repo      | Proposed                            | provider gateways, repo topology                                                      |
| [ADR-0019](./ADR-0019-mcp-post-ga-conformance.md)                   | MCP Post-GA Conformance: Manual Subset with SDK Trigger                    | Superseded by ADR-0023 (2026-08-21) | `tools/mcp-*`, mcp-transport, contract tests                                          |
| [ADR-0020](./ADR-0020-provider-loop-cross-cutting-directives.md)    | Cross-cutting directives from the provider-gateway loop                    | Accepted (2026-07-18)               | CI/CD Pipeline, Advanced Testing Strategy (AT-32/AT-56), Security & Identity          |
| [ADR-0021](./ADR-0021-brand-variants-via-design-tokens.md)          | Brand Variants via Design Tokens, Not Forked Frontends                     | Proposed                            | SOLID (§6 DRY), CI/CD Pipeline (CI-43, CI-53), frontend repo topology                 |
| [ADR-0022](./ADR-0022-governed-execution-ledger.md)                 | Governed Execution Runtime with Relational Event Ledger                    | Accepted (2026-08-21)               | event sourcing, CQRS state, execution ports, capabilities, projections                |
| [ADR-0023](./ADR-0023-mcp-2026-stateless-adapter.md)                | MCP 2026-07-28 Stateless Adapter and Legacy Boundary                       | Accepted (2026-08-21)               | native MCP servers, shared transport, tool contracts                                  |
| [ADR-0024](./ADR-0024-model-agnostic-agent-framework.md)            | Model-Agnostic Agent Framework and Substitutable Runtime Providers         | Accepted (2026-08-21)               | agent kernel, model providers, runtime providers, session lifecycle, conformance      |
| [ADR-0025](./ADR-0025-provider-neutral-documentation-provenance.md) | Provider-Neutral Documentation Provenance                                  | Accepted (2026-08-28)               | documentation policy, accepted-ADR redaction, documentation validation                |
| [ADR-0026](./ADR-0026-canonical-capability-catalog-source.md)       | Canonical Capability Catalog Source                                        | Accepted (2026-08-28)               | capability catalog, agent-core compiler, compatibility loader                         |
| [ADR-0027](./ADR-0027-explicit-hook-and-workflow-contracts.md)      | Explicit Hook and Workflow Contracts                                       | Accepted (2026-08-28)               | hook registry, workflow catalog, CLI and MCP discovery                                |
| [ADR-0028](./ADR-0028-project-scoped-observability-sidecars.md)     | Project-Scoped Observability Side-Cars                                     | Accepted (2026-08-28)               | state UI, session tracking, central project registry                                  |
| [ADR-0029](./ADR-0029-bounded-package-surface.md)                   | Bounded Package Surface                                                    | Accepted (2026-08-28)               | npm distribution, runtime assets, repository evidence                                 |
| [ADR-0030](./ADR-0030-surface-lifecycle-contract.md)                | Surface Lifecycle Contract                                                 | Accepted (2026-08-28)               | capability catalog, install plans, module and sidecar boundaries                      |
| [ADR-0031](./ADR-0031-v3-contract-migration-boundary.md)            | v3 Contract Migration Boundary                                             | Accepted (2026-08-28)               | package version, catalog compatibility, state and side-car migration                  |
| [ADR-0032](./ADR-0032-managed-governance-control-plane.md)          | Managed Governance Control Plane with Signed Release Boundary              | Proposed                            | governance catalog, PostgreSQL control plane, releases, MCP and console               |

---

## Templates / Placeholders (not active decisions)

The following entries are ADR templates or placeholders for optional activation. They carry no normative authority and are not binding decisions.

| ID                                                                    | Title                                       | Status                                            | Affects       |
| --------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------- | ------------- |
| [ADR-0004](./ADR-0004-flutter-architecture-decisions.md)              | Flutter Architecture Decisions              | Proposed (empty template — content pending)       | Flutter stack |
| [ADR-0005](./ADR-0005-performance-engineering-activation-template.md) | Performance Engineering Activation Template | Proposed (activation template — copy per service) | All stacks    |

---

## Status Definitions

| Status         | Meaning                                    |
| -------------- | ------------------------------------------ |
| **Proposed**   | Draft — not yet approved                   |
| **Accepted**   | Approved — binding                         |
| **Superseded** | Replaced by newer ADR (link to successor)  |
| **Deprecated** | No longer applies — link to removal reason |
| **Rejected**   | Formally rejected — kept for history       |

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
