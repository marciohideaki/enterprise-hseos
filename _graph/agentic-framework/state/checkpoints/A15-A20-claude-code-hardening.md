# A15–A20 — Claude Code Learning Hardening Implementation

**Artifact type:** Governed implementation checkpoint  
**Scope:** Seven proposals mapped into six implementation cores; proposals 1 and 5 share `agent-policy-lattice`
**Authority:** Explicit user instruction to analyze, validate, test and implement the seven proposals; negative verdicts must be discarded  
**Operational effect:** None; no schema activation, provider activation, secret access, deployment or cutover

## Final disposition

The machine-verifiable canonical catalog is `../../CLAUDE-CODE-HARDENING-DISPOSITION.json`; this table is its human-readable rendering.

|   # | Proposal                             | Verdict           | HSEOS implementation                                                                                                             | Deterministic evidence                                                    |
| --: | ------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
|   1 | Formal permission lattice            | Adopted           | Monotonic stages keep constitutional and mandatory denies above modes and callbacks                                              | `packages/agent-policy-lattice`; `test:agent-policy-lattice`              |
|   2 | Transitive isolation                 | Adopted           | One supervisor-owned filesystem, network, environment and seccomp boundary covers root, child, workflow, tool and hosted runtime | `packages/agent-isolation-attestation`; `test:agent-transitive-isolation` |
|   3 | Provider-neutral agent messaging     | Adopted           | Durable text-only relay with policy, TTL, dedup, acknowledgement, hold/refuse/flush and idle notification                        | `packages/agent-message-transport`; `test:agent-message-transport`        |
|   4 | Hosted worker lifecycle              | Adopted           | Durable lease epochs, heartbeat, drain, park, orphan, takeover, retirement and fencing survive reopen                            | `packages/delegated-runtime-host`; `test:delegated-runtime-host`          |
|   5 | Configuration and provenance lattice | Adopted           | Source precedence plus restrictive union/intersection/minimum merges return immutable provenance                                 | `packages/agent-policy-lattice`; `test:agent-policy-lattice`              |
|   6 | Egress credential transformer        | Partially adopted | Supervisor-owned credential injection at a pinned Unix-socket route is retained                                                  | `provider-egress-broker`; `test:provider-egress-broker`                   |
|   7 | Continuous trace lineage             | Adopted           | Durable trace root and causal anchors span resume, fork, workflow, tool defer/replay and delegated reattach with W3C projection  | `packages/agent-trace-lineage`; session/tool/delegated suites             |

Proposal 6 is intentionally narrower than Claude Code's generic transformer pattern. Generic sentinel substitution was rejected because it can widen authority and copy credentials into model-visible or user-controlled payloads. HSEOS injects one supervisor-owned credential only after endpoint, route, headers, body and sandbox boundaries are fixed; redirects and credential reflection fail closed.

## A15–A20 adversarial validation

- A15–A19 each passed the complete governed worktree quality gate before local integration.
- A20 initially received `NOT READY`: settled tool replay crossed trace, causation anchors were forgeable, and delegated children could lose the parent trace.
- Corrections now require exact trace/causation on every governed operation fact, verifiable root/child causal anchors before persistence, and explicit inherited trace binding for delegated children.
- Independent A20 revalidation: `READY`, 98 focused tests, no blocker/high/medium finding.
- A20's 98 focused tests belong to the trace-lineage refutation scope; they are not the count of the integrated seven-proposal conformance.

## Uniformity and rollback

The kernel owns policy, configuration, isolation, messaging, worker state, egress authority and trace lineage. Hosted and ACP clients remain substitutable adapters and cannot weaken these rules. Each implementation remains in an isolated reversible commit. A21 owns integrated closeout evidence; operational schema remains v4, while G9 observation, final stable audit and explicit human cutover remain separate gates.
