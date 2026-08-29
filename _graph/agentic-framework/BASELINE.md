# Agentic Framework Baseline

**Artifact type:** Governed goal baseline
**Scope:** HSEOS Agent Kernel, provider seams, sessions, tools, orchestration, packaging, conformance and activation
**Objective:** Make HSEOS a complete model-agnostic agent framework with substitutable model and runtime providers while preserving its governance authority.
**Baseline commit:** `ae6bb46`
**Worktree:** `task/agentic-framework-foundation` from `feature/harness-unification`
**Captured:** 2026-08-21 UTC
**Governing documents:** Enterprise Constitution; ADR Policy; Automated Validation Rules; ADR-0001/0002/0003/0006/0007/0012/0016/0022/0023/0024

## Governing documents

- `.enterprise/.specs/constitution/Enterprise-Constitution.md`
- `.enterprise/.specs/decisions/ADR-0001-hexagonal-architecture-mandatory.md`
- `.enterprise/.specs/decisions/ADR-0002-event-sourcing-opt-in.md`
- `.enterprise/.specs/decisions/ADR-0003-cqrs-with-relational-source-of-truth.md`
- `.enterprise/.specs/decisions/ADR-0006-standalone-architecture.md`
- `.enterprise/.specs/decisions/ADR-0007-compiler-v2-multi-adapter-contract.md`
- `.enterprise/.specs/decisions/ADR-0012-agent-os-sandboxing.md`
- `.enterprise/.specs/decisions/ADR-0016-capability-packaging.md`
- `.enterprise/.specs/decisions/ADR-0022-governed-execution-ledger.md`
- `.enterprise/.specs/decisions/ADR-0023-mcp-2026-stateless-adapter.md`
- `.enterprise/.specs/decisions/ADR-0024-model-agnostic-agent-framework.md`
- `.enterprise/policies/adr-policy.md`
- `.enterprise/policies/automated-validation.md`

## Authority and isolation

- **Observed:** the active native Codex goal authorizes implementation of a complete model-agnostic agent framework.
- **Observed:** implementation runs in `task/agentic-framework-foundation`, isolated from the integration branch and operational database.
- **Authorized:** reversible source, tests, documentation and temporary-fixture work toward the objective.
- **Not authorized by implication:** ADR acceptance on behalf of leadership, merge, push, deployment, secret access, operational schema/data migration, MCP cutover or runtime activation.

## Observed baseline

| Concern             | Evidence                                                                                                 | Classification         |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------- |
| Governed operations | ADR-0022 runtime implements authority, approval, ledger, providers, deadlines, cancellation and evidence | observed; fixture-only |
| Agent loop          | No HSEOS-owned turn/step/model loop exists                                                               | observed               |
| Model providers     | No normalized inference provider registry exists                                                         | observed               |
| Runtime providers   | Codex/Claude/Goose are compiler targets, not lifecycle-conformant runtime providers                      | observed               |
| Sessions            | Operational state tracks runs/tasks/sessions, but not every model-visible request/input                  | observed               |
| Context             | Skills and context policies exist; assembly/token budgeting is delegated to hosts                        | observed               |
| Tool runtime        | MCP and governed operation port exist; no general model tool pipeline spans every call                   | observed               |
| Workflows           | 39 definitions and 8 registered workflows exist; no general agent-script executor is operational         | observed               |
| Compaction          | A context-compression skill exists; no kernel compaction lifecycle exists                                | observed               |
| Plugins             | Four plugin candidates are scaffolded and inactive                                                       | observed               |
| Compatibility       | G9 is `awaiting_evidence`; production remains MCP legacy/schema v4                                       | observed               |

## Inferred target

A headless Agent Kernel owns model-neutral sessions, context, turns, tools, workflows, subagents and compaction. Raw model APIs and delegated agent products attach through separate versioned provider ports. Provider capability levels are mechanically verified. HSEOS governance remains authoritative and every classified effect uses ADR-0022.

## Unverified items

- Exact lifecycle/control surfaces available from future Codex and Claude Code releases.
- Whether ACP alone can carry all L3 events required by the kernel.
- Operational provider credentials and real-API availability.
- Production throughput/token/cost limits for the reference runtime.
- G9’s external 30-day and downstream compatibility evidence.

## Rollback position

Before activation, every node is reversible by its isolated task commit. Temporary databases and deterministic provider fixtures are disposable. Operational schema v4, legacy MCP and existing hosted adapters remain unchanged.
