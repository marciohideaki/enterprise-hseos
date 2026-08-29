# A12 Threat Model — Model-Agnostic Agent Framework

**Artifact type:** Security threat model
**Scope:** HSEOS Agent Kernel, provider boundaries, context, relational events, governed tools, compaction, orchestration, CLI reference profile and delegated runtimes
**Governing documents:** Enterprise Constitution; Security & Identity Standard; ADR-0012; ADR-0022; ADR-0024; Automated Validation Rules
**Baseline:** `cf80117`
**Status:** Accepted for pre-activation evidence; production activation remains prohibited until A13

## Security posture

The framework treats models and delegated runtimes as untrusted providers. HSEOS owns authority, policy, approvals, durable facts, capability negotiation and terminal truth. Provider output can propose text or tool calls but cannot directly mutate governed state. The reference profile is keyless, temporary and deliberately non-operational.

This assessment is about the implemented boundary, not the trustworthiness of a particular model. No real credential, remote model, operational database, production sandbox or external write was used.

## Assets and trust boundaries

| Asset | Boundary | Required property |
| --- | --- | --- |
| Authority and policy decisions | Governance plane → ToolRuntime | Provider-independent, fail closed, operation-bound |
| Model-visible context | ContextAssembler → ModelProvider | Complete durable reconstruction and source lineage |
| Session truth | Provider/runtime events → relational ledger | Strict schema, ordered identity, append-only terminal truth |
| Governed effects | Model tool call → execution scheduler | Authorization and durable start precede dispatch |
| Secrets | Secret resolver → provider adapter | Reference-only configuration; value never enters canonical events |
| Compaction lineage | CompactionProvider → session event | Originals immutable; replacement digest and ordered sources retained |
| Child/workflow authority | Parent session → SubagentProvider | No authority/resource widening; bounded fan-out and cancellation |
| Reference workspace | CLI → local filesystem | Private, regular, canonical temporary directory; identity rechecked before effect |
| Delegated runtime | ACP/hosted driver → RuntimeProvider | Honest L0–L4 claim; malformed or unsupported effects fail closed |

## Threat analysis

| ID | Threat | Control and deterministic evidence | Residual risk |
| --- | --- | --- | --- |
| T1 | Prompt/provider attempts to bypass tool governance | Tool definitions bind to governed contracts; approval and durable intent precede dispatch; `test-tool-runtime` verifies denial/order/replay | A provider below L1 cannot execute classified effects and remains intentionally limited |
| T2 | Provider event forgery, identity drift or oversized stream | Strict versioned schemas, request/provider/session correlation, sequence and byte/event caps | New adapters require the same conformance suite before support |
| T3 | Credential disclosure through config, prompts, events or errors | Manifests accept secret references only; adapter resolves at dispatch; sensitive event keys rejected; errors sanitized | External secret-manager policy is an A13 environment decision |
| T4 | Replay duplicates a mutation | Tool idempotency binds actor, resource, contract and input; uncertain effects are never automatically redispatched | Non-idempotent provider recovery still requires explicit human handling |
| T5 | Partial/crashed model stream produces false success | Recovery distinguishes unstarted, partial and terminal streams; partial streams fail closed | Provider-side effects outside governed tools cannot be reconstructed and are forbidden below L1 |
| T6 | Context compaction deletes or rewrites evidence | Original events remain immutable; replacement has digest, accounting and ordered source IDs | Semantic quality of a non-deterministic future compactor needs provider-specific evals |
| T7 | Child or workflow widens authority or becomes orphaned | Durable reservation/claim fencing, authority ceiling, recursive cancellation and join verification | Host process kill beyond the tested persistence boundary needs A13 operational rehearsal |
| T8 | Capability downgrade or provider substitution weakens guarantees | Immutable registry snapshots and strict L0–L4 negotiation reject overclaim/underclaim | Hosted and ACP adapters remain honest L0 until stronger boundaries exist |
| T9 | Filesystem alias redirects a reference tool effect | Temporary marker, regular-file checks, canonical parent, private permissions, device/inode binding and pre-effect revalidation | Reference filesystem tool is a fixture, not a general sandbox |
| T10 | Optional sandbox is mistaken for production isolation | Capability catalog explicitly declares external `ai-jail` and fail-soft default; activation remains blocked | Material production risk: A13 must choose and verify a required sandbox policy |
| T11 | Malformed HTTP/SSE response becomes successful session | Parser bounds frames and terminalizes protocol failures; A12 injects malformed transport and proves no `session.completed` | HTTP endpoint authenticity/TLS belongs to activated provider configuration |
| T12 | Test fixture inherits Git hook repository state | ADO fixtures derive their root from the filesystem and clear repository-local Git variables before temporary commits | Future fixture repositories must follow the same hermetic rule |
| T13 | A root cancellation reports success while runtime, tool, workflow or descendants remain active, or relabels a different terminal outcome | `AgentExecutionSupervisor` initiates workflow and root/runtime cancellation independently, awaits all branches under one deadline, requires the root terminal to be `session.cancelled` and verifies durable truth recursively; workflow release is durable before child teardown. A12 exercises a real governed tool, two model-active descendant levels, a non-settling workflow cancellation and an already-completed root | Host termination during cancellation still requires A13 crash/rollback rehearsal |
| T14 | Replay/reconstruction degrades without a declared bound | A12 measures reopened file-backed ledgers at 23/135/519 events with 25 samples each and enforces p95, database-size, heap-growth and scaling ceilings | This is a bounded fixture workload, not production capacity certification |

## Abuse cases explicitly refuted

- A model cannot call an unregistered tool or dispatch before authority/policy evaluation.
- A workspace replaced with an escaping symlink is rejected before the reference effect.
- A mutated provider manifest cannot resume a session bound to the earlier digest.
- An L0 runtime permission request or tool effect is denied and terminalized.
- A malformed or partial provider stream cannot be followed by false success.
- A stale resume sequence cannot continue a session.
- A compactor cannot erase the source events that produced its replacement.
- One root cancellation cannot report success until its governed tool, workflow, active model work and recursively discovered descendants are durably terminal.

## Activation blockers

1. The operational state remains schema v4; pending execution/session schemas are fixture-only.
2. The production provider allow-list, endpoints, TLS policy and secret resolver are not selected.
3. Sandbox enforcement is optional by default and must become required for the activated effect classes.
4. Hosted and ACP delegated adapters are L0, not L3/L4.
5. Migration dry-run, rollback rehearsal, G9 zero-use evidence and explicit human cutover authority belong to A13.

These are not hidden implementation claims. They are hard activation gates and keep the pre-activation framework from being presented as production-active.

## Rollback

Before activation, revert the isolated A12 commit; A0–A11 remain intact. A12 introduces a local execution supervisor, conformance tests and audit artifacts but no runtime cutover, schema migration, external dependency or credential state.
