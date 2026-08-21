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
| `../../.enterprise/.specs/decisions/ADR-0024-model-agnostic-agent-framework.md` | Accepted architectural decision                                  | Authoritative ADR                                  |

Implementation artifacts will be indexed here as nodes A1–A13 add their own checkpoint shards.
