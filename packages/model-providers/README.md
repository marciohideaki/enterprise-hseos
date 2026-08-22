# `@hseos/model-providers`

**Artifact type:** Provider-neutral model adapter layer
**Scope:** Immutable provider discovery, deterministic scripted inference and normalized OpenAI-compatible streaming
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0002; ADR-0003; ADR-0024; Automated Validation Rules

This package implements the `ModelProvider` port defined by `@hseos/agent-runtime-contracts`. The Agent Kernel consumes only normalized stream events and never branches on a vendor, SDK or wire format.

The registry creates immutable routing snapshots so an in-flight session retains the provider and manifest it selected. The scripted provider supplies deterministic text, reasoning, tool-call, usage and cancellation fixtures. The OpenAI-compatible adapter translates incremental SSE responses into the same normalized events, maps canonical assistant/tool continuation messages to the wire format, bounds its parser, retries only before observable output, supports cancellation and resolves credentials exclusively through manifest references and an injected resolver.

The adapter does not include a vendor SDK, persist secret values or contact a provider during package initialization. Tests use a loopback fake HTTP endpoint and no real credentials.

Rollback before activation is the A3 task commit. After activation, disable the affected provider profile and retain canonical session events; do not delete session or governed execution ledgers.
