# Agent Trace Lineage

**Scope:** Deterministic provider-neutral trace identity and W3C projection

HSEOS keeps the relational ledger as canonical authority. A trace ID is deterministically rooted in the first session correlation and inherited by every child session and governed tool operation. Span IDs are deterministic projections of durable event identities; `traceparent` is an outbound projection and never replaces persisted causation, evidence, or operation links.

Retries, hook deferrals, workflow phases, subagents, and provider reattachment must retain the original trace ID. Lower layers may create child spans but cannot replace the trace root. No telemetry exporter is required for correctness, and disabling OTLP cannot remove lineage from the ledger.
