# ADR-0016 - Capability Packaging and Install Planning

**Status:** Accepted (ratified 2026-07-08)
**Date:** 2026-06-04
**Authors:** Platform Architecture Owners
**Affects Standards:** Agent-Core Compiler v2, install lifecycle, skill consumption policy, execution governance
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

HSEOS already has governed agents, skills, hooks, workflows, MCP bundles, adapters, and installation tooling. The current installer exposes module and tool selection, but it does not provide a first-class way to select a coherent capability surface such as governance-only, delivery, GitOps, ADO, or full enterprise setup.

This creates three issues:

- Installation intent is harder to audit than module and tool lists.
- Skill and hook surfaces are not grouped into operator-friendly profiles.
- Adapter capability differences are documented, but not available as a planning surface before install.

## Decision

We will introduce a native HSEOS capability packaging layer.

The layer will define:

- Capability profiles under `.agents/capabilities/profiles.yaml`.
- Capability components under `.agents/capabilities/components.yaml`.
- Synthetic skill components generated from `.enterprise/governance/agent-skills/*`.
- Install-plan output that resolves profiles, components, skills, modules, tools, hook profile, and installed paths.
- Hook profile terminology with four levels: `advisory`, `standard`, `strict`, and `ci`.

The capability packaging layer is additive. It does not replace the Constitution, agent authority, skill consumption policy, quality gates, worktree lifecycle, or state management.

## Consequences

### Positive

- Install intent becomes reviewable before files are written.
- Teams can select a smaller, coherent HSEOS surface without learning internal module IDs first.
- Adapter support can be explained consistently across Claude Code, Codex, and future runtimes.
- Skill installation can be planned at individual skill granularity while preserving the governed registry as the authority.

### Negative / Trade-offs

- The installer gains another selection layer that must remain synchronized with modules, skills, hooks, and adapters.
- Profiles can become misleading if they are not validated in CI.
- A profile resolver must avoid weakening required governance assets.

### Risks

- Risk: teams may assume a profile disables mandatory governance.
  Mitigation: all plans always include the governance baseline and clearly mark required components.
- Risk: skill components drift from the registry.
  Mitigation: synthetic skill components are generated from the registry directory and validated by tests.
- Risk: hook profile semantics diverge between adapters.
  Mitigation: hook profile is recorded as install intent and adapters expose support/fallback metadata.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| ADR-0007 Agent-Core Compiler v2 | Multi-adapter contract | Extends install planning with capability manifests and adapter matrix output |
| Skill Consumption Policy | Adding New Skills | Clarifies that synthetic skill components are selectable wrappers, not new skill authority |
| Execution Governance | Enforcement Hooks | Adds hook profile selection as install intent while preserving mandatory gates |

---

## Compliance

- [ ] Approved by Engineering Leadership
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [ ] Activation date: 2026-06-04
- [ ] Review date: 2026-07-04

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep module-only selection | Module IDs are too implementation-oriented for operators and do not explain skill, hook, and adapter impact |
| Add more interactive prompts only | Prompts do not create a durable, reviewable planning artifact |
| Duplicate skills into profile-specific folders | Duplicates governed content and increases drift risk |
