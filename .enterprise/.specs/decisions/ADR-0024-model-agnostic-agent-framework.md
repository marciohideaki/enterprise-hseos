# ADR-0024 — Model-Agnostic Agent Framework and Substitutable Runtime Providers

**Status:** Accepted
**Date:** 2026-08-21
**Authors:** Platform Architecture (draft prepared by execution agent)
**Affects Standards:** Agent Rules; Tool Design Governance; Event Sourcing; CQRS; Security & Identity; ADR-0001; ADR-0002; ADR-0003; ADR-0006; ADR-0007; ADR-0012; ADR-0014; ADR-0016; ADR-0022; ADR-0023
**Supersedes:** N/A
**Superseded By:** N/A

---

## Status

Accepted by explicit human authorization on 2026-08-21. Agent Kernel implementation may proceed through the governed A1–A13 goal graph; activation remains separately gated.

## Artifact Scope and Governance

- **Artifact type:** Architecture Decision Record
- **Scope:** HSEOS Agent Kernel, model/runtime provider seams, sessions, context, tools, workflows, subagents, compaction, packaging and activation.
- **Governing documents:** Enterprise Constitution; ADR Policy; Automated Validation Rules; ADR-0001/0002/0003/0006/0007/0012/0016/0022/0023.

## Context

HSEOS is currently a strong engineering-governance control plane. It compiles portable instructions, skills, agents, hooks, MCP servers, workflow definitions, state tracking, authority rules, approvals, evidence, and delivery gates into Codex, Claude Code, and Goose surfaces. The host runtime still owns the model loop, model request, tool-call lifecycle, context pressure, compaction, and most session semantics.

ADR-0022 introduced a Governed Execution Runtime for HSEOS domain operations. It deliberately rejected replacing HSEOS with a parallel agent runtime, and it does not define model inference, turn/step lifecycle, reconstructable model requests, or provider-neutral agent sessions. The runtime remains fixture-only until the compatibility and activation gates in ADR-0022/0023 complete.

The approved product objective now expands HSEOS into a complete model-agnostic agent framework in which models and agent runtimes are substitutable providers. HSEOS must retain its governance advantages while gaining an execution plane that does not depend on one model vendor or one closed coding-agent product.

“Model-agnostic” cannot mean pretending every provider has identical capabilities. Raw model APIs and hosted agent products expose different control boundaries. Hosted coding agents may own their loops, while OpenAI-compatible, Anthropic-compatible, local or self-hosted endpoints may expose raw inference. A truthful framework needs separate contracts and conformance levels for those modes.

## Decision

HSEOS will add a vendor-neutral Agent Kernel and two distinct provider seams: `ModelProvider` and `RuntimeProvider`. HSEOS remains the governance authority. Providers supply inference or delegated runtime execution but cannot redefine authority, approval, evidence, state ownership, or delivery policy.

### Architectural planes

1. **Governance Plane:** constitution, authority, policy, approvals, ADRs, evidence, SDLC, delivery and compatibility gates.
2. **Agent Kernel:** agent/session lifecycle, context assembly, model turns, tool pipeline, compaction, subagents, workflows, cancellation and terminal outcomes.
3. **Provider Plane:** raw model providers, delegated agent runtime providers, tool providers, sandbox providers and persistence adapters.
4. **Projection Plane:** relational session/execution facts, query projections, telemetry, UI and portable exports.

The planes communicate only through versioned ports. Generated adapters remain outputs, never authoring sources.

### Provider distinction

`ModelProvider` supplies raw inference to the HSEOS-owned loop. Its normalized contract covers:

- provider/model discovery and declared capabilities;
- streaming content, reasoning, tool-call deltas and usage;
- context/output limits;
- cancellation and bounded retry classification;
- provider request/response metadata safe for durable evidence;
- deterministic error taxonomy.

`RuntimeProvider` delegates an agent run to a hosted coding agent or an ACP-compatible runtime. Its contract covers:

- create, resume, send, cancel and dispose;
- session identity and ownership;
- lifecycle and model/tool event delivery;
- capability negotiation;
- approval/tool-governance interception where supported;
- evidence, terminal outcome and degraded-mode declarations.

A provider may implement both seams, but they remain separate contracts.

### Runtime conformance levels

Every runtime adapter declares and proves exactly one effective level per capability set:

| Level               | Required behavior                                                                       |
| ------------------- | --------------------------------------------------------------------------------------- |
| L0 Instructions     | Receives portable instructions, skills and policy metadata.                             |
| L1 Tools            | Consumes governed HSEOS tools and preserves canonical results/evidence.                 |
| L2 Lifecycle        | Exposes session identity, lifecycle events, cancellation and approval outcomes.         |
| L3 Governed Runtime | Satisfies the full Agent Kernel session/tool/context contracts.                         |
| L4 Certified        | L3 plus sandbox, replay, compaction lineage, telemetry and assembled conformance tests. |

Missing capabilities are explicit. Adapters never silently emulate a stronger level or broaden authority.

### Canonical Agent Kernel contracts

1. `AgentRuntime` owns create/resume/send/cancel/dispose, turn/step state and one terminal outcome.
2. `SessionEventStore` is append-only, relational and versioned. Every model-visible input and output is reconstructable from events. JSONL and Markdown are exports/projections only.
3. `ContextAssembler` deterministically composes instruction precedence, skills, memory, referenced files, runtime context, available tools and token budget.
4. `ToolRuntime` provides registry, schema validation, pre-execute governance, monotonic guards, approval, sandbox/provider dispatch, timeout/cancellation, post-execute processing, immutable result observation and evidence.
5. `WorkflowEngine` owns bounded phases, pipelines, parallel work, child agents, checkpoints, stop conditions and resource caps.
6. `CompactionProvider` reports token pressure and emits lineage-preserving replacement events. Original session events remain immutable.
7. `SubagentProvider` creates child sessions with explicit parent/initiator scope, authority ceiling and join/cancel semantics.
8. `ProviderRegistry` resolves named providers from an immutable per-run capability snapshot. Provider hot reload cannot change a running session’s contract silently.

### Relationship to ADR-0022

ADR-0022 remains authoritative for governed operation dispatch and the relational execution ledger. The Agent Kernel must call its governed execution port for classified tool effects. It must not duplicate approval, authority, operation idempotency, or evidence semantics.

Agent/session events and governed operation events are separate aggregates sharing the same relational authority and global ordering infrastructure. A tool call references its governed `operation_id`; it does not copy or reinterpret the operation stream.

### Reference runtime and adapters

HSEOS will ship a minimal headless reference runtime that owns the Agent Kernel and can run against substitutable `ModelProvider` implementations. It is not an LLM and contains no vendor model logic in the core.

The first required providers are:

- a deterministic scripted model provider for keyless conformance;
- an OpenAI-compatible streaming provider as the first raw-provider family;
- a delegated runtime adapter contract with ACP as the reference wire path;
- hosted adapters for Codex and Claude Code that declare only the levels their actual hooks/tools expose;
- an external ACP process adapter evaluated through protocol and effect-governance boundaries without vendoring another runtime.

Provider-specific packages depend inward on ports; the Agent Kernel never imports a vendor SDK directly.

### Security and failure policy

- Authority, policy, approval, relational append, evidence and required sandbox checks fail closed.
- Model/provider errors never bypass tool governance or mutate terminal history.
- Cancellation propagates from parent run to model stream, tool calls, workflows and children; every started unit settles durably.
- Runtime-provided events are untrusted boundary input and require schema, ordering, identity and size validation.
- Credentials are resolved by provider adapters and never enter prompts, events, tool schemas or canonical configuration output.
- Provider capability downgrade after run creation fails the run or requires explicit restart; it never silently weakens guarantees.
- A delegated runtime below L3 cannot be described as full HSEOS execution.

### Packaging and portability

Agent Kernel, provider contracts and conformance tests become capability components. Profiles select providers explicitly. A selected provider set must exactly match emitted configuration and runtime discovery.

The existing Codex, Claude Code and Goose instruction adapters remain supported as L0/L1 surfaces during migration. Their existence does not prove Agent Kernel conformance.

### Activation

All implementation begins against temporary databases and deterministic providers. Operational activation remains separate from code completion and requires:

1. ADR-0022/0023 compatibility evidence and migration gate;
2. accepted provider/security configuration;
3. assembled conformance tests for the activated profile;
4. migration dry-run and rollback evidence;
5. explicit human authorization.

## Alternatives Considered

| Alternative                               | Why rejected                                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Continue only as a governance overlay     | Cannot provide uniform session, context, compaction, tool, cancellation or replay semantics.                                       |
| Adopt another execution harness           | Creates a parallel runtime, imports unrelated surface area and conflicts with HSEOS ownership.                                      |
| Treat Codex/Claude as model providers     | They are hosted agent runtimes and do not expose the same boundary as raw inference APIs.                                          |
| One lowest-common-denominator adapter API | Hides missing capabilities and weakens providers that expose stronger lifecycle guarantees.                                        |
| Put provider behavior in MCP servers      | MCP is a tool/integration adapter, not an owner of agent lifecycle or model turns.                                                 |
| Build a proprietary HSEOS model           | Outside the objective; HSEOS owns framework semantics, not model weights.                                                          |

## Consequences

### Positive

- HSEOS becomes a complete agent framework without model lock-in.
- Governance applies consistently whether HSEOS owns the loop or delegates it.
- Providers are replaceable through explicit capabilities and conformance evidence.
- Existing skills, workflows, state, approvals and delivery governance become runtime-enforceable.
- Provider capabilities enter through explicit ports without creating a parallel source of truth.

### Negative / Trade-offs

- HSEOS assumes permanent ownership of session schemas, provider compatibility and agent-loop correctness.
- A reference runtime, streaming parser, context budgeter and conformance suite add substantial maintenance surface.
- Hosted runtimes may never reach L3 because their products do not expose enough lifecycle control.
- Operational activation is coupled to the unfinished G9 evidence even when fixture implementation is complete.
- Supporting multiple provider families requires compatibility testing and release discipline.

## Risks

- **Framework inflation:** adding unrelated client surfaces obscures the kernel. Mitigation: keep the reference runtime headless; UI/LSP/terminal remain provider capabilities.
- **False portability:** adapters claim uniformity without proof. Mitigation: capability negotiation and level-specific conformance suites.
- **Dual event authority:** session and execution state diverge. Mitigation: one relational global ordering infrastructure and reference IDs between aggregates.
- **Approval bypass:** delegated runtimes execute tools outside HSEOS. Mitigation: L1+ requires governed tool routing; otherwise the adapter is L0 and cannot run classified effects.
- **Credential leakage:** provider config enters context or logs. Mitigation: secret references only, classified schemas and regression scans.
- **Unbounded cost:** model loops or workflows do not converge. Mitigation: turn, token, time, tool, child and workflow budgets with durable stop reasons.

## Mitigations

- Implement one reversible goal node at a time in isolated worktrees.
- Start with deterministic providers and temporary stores.
- Require event reconstruction and provider-substitution tests before real API adapters.
- Maintain a feature matrix generated from provider manifests and conformance output.
- Preserve hosted adapters at honest lower levels when their runtime cannot expose full control.
- Keep G9 and production activation as hard human gates.

## Compliance

- [x] Approved by Engineering Leadership
- [ ] Agent Rules and Tool Design standards updated
- [ ] Provider manifests and conformance schema accepted
- [ ] Deterministic reference runtime passes assembled tests
- [ ] At least two model providers prove substitution through the same Agent Kernel contract
- [ ] At least two runtime providers prove their declared levels
- [ ] Security/threat-model review completed
- [ ] Operational activation explicitly authorized

## Validation

- Two model providers produce the same normalized lifecycle for the same scripted tool journey.
- Provider substitution requires configuration only; no Agent Kernel source change.
- Session replay reconstructs every model request byte-equivalently modulo declared provider serialization.
- A tool call cannot dispatch before governed authorization/start facts commit.
- Cancellation settles model stream, active tools, workflow and children within configured deadlines.
- Compacting history preserves source lineage and replayable original events.
- A delegated runtime that omits lifecycle or tool interception fails the corresponding L2/L3 suite and is reported at its lower level.
- Minimal profile materializes no unselected provider or provider secret configuration.
- Keyless headless assembled test completes a multi-turn tool task, resumes it, and verifies external world state rather than agent self-report.

## Rollback

- Before activation, revert isolated task commits and remove generated provider surfaces.
- The existing hosted instruction adapters and schema-v4 operational state remain the fallback until a separately authorized cutover.
- After activation, disable the affected provider profile and replay session/operation projections from the relational ledger; never delete canonical events.
- Reversing the Agent Kernel authority or merging session/execution aggregates requires a superseding ADR.

## References

- ADR-0001, ADR-0002, ADR-0003, ADR-0006, ADR-0007, ADR-0012, ADR-0014, ADR-0016
- ADR-0022 and ADR-0023
- `_graph/agentic-framework/BASELINE.md`
- `_graph/agentic-framework/GOAL-GRAPH.md`
