# HSEOS Tool Runtime

**Artifact type:** Agent Kernel runtime package  
**Scope:** Model-neutral tool discovery and execution through the ADR-0022 governed boundary  
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0012; ADR-0022; ADR-0024; Tool Design Governance Standard

`@hseos/tool-runtime` is the only Agent Kernel-facing boundary for model-visible tools. It does not own providers, authority, policy, approvals, dispatch or an execution ledger. Each registered definition must resolve to the same governed execution contract used by the injected scheduler, and every invocation is enqueued through that scheduler.

The public `ToolRuntime` port is `list`, `execute`, `cancel` and `dispose`. Inputs and outputs use strict version-1 contracts from `@hseos/agent-runtime-contracts`; unknown fields, duplicate active invocation identifiers, unregistered tools, malformed canonical outcomes and scheduler/registry contract drift fail closed. Resolved results are deeply immutable.

Cancellation remains governed: an active handle delegates cancellation to the scheduler, which persists queued cancellation through the execution port and propagates cooperative cancellation to running providers. `dispose` requests cancellation only for invocations belonging to the specified agent session, reports whether every request was accepted without waiting on a non-cancellable effect, and does not shut down a scheduler shared by other sessions. The execution promise remains the source of the eventual durable terminal outcome.

## Wiring

Create ADR-0022 `ExecutionContractRegistry`, `GovernedExecutionRuntime`, governed execution port and `GovernedExecutionScheduler` as usual. Build a `ToolRuntimeRegistry` with that exact contract registry, register only model-visible tool definitions using `governance://tool/<contract-name>`, then inject the tool registry and scheduler into `ToolRuntime`. The constructor rejects an unsealed execution-contract registry, a scheduler backed by a different resolver or a scheduler without the governed execute/cancel port.

This package deliberately exposes no direct provider dispatch hook. Tool results retain the canonical governed `operation_id`, evidence references, warnings, replay marker and terminal status for durable linking by the Agent Kernel.
