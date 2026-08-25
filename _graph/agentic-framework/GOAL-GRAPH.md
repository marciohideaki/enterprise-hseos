# Goal Graph — Complete Model-Agnostic Agent Framework

**Artifact type:** Executable goal graph
**Scope:** HSEOS Agent Kernel, model/runtime providers, sessions, context, tools, workflows, subagents, compaction, packaging and activation
**Objective:** Implement HSEOS as a complete agent framework whose models and runtimes are substitutable providers, while retaining HSEOS governance as the authority.
**Authority:** Active native Codex goal created from the user’s explicit implementation request on 2026-08-21.
**Baseline:** `BASELINE.md`
**Governing documents:** Enterprise Constitution; ADR Policy; Automated Validation Rules; ADR-0001/0002/0003/0006/0007/0012/0016/0022/0023/0024

## Completion definition

The objective is complete only when a user can install a profile, select a conformant model or delegated runtime provider, run/resume/cancel a multi-turn agent task with governed tools, reconstruct every model request from durable events, compact context with lineage, create/join child agents, execute a bounded workflow, and substitute providers without changing Agent Kernel source. Required conformance, security, rollback and operational activation evidence must be green.

## Global invariants

1. HSEOS governance, authority, policy, approval and evidence remain provider-independent and fail closed.
2. Core packages import only provider ports; vendor SDKs remain in adapters.
3. Every model-visible input/output is reconstructable from immutable relational events.
4. Governed tool effects use ADR-0022 and reference its operation stream rather than duplicating it.
5. Provider capabilities and degradation are explicit, versioned and mechanically tested.
6. Cancellation and deadlines propagate to model streams, tools, workflows and children.
7. Context compaction preserves immutable originals and source lineage.
8. Profiles materialize exactly their selected providers and never emit secret values.
9. Development uses deterministic providers and temporary stores until activation is separately authorized.
10. A hosted adapter cannot claim L2/L3/L4 without passing the matching assembled conformance suite.

## Nodes

| Node | Deliverable                                                                                              | Depends on                  | Deterministic verification                                                                                                            | Gate / stop condition                                               |
| ---- | -------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A0   | Baseline, ADR-0024 and executable graph                                                                  | none                        | `npm run test:agentic-foundation`; `git diff --check`; strict code quality gate                                                       | Stop before architectural code until ADR accepted                   |
| A1   | Versioned provider, runtime, agent and event contracts                                                   | accepted ADR-0024           | schema/type fixtures, unknown-field rejection, capability-level matrix                                                                | Stop on ambiguous ownership or vendor leakage into core             |
| A2   | Relational agent-session event store and reconstruction                                                  | A1, ADR-0022 infrastructure | append ordering, replay, fork, request reconstruction and crash recovery                                                              | Temporary DBs only; stop on dual authority                          |
| A3   | ModelProvider registry, scripted provider, OpenAI-compatible streaming provider and normalized streaming | A1                          | two scripted routes plus an OpenAI-compatible adapter against a fake HTTP endpoint; stream assembly, tool deltas, usage, retry/cancel | No real credentials required; stop on provider-specific core branch |
| A4   | ContextAssembler and token budget                                                                        | A2, A3                      | precedence, skills, references, tool schemas, deterministic budget and overflow                                                       | Stop if model-visible context is not logged                         |
| A5   | General ToolRuntime integrated with governed execution                                                   | A1, ADR-0022                | pre/guard/approval/dispatch/post/result ordering, immutable outcomes, deadline/cancel                                                 | Stop if classified effect bypasses governed port                    |
| A6   | Headless AgentRuntime loop                                                                               | A2–A5                       | multi-turn tool journey, resume, interruption, limits and terminal outcome                                                            | Stop on unbounded loop or non-durable started work                  |
| A7   | Compaction and checkpoint providers                                                                      | A2, A4, A6                  | pressure trigger, tool-result pruning, lineage, byte-equivalent reconstructed request                                                 | Stop if originals are rewritten or provenance lost                  |
| A8   | SubagentProvider and WorkflowEngine                                                                      | A5–A7                       | parent/child scope, join/cancel, caps, phases, parallel/pipeline and teardown                                                         | Stop on authority widening or orphan child                          |
| A9   | RuntimeProvider seam and ACP bridge                                                                      | A1, A2, A5                  | L0–L4 negotiation, malformed event rejection, lifecycle/tool bridge                                                                   | Stop on overclaimed conformance                                     |
| A10  | Codex, Claude Code and DeepSeek adapters                                                                 | A9                          | adapter-specific manifests and declared-level suites; external smokes when available                                                  | No secret access; unsupported capability remains explicit           |
| A11  | Capability packaging, CLI and reference profile                                                          | A6–A10                      | exact install; `hseos agent run/resume/cancel`; clean-env assembled smoke                                                             | Operational activation still gated by G9 and human approval         |
| A12  | Security, performance and completion audit                                                               | A0–A11                      | threat model, full gates, provider substitution, replay, fault injection and independent refutation                                   | Goal remains active on any weak/missing evidence                    |
| A13  | Operational activation and compatibility closeout                                                        | A12, harness-unification G9 | migration dry-run, rollback rehearsal, zero-use evidence, certified profile                                                           | Hard human gate before schema/protocol/runtime cutover              |

## Execution waves

1. **Foundation:** A0–A2 establish authority, contracts and durable session facts.
2. **Kernel:** A3–A7 implement inference, context, tools, loop and compaction.
3. **Orchestration:** A8–A10 add children, workflows and delegated runtimes.
4. **Productization:** A11 packages the headless framework and provider profiles.
5. **Proof and activation:** A12 independently refutes completeness; A13 waits for operational authority/evidence.

## Post-reference hardening extension — 2026-08-24

| Node | Claude Code learning                                                 | Result                          | Gate                                                                         |
| ---- | -------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| A14  | Restricted egress prerequisite                                       | Completed                       | Networkless worker; supervisor-owned Unix broker and credential              |
| A15  | Permission plus configuration/provenance lattice (proposals 1 and 5) | Completed                       | Monotonic policy; restrictive merge; child cannot widen                      |
| A16  | Transitive isolation (proposal 2)                                    | Completed                       | Real five-role sandbox proof; no host/network/environment escape             |
| A17  | Provider-neutral Agent Message Transport (proposal 3)                | Completed                       | Durable text-only semantics; bounded policy-aware delivery                   |
| A18  | Hosted worker lifecycle (proposal 4)                                 | Completed                       | Durable leases, drain/park/orphan/retire and fencing                         |
| A19  | Supervisor-owned credential injection (proposal 6)                    | Completed with partial adoption | Pinned narrow host injection retained; generic sentinel transformer rejected |
| A20  | Continuous trace lineage (proposal 7)                                | Completed                       | Durable W3C root, causal anchors, defer/replay and delegated reattach        |
| A21  | Integrated seven-proposal disposition and conformance                | Completed                       | Exact verdict catalog, full quality gate, no activation authority            |
| A22  | Canonical agent-provider conformance matrix                          | Completed                       | Exact profiles, manifests, bindings and descriptor-bound suites; no activation authority |

This extension hardens A1–A14 without changing A13's activation prerequisites or introducing a provider-specific branch into the kernel. A22 also removes phantom model ownership from hosted profiles and makes provider certification a canonical, non-injectable operation.

## Mandatory assembled journeys

- `provider-substitution`: the scripted provider and OpenAI-compatible provider against a fake endpoint execute one task through the same kernel with equivalent normalized events; optional real-API smoke is separate.
- `governed-tool`: approval-required tool cannot dispatch before durable authorization and returns canonical evidence.
- `resume-reconstruct`: process restarts, reconstructs the exact next request and continues once.
- `cancel-tree`: root cancellation settles model, active tool, workflow and all descendants within deadline.
- `compact-lineage`: context shrinks without deleting originals or losing source lineage.
- `runtime-delegation`: an ACP provider reports its level honestly and cannot execute classified effects when below L1.
- `exact-profile`: minimal/provider profiles contain exactly selected core/provider artifacts and no secret values.
- `external-world`: task success is verified by reading resulting state, never by trusting agent prose.

## Rollback

Each code node uses an isolated `task/*` worktree and one accepted commit. Before activation, revert the node and delete only its generated/temporary artifacts. After activation, disable the provider profile and replay projections from canonical events; never delete session or governed execution ledgers.

## Execution checkpoint — 2026-08-23

- A0–A12 are integrated and the operational release remains on MCP `2024-11-05` and state schema v4.
- A13 private-copy migration/rollback and the OpenAI-compatible candidate-profile contract pass against the real schema-v4 state; no operational mutation or provider call occurred.
- A13 now has a strict immutable provider binding and sandbox-gated environment-probe path; structural validation loads neither credentials nor network resources.
- A13 now has one common temporary Agent Kernel assembly for the scripted reference and bound OpenAI-compatible profiles. The bound path persists the exact binding and sandbox attestation, supports run/resume/cancel, and proves equivalent outcomes across two provider bindings against fake endpoints.
- The public candidate route now exists behind an external `ai-jail` supervisor. It forces required readiness, accepts only the exact lockdown profile and endpoint port, hashes the canonical executable/configuration, minimizes the child environment and rejects credential reflection before normalized provider events are persisted. The real host still lacks the external runtime, so no live sandbox or provider is claimed.
- A13 is still waiting on required sandbox readiness, selected provider-environment validation, harness-unification G9's 30 consecutive complete zero-use days, final stable-snapshot audit and explicit human cutover authorization.
- The live observation monitor is evidence-only and leaves `ready_for_cutover` and `cutover_authorized` false under every telemetry outcome.
