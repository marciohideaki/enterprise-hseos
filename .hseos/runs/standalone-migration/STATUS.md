# STATUS — `standalone-migration`

**Last updated:** 2026-05-07 (W0 in-flight)

| Wave | Title | Branch | Status | Tag | PR | Notes |
|---|---|---|---|---|---|---|
| W0 | Foundation | `feature/standalone-w0-foundation` | in-progress | `pre-w0` cut | — | ADRs 0006-0009 + config v2 + run state landed |
| W1 | Decoupling crítico | `feature/standalone-w1-decoupling` | pending | — | — | Removes SWARM external ref, second-brain optional gating, lessons migrate |
| W2 | Compiler v2 | `feature/standalone-w2-compiler-v2` | pending | — | — | Modular compiler, AdapterContract, 6 adapters |
| W3 | MCP Bundle | `feature/standalone-w3-mcp-bundle` | pending | — | — | hseos-governance/swarm/state-tracking + axon-bridge |
| W4 | Hooks v2 | `feature/standalone-w4-hooks-v2` | pending | — | — | Internalize 8 globally-sourced hooks |
| W5 | Plugins | `feature/standalone-w5-plugins` | pending | — | — | Dual-format marketplace, 4 initial plugins |
| W6 | Self-Verification | `feature/standalone-w6-self-verify` | pending | — | — | hseos doctor / verify / audit |
| W7 | Adapter SDK (BYOA) | `feature/standalone-w7-adapter-sdk` | pending | — | — | @hseos/adapter-sdk + Goose reference impl |
| W8 | Docs + Tests | `feature/standalone-w8-docs-tests` | pending | — | — | Bilingual README, MIGRATION-GUIDE, CI matrix |
| W9 | Release v2.0 | `feature/standalone-w9-release` | pending | — | — | Version bump, changelog, npm publish, Smithery/agentskills.io submit |

---

## Wave 0 — Tasks

| Task | Subject | Commit | Status |
|---|---|---|---|
| W0-T0 | Stabilize uncommitted agent-core baseline | `d4f7fe7` | done |
| W0-T1 | Tag `pre-w0` + create `feature/standalone-w0-foundation` | (implicit) | done |
| W0-T2 | Draft ADR-0006 standalone architecture | `efeb513` | done |
| W0-T3 | Draft ADR-0007 compiler v2 multi-adapter contract | `1cc971e` | done |
| W0-T4 | Draft ADR-0008 MCP project-local + bundle policy | `f1e7696` | done |
| W0-T5 | Draft ADR-0009 plugin marketplace | `fee398a` | done |
| W0-T6 | Add hseos.config.yaml v2 schema fields | `b806af1` | done |
| W0-T7 | Bootstrap run directory + STATUS.md | (this commit) | in-progress |
| W0-T8 | Update _INDEX.md + open PR | — | pending |

---

## Acceptance gate (W0 → W1)

- [ ] All 4 ADRs (0006-0009) reviewed and accepted by Engineering Leadership
- [ ] PR `feature/standalone-w0-foundation` merged to `master`
- [ ] Tag `v2.0.0-w0` created from merge commit
- [ ] Tag `pre-w1` created before Wave 1 begins
