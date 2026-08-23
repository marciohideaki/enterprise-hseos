# @hseos/agent-orchestration

**Artifact type:** Runtime package documentation  
**Scope:** Bounded local subagents and durable workflows  
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0002; ADR-0003; ADR-0022; ADR-0024

`LocalSubagentProvider` forks child sessions through the relational session store, preserving the exact parent sequence and enforcing identical authority/policy plus non-widening resource limits. The atomic fork also records `subagent.requested`, binding provider, turn and message before execution so a pre-checkpoint retry cannot silently change child input. Child work executes only through the versioned `AgentRuntime` port. Join deadlines cancel and settle every descendant; returning with an active orphan is forbidden.

`WorkflowEngine` executes ordered phases in `parallel` or `pipeline` mode. Parallel groups are bounded by both the workflow and provider manifests, and their worst-case join windows must fit the parent duration ceiling. Before dispatch the engine atomically records `workflow.reserved`; this consumes the step/child ceiling and survives a crash before the first checkpoint. An active reservation can only resume through its exact `resume_from_ref` after its parent-bounded lease expires. `workflow.reclaimed` then rotates the claim atomically across SQLite connections, while spawn, checkpoint and release remain fenced by the captured claim. Each completed phase writes `workflow.phase.checkpointed`, and terminal teardown writes `workflow.released` with an exact status. The earlier single-step `workflow.checkpointed` event remains readable as a compatibility input. Reusing an identifier for a different definition fails closed.

Cancellation and failure always invoke bounded child teardown. The package performs no provider-specific inference, secret access, external write, deployment or activation.
