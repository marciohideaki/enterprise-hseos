# CHANGELOG — HSEOS

## [3.0.3] — 2026-08-31

**Status:** Release candidate; GitHub prerelease pending

**Type:** Adapter skill ownership correction

Adapter-generated launcher cleanup now honors the portable manifest as the
compiler ownership boundary. Selected-adapter installations retain all governed
skills and pass integrity, drift, and doctor checks. See
[PR #135](https://github.com/marciohideaki/enterprise-hseos/pull/135).

## [3.0.2] — 2026-08-31

**Status:** Release candidate; GitHub prerelease pending

**Type:** CLI installation lifecycle correction

Fresh installs now bootstrap their project configuration, machine-facing plan
commands emit clean JSON, consumer builds receive the adapter catalog, and the
doctor verifies only selected adapters. Uninstall remains deliberately
non-destructive to portable project governance. See
[PR #134](https://github.com/marciohideaki/enterprise-hseos/pull/134).

## [3.0.1] — 2026-08-31

**Status:** Release candidate; GitHub prerelease pending

**Type:** Staging validation correction

The GitHub artifact now provides directly verifiable, asset-relative checksums,
selects release evidence from the exact version tag, and renders the state UI
without a favicon-related browser console error. The v3.0.0 prerelease remains
immutable staging evidence and is not eligible for stable promotion.

## [3.0.0] — 2026-08-28

**Status:** Release candidate; GitHub prerelease pending

**Type:** Project isolation and contract hardening

**Breaking change:** state and registry defaults are project-scoped, direct
non-loopback state UI access is rejected, and canonical workflow/capability
catalogs use the new explicit contracts. See
[`docs/MIGRATION-GUIDE-v2-to-v3.md`](../docs/MIGRATION-GUIDE-v2-to-v3.md).

The public distribution is a checksum-bound `npm pack` tarball attached to the
GitHub release. npm registry publication is intentionally outside this release.

Compatibility readers preserve version 1 workflow catalogs and compiled
capability catalogs without surface metadata during the v3 migration window.
The compiler upgrades those inputs to the strict current form.

## [2.0.0] — 2026-05-08

**Status:** Stable  
**Type:** Standalone Architecture — AI-Assisted Engineering Operating System  
**Breaking change:** v1.x installs are not compatible with v2.0 agent/skill layout. See [docs/MIGRATION-GUIDE-v1-to-v2.md](../docs/MIGRATION-GUIDE-v1-to-v2.md).

### O que esta release entrega

Migração completa de 10 waves para arquitetura standalone (ADR-0006):

| Wave | Escopo             | Entregável principal                                                                                                                             |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| W0   | Foundation         | Estrutura base standalone, separação enterprise/hseos                                                                                            |
| W1   | Decoupling         | Remoção de dependências externas; autocontido                                                                                                    |
| W2   | Compiler v2        | `agent-core-compiler` modular: sources/, adapters/, lib/, manifest/                                                                              |
| W3   | MCP Bundle         | 3 MCP servers: hseos-governance :3101, hseos-swarm :3102, axon-bridge :3103                                                                      |
| W4   | Hooks v2           | 8 handlers ativos: plan-lint, pre-compact, on-prompt-submit, session-end, suggest-skill, code-index-guard, code-index-post-edit, on-notification |
| W5   | Plugins            | 4 plugin defs + `plugins-source.js` + `plugins-emit.js`; CLI plugin list/install/remove/doctor; 22 testes                                        |
| W6   | Self-Verification  | `verify/integrity.js` (sha256 chain), `verify/audit.js` (drift detection), `verify/doctor.js` (8 health checks); 12 testes                       |
| W7   | Adapter SDK / BYOA | `packages/adapter-sdk/index.js` (AdapterBase + conformance checker), Goose adapter, discovery via `node_modules/@hseos/adapter-*`; 37 testes     |
| W8   | Docs + CI          | README bilíngue, MIGRATION-GUIDE completo, CI matrix (Node 20.x + 22.x), release.yaml tag-triggered, smithery.yaml                               |
| W9   | Release v2.0       | Version bump 1.1.0 → 2.0.0, esta entrada de CHANGELOG, tag `v2.0.0`, npm publish                                                                 |

### Verificação

```bash
npm test          # todos os testes devem passar
npm info hseos version   # → 2.0.0 após publish
```

---

# 🏷️ Enterprise Overlay — v1.0.0

**Status:** Stable  
**Type:** Governance & Process Framework  
**Release Date:** 2025-XX-XX

---

## 🎯 Overview

The **Enterprise Overlay v1.0.0** establishes a complete, enforceable, and auditable
governance layer for enterprise-grade software development supported by AI agents.

This release formalizes **authority boundaries, decision control, and execution discipline**,
ensuring AI agents operate as **assistants**, never as autonomous decision-makers.

---

## 🧱 What This Release Delivers

### Governance Foundations

- Enterprise Constitution defining non-negotiable principles
- Explicit separation between **specifications (external)** and **governance (internal)**
- Mandatory ADR mechanism with enforced stop conditions

### Agent Control & Safety

- Clear authority and constraint model for all agents
- Standardized mandatory governance clauses
- Conceptual Lint to validate agent semantic compliance
- Protection against agent autonomy drift

### Process & Operational Clarity

- Playbooks for onboarding, escalation, replay, and governance flows
- Explicit operational modes, including Replay Mode
- Exception handling with strict documentation and expiration rules

### Enforcement & Tooling

- CI/CD governance gates validating structure and contracts
- Bootstrap script for isolated, version-safe setup
- Assisted Replay tooling for curated repository reconstruction
- Automated patching for agent governance alignment

---

## 🔒 Key Principles Enforced

- Specifications are sovereign and external
- Governance is explicit and enforceable
- Ambiguity triggers mandatory stop and escalation
- Exceptions are documented, temporary, and auditable
- AI agents execute — they do not decide

---

## 🧩 Compatibility & Scope

- Fully compatible with existing `.specs` structures
- No changes required to legacy specifications
- No forced migration or refactoring
- Designed to evolve incrementally via ADRs

---

## 🚦 What This Release Does NOT Do

- Does not redefine architectures or stacks
- Does not modify existing specifications
- Does not automate conceptual decisions
- Does not impose unnecessary bureaucracy

---

## 🧭 Upgrade & Adoption Notes

- This release can be adopted incrementally
- Existing projects may enable governance selectively
- Future changes to governance require ADR approval

---

## 🔮 Forward Path (Non-Commitment)

- Optional automation of conceptual lint validation
- Progressive modularization of specifications
- Expanded onboarding and reporting tooling

---

## 🟢 Conclusion

**Enterprise Overlay v1.0.0** marks the transition from _implicit trust_ to
**explicit, enforceable governance** in AI-assisted engineering environments.

This version is considered **stable and production-ready**.

---

**End of Release Notes**
