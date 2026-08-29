# `@hseos/agent-context`

**Artifact type:** Provider-neutral Agent Kernel context service
**Scope:** Deterministic instruction precedence, source lineage, tool schemas, token budgets and durable model requests
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0002; ADR-0003; ADR-0024; Automated Validation Rules

This package assembles model-visible context through one fail-closed operation: `ContextAssembler.assembleAndRecord`. A request is returned only after its complete normalized messages, tool schemas, source references, budget accounting and overflow decision have been appended as a `context.assembled` session event and reconstructed byte-equivalently by `@hseos/agent-session-store`.

Instruction sources follow the canonical high-to-low tiers `constitution`, `project`, `adapter`, `agent` and `skill`. Runtime context and references are explicitly labelled as data, not instructions. Required sources and the current user turn are never silently truncated. History is reconstructed from completed durable turns rather than accepted from the caller. With `truncate_optional`, recent history is selected first, followed by priority-ordered memory; only whole entries may be omitted, and their source references remain in the durable budget report.

With `compact`, an injected nominal `CompactionRuntime` is consulted only after measured pressure exceeds the input budget. The oldest contiguous history prefix becomes one bounded replacement while the newest suffix remains verbatim. `compaction.completed` and `context.assembled` are appended atomically; the former embeds source digest, complete event lineage, exact replacement and immutable checkpoint reference. Replay reconstructs and validates the model request without reading that checkpoint.

Provider limits come from an immutable snapshot created by `ModelProviderRegistry`; request input cannot replace or widen that manifest. Session capacity is derived from the durable usage stream. `ConservativeUtf8TokenCounter` counts canonical UTF-8 bytes as a conservative provider-neutral planning unit. Deployments may inject a provider-specific deterministic counter with the same port; the assembler rejects non-integer, negative or non-repeatable results across the operation. Messages, tool definitions and model parameters all participate in the recorded input budget.

The package does not load files, resolve credentials, call a model or activate an operational database. Rollback before activation is the A4 task commit. Canonical session events must never be deleted after activation.
