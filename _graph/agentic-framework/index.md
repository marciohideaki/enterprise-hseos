# Agentic Framework Goal Index

**Artifact type:** Sharded goal index
**Scope:** Complete model-agnostic HSEOS Agent Framework
**Governing documents:** Enterprise Constitution; ADR-0024; ADR Policy; Automated Validation Rules

| Artifact                                                                        | Purpose                                                          | Authority                                          |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `BASELINE.md`                                                                   | Observed starting state, authority and rollback boundary         | Captured evidence                                  |
| `GOAL-GRAPH.md`                                                                 | Executable nodes, dependencies, verification and stop conditions | Goal contract                                      |
| `STATE.md`                                                                      | Current node, status, gate and next reversible action            | Rendered current state                             |
| `state/events.jsonl`                                                            | Append-only lifecycle and evidence records                       | Goal event history                                 |
| `state/checkpoints/A0-foundation-readiness.md`                                  | A0 deterministic and independent validation evidence             | Readiness checkpoint; not architectural acceptance |
| `state/checkpoints/A0-completion.md`                                            | Human acceptance and A0 completion evidence                      | Accepted transition authority for A1               |
| `state/checkpoints/A1-contracts.md`                                             | Versioned ports, schemas, conformance and adversarial evidence   | Accepted contract boundary for A2–A10              |
| `../../packages/agent-runtime-contracts/`                                       | Vendor-neutral executable Agent Kernel contracts                 | ADR-0024 inward port package                       |
| `../../test/test-agent-runtime-contracts.js`                                    | A1 contract and adversarial conformance suite                    | Deterministic A1 verification                      |
| `state/checkpoints/A2-session-event-store.md`                                   | Relational session persistence and independent evidence          | Accepted reconstruction boundary for A3–A8         |
| `../../packages/agent-session-store/`                                           | Append, replay, fork, reconstruction and crash recovery          | ADR-0022/0024 relational session adapter           |
| `../../test/test-agent-session-store.js`                                        | A2 lifecycle, recovery, hierarchy and security suite             | Deterministic A2 verification                      |
| `state/checkpoints/A3-model-providers.md`                                       | Registry, streaming, security and independent evidence           | Accepted model-provider boundary for A4–A10        |
| `../../packages/model-providers/`                                               | Scripted and OpenAI-compatible normalized provider adapters      | ADR-0024 Provider Plane                            |
| `../../test/test-model-providers.js`                                            | A3 lifecycle, protocol, capability and security suite            | Deterministic A3 verification                      |
| `state/checkpoints/A4-context-assembler.md`                                     | Context precedence, lineage, budgets and independent evidence    | Accepted context boundary for A5–A10               |
| `../../packages/agent-context/`                                                 | Durable deterministic context assembly and token accounting      | ADR-0024 Agent Kernel context service              |
| `../../test/test-agent-context.js`                                              | A4 precedence, overflow, accounting and boundary suite           | Deterministic A4 verification                      |
| `state/checkpoints/A5-tool-runtime.md`                                          | Governed ToolRuntime completion and adversarial evidence         | Accepted governed tool boundary for A6–A11         |
| `../../packages/tool-runtime/`                                                  | Model-neutral governed tool registry and lifecycle               | ADR-0022/0024 ToolRuntime implementation           |
| `state/checkpoints/A6-agent-runtime.md`                                         | Bounded headless loop completion and adversarial evidence        | Accepted AgentRuntime boundary for A7–A12           |
| `../../packages/agent-runtime/`                                                 | Headless model-neutral Agent Kernel loop                          | ADR-0024 Agent Kernel runtime                       |
| `../../test/test-agent-runtime.js`                                              | A6/A7 loop, recovery, limits and tool-compaction journeys        | Deterministic runtime verification                  |
| `../../packages/agent-compaction/`                                              | Substitutable compaction registry, runtime and checkpoint provider | ADR-0024 compaction provider implementation       |
| `../../test/test-agent-compaction.js`                                           | A7 provider, checkpoint, pruning and adversarial suite           | Deterministic A7 verification                       |
| `state/checkpoints/A7-compaction-checkpoints.md`                                | A7 lineage, recovery, provenance and independent evidence        | Accepted compaction boundary for A8–A12             |
| `../../packages/agent-orchestration/`                                           | Bounded SubagentProvider and durable WorkflowEngine              | ADR-0024 orchestration-plane implementation         |
| `../../test/test-agent-orchestration.js`                                        | A8 scope, join/cancel, phases, caps, crash and teardown suite     | Deterministic A8 verification                       |
| `state/checkpoints/A8-subagents-workflows.md`                                   | A8 hierarchy, workflow, crash, fencing and review evidence        | Accepted orchestration boundary for A9–A12          |
| `../../packages/runtime-providers/`                                             | ACP and hosted delegated-runtime adapters                          | ADR-0024 RuntimeProvider plane                      |
| `state/checkpoints/A9-runtime-provider-acp.md`                                  | A9 negotiation, lifecycle and ACP refutation evidence              | Accepted delegated-runtime boundary                 |
| `state/checkpoints/A10-hosted-runtime-adapters.md`                              | Codex, Claude Code and DeepSeek honest-level adapter evidence      | Accepted hosted-adapter boundary                    |
| `state/checkpoints/A11-capability-cli-reference.md`                             | Exact profile, CLI and keyless assembled runtime evidence          | Accepted pre-activation productization boundary     |
| `A12-THREAT-MODEL.md`                                                          | Security boundaries, abuse cases and activation blockers           | A12 security assessment                             |
| `A12-COMPLETION-AUDIT.md`                                                      | Functional percentage, journey matrix and DeepSeek comparison      | A12 completion assessment                           |
| `state/checkpoints/A12-completion-audit.md`                                    | A12 deterministic gates, refutations and rollback boundary         | Accepted pre-activation completion checkpoint       |
| `state/checkpoints/A13-activation-rehearsal.md`                                | Candidate profile, real-state private migration and rollback proof  | A13 partial evidence; never cutover authority        |
| `state/checkpoints/A13-provider-binding.md`                                    | Immutable provider binding, secret timing and environment gate      | A13 partial evidence; never cutover authority        |
| `state/checkpoints/A13-bound-kernel-assembly.md`                               | Common kernel assembly, durable binding and governed tool-loop proof | A13 partial evidence; never cutover authority        |
| `state/checkpoints/A13-sandbox-supervisor-cli.md`                              | Fail-closed public candidate route and sandbox attestation proof      | A13 partial evidence; never live-runtime authority   |
| `../../packages/agent-orchestration/execution-supervisor.js`                   | Coordinated bounded root cancellation across runtime and workflows | ADR-0024 orchestration supervision                   |
| `../../test/test-agentic-completion-audit.js`                                   | Provider substitution, fault injection and replay performance      | Deterministic A12 assembled evidence                |
| `../../.enterprise/.specs/decisions/ADR-0024-model-agnostic-agent-framework.md` | Accepted architectural decision                                  | Authoritative ADR                                  |

A13 rehearsal evidence is present, while operational activation evidence remains intentionally incomplete until every environment, G9 and human cutover gate is satisfied.
