# ADR-0008 — Structural Execution Governance

**Status:** Accepted
**Date:** 2026-03-22
**Authors:** HSEOS Runtime Governance
**Affects Standards:** Enterprise Automated Validation Rules, HSEOS Runtime Governance
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

HSEOS already enforced governance structurally for documentation, ADRs, and repository workflow,
but execution-time selection of modules, tool integrations, custom content sources, and install
targets remained largely procedural.

That left a governance gap:

1. Runtime-affecting choices could be made without deterministic policy evaluation.
2. Tool visibility and selection had no enterprise-controlled policy pack.
3. Installation and update execution could proceed without a fail-closed structural check.

The enterprise model requires execution boundaries to be explicit, versioned, inspectable, and
enforced before runtime mutation occurs.

## Decision

HSEOS will introduce **Structural Execution Governance** as a first-class runtime control layer.

Effective immediately:

- execution governance is expressed in versioned policy packs under `.enterprise/policies/execution/`
- HSEOS resolves a named policy pack from framework or project configuration
- policy packs are evaluated before installation, update, or compile-agent execution proceeds
- tool visibility can be structurally constrained before tool choices are presented
- denied execution requests fail closed with explicit evidence

The public CLI surface for this capability is:

- `hseos policy validate <policy-file>`
- `hseos policy explain <policy-file>`

## Consequences

### Positive
- Execution boundaries become deterministic and auditable.
- Runtime governance moves from convention into enforceable artifacts.
- Tool visibility, module selection, and custom content ingress can be constrained centrally.

### Negative / Trade-offs
- Installer flow gains an additional preflight step.
- Governance pack authors must maintain policy YAML alongside operational needs.

### Risks
- Overly strict default policies could block legitimate install flows.
  Mitigation: ship a permissive foundation pack and document override points.

- Divergence between framework and project policy packs could confuse operators.
  Mitigation: resolve project-local policy first, otherwise fall back to framework defaults.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Enterprise Automated Validation Rules | Execution stop behavior | Adds fail-closed structural execution checks before mutation |
| Runtime Governance | Execution input control | Introduces policy packs for tools, modules, paths, and custom content |
| CLI Governance | Operational inspectability | Adds policy validation and explanation commands |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Affected standards updated to reference this ADR
- [x] Activation date: 2026-03-22
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep governance only in documentation and prompts | Not deterministic and not enforceable before mutation |
| Hardcode restrictions in installer logic | Not inspectable or versionable as enterprise policy |
| Enforce only after files are written | Violates fail-closed execution governance |
