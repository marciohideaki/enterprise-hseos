# HSEOS Governed Execution

**Artifact type:** Runtime boundary package  
**Scope:** Canonical ADR-0022 execution envelope, operation identity and bounded scheduler

`@hseos/governed-execution` publishes the provider-independent scheduling primitive shared by operational entrypoints and the Agent Kernel. `GovernedExecutionScheduler` accepts work only through a governed execution port, preserves exclusive barriers, persists queued cancellations through that port and returns the canonical six-field outcome envelope.

The package contains no provider, authority, policy, approval store or ledger implementation. Those remain injected into the ADR-0022 runtime. Private port/scheduler registrations and immutable runtime bindings provide a nominal boundary: Agent Kernel tool execution rejects structural lookalikes, forged prototypes and overridden schedulers that could dispatch outside governance.
