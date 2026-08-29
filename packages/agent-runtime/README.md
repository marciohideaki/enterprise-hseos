# HSEOS Agent Runtime

**Artifact type:** Agent Kernel runtime package  
**Scope:** Bounded, headless, model-neutral agent loop over durable context, provider and governed tool ports  
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0022; ADR-0024

`@hseos/agent-runtime` implements the kernel-owned `AgentRuntime` port (`create`, `resume`, `send`, `cancel`, `dispose`). It starts no model request or tool execution until the exact intent is durable in the relational session stream. Provider output, tool intent/outcome, governed operation links, cancellation intent and the single terminal session outcome are appended in order.

The loop is bounded by the durable session limits for turns, tokens, duration and tool calls. Tool-call continuations are complete model requests with lineage to the preceding model terminal event and durable tool outcomes. A restart can replay an unstarted request, resume an idempotent governed tool execution, continue after recorded tool results or fail closed when a partial provider stream cannot be resumed safely.

The package owns no model, tool or compaction implementation. It resolves a model from one immutable registry snapshot and invokes tools only through a nominal `ToolRuntime`. When a profile selects `compact`, it requires a registered `CompactionProvider` supporting both history summaries and tool-result pruning. Large settled tool bodies are replaced by ordered tool messages that preserve call identity, status, evidence, warnings and an original-result digest before the continuation request becomes durable.

Every governed tool input receives the trace root recovered from the durable session store rather than a runtime-local identifier. Restart, compaction, deferral and continuation therefore retain one trace while individual durable events provide deterministic span identities.

Subagents and workflows remain behind the A8 orchestration ports and do not introduce vendor branches into this loop. Delegated runtimes and operational activation remain separate graph nodes.
