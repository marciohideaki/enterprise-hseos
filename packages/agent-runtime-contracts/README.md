# HSEOS Agent Runtime Contracts

**Artifact type:** Runtime contract package
**Scope:** Versioned Agent Kernel, model-provider, delegated-runtime and session-event boundaries
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0022; ADR-0024; Automated Validation Rules

`@hseos/agent-runtime-contracts` is the vendor-neutral inward boundary of the HSEOS Agent Kernel. It contains strict data schemas, provider capability negotiation and runtime checks for the four canonical ports. It contains no model implementation, provider SDK, network client, persistence adapter or operational activation.

## Public boundaries

- `ModelProvider`: supplies discovery and normalized streaming inference to an HSEOS-owned loop.
- `RuntimeProvider`: delegates a session to an external agent runtime at an explicitly negotiated L0–L4 level.
- `AgentRuntime`: owns the HSEOS create/resume/send/cancel/dispose lifecycle.
- `ToolRuntime`: exposes model-visible tools and routes execution/cancellation through ADR-0022 governance.
- `SessionEvent`: immutable, versioned session facts consumed by the relational store introduced in A2.

Every object schema is strict and requires `schema_version: 1`. Unknown fields and unsupported versions fail closed. Tool invocations carry session, turn, call, actor, resource-scope, idempotency and causal identities; outcomes preserve the governed operation reference and terminal semantics. Secret values are not contract fields; provider manifests may contain unique named references with an explicit secret-source URI only.

`assertPortShape` checks the method surface without executing effects. Every resolved call must additionally cross `validatePortInput` and `validatePortResult`; the latter requires the original input and rejects identity drift between the call, result and stream. Stream wrappers enforce exact sequence progression and validate every item before the kernel observes it. Provider failures cross a deterministic, vendor-neutral `PortError` taxonomy. A function-shaped implementation is therefore not behavioral conformance by itself.

Model and delegated-runtime stream envelopes carry provider/request or provider/runtime-session identities. Text deltas are capped at 256 KiB and delegated tool inputs at 1 MiB per event. Kernel-owned model steps additionally carry durable request lineage, assistant tool calls, governed tool outcomes and cancellation intent. Per-step event and byte ceilings reserve room for a terminal event even when a provider exhausts its stream allowance. Larger, cyclic or mis-correlated boundary values fail closed before reaching the kernel.

## Conformance

Runtime levels are cumulative and exclusive. A manifest’s declared level must equal the highest level implied by its capability set, preventing both overclaim and silent underclaim. `negotiateRuntimeCapabilities` additionally checks the consumer’s required level and known capability set without weakening the provider declaration.

The package validates boundaries; it does not grant authority. Governed tool effects remain owned by ADR-0022 and are connected through durable `operation_id` references.
