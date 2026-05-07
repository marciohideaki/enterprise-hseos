# STATUS — `standalone-migration`

**Last updated:** 2026-05-07 (W0 in-flight)

| Wave | Title | Branch | Status | Tag | PR | Notes |
|---|---|---|---|---|---|---|
| W0 | Foundation | `feature/standalone-w0-foundation` | merged-pending | `pre-w0` + `v2.0.0-w0` (post-merge) | #53 | ADRs 0006-0009 + config v2 + run state landed |
| W1 | Decoupling crítico | `feature/standalone-w1-decoupling` | merged-pending | `pre-w1` + `v2.0.0-w1` (post-merge) | #54 | SWARM external ref removed; dev-squad sync; second-brain optional; vault hard paths gone; lessons promoted to .agents/instructions/lessons/ |
| W2 | Compiler v2 (foundation) | `feature/standalone-w2-compiler-v2` | in-progress | `pre-w2` cut | — | Manifest schema v2; AdapterContract base; adapter specs (claude-code, codex); CLI verify/audit/doctor stubs. Adapter implementations land in W2-followups. |
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

- [x] All 4 ADRs (0006-0009) reviewed and accepted by Engineering Leadership (PR #53 in review)
- [ ] PR `feature/standalone-w0-foundation` merged to `master`
- [ ] Tag `v2.0.0-w0` created from merge commit
- [x] Tag `pre-w1` created before Wave 1 begins

## Wave 1 — Tasks

| Task | Subject | Commit | Status |
|---|---|---|---|
| W1-T1 | Remove ~/.claude/ ref from swarm.agent.yaml line 59 | `acd7950` | done |
| W1-T2 | Sync dev-squad SKILL.md (Wave 5a state emission contract) | `2a02540` | done |
| W1-T3 | Mark second-brain skill explicitly optional (vault_required: false) | `0520d6e` | done |
| W1-T4 | Remove vault hard paths from project entrypoint | `a7f4c68` | done |
| W1-T5 | Promote .agents/instructions/lessons/ to canonical | `1389572` | done |
| W1-T6 | Document standalone smoke test procedure | (this commit) | in-progress |
| W1-T7 | Update run STATUS.md and open Wave 1 PR | — | pending |

## Acceptance gate (W1 → W2)

- [ ] Standalone smoke test (docs/STANDALONE-VERIFICATION.md) passes in clean `node:20` Docker container
- [ ] PR `feature/standalone-w1-decoupling` merged to `master`
- [ ] Tag `v2.0.0-w1` created from merge commit
- [x] Tag `pre-w2` created before Wave 2 begins

## Wave 2 — Tasks (foundation slice)

| Task | Subject | Commit | Status |
|---|---|---|---|
| W2-T1 | manifest.schema.json (v2 JSON Schema, additive) | `4a2afbe` | done |
| W2-T2 | AdapterContract base + adapter specs (claude-code, codex) | `d6bc1e8` | done |
| W2-T3 | CLI subcommand stubs (verify/audit/doctor) + --target flag | `c3e7b36` | done |
| W2-T4..T9 | Per-adapter implementations (4 new adapters), drift detection, round-trip tests | — | follow-up PRs |

Wave 2 is delivered in two slices to bound blast radius:
**Foundation slice (this PR)** — schema, contract, CLI surface; existing compiler unchanged.
**Implementation slice (follow-up PRs)** — refactor of the monolithic compiler into modular `agent-core-compiler/` directory with per-adapter implementations; round-trip idempotency tests; `--target <id>` actual wiring.

## Acceptance gate (W2 → W3)

- [ ] All 6 adapter implementations extending AdapterBase
- [ ] Round-trip idempotency tests green (`compile → diff → re-compile == 0 diff`)
- [ ] PR `feature/standalone-w2-compiler-v2` merged to `master`
- [ ] Tag `v2.0.0-w2` created from merge commit
- [ ] Tag `pre-w3` created before Wave 3 begins
