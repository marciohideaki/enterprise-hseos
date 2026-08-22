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
| `../../.enterprise/.specs/decisions/ADR-0024-model-agnostic-agent-framework.md` | Accepted architectural decision                                  | Authoritative ADR                                  |

Implementation artifacts will be indexed here as nodes A2–A13 add their own checkpoint shards.
