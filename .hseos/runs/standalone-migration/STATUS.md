# STATUS — `standalone-migration`

**Last updated:** 2026-05-07 (W0 in-flight)

| Wave | Title | Branch | Status | Tag | PR | Notes |
|---|---|---|---|---|---|---|
| W0 | Foundation | `feature/standalone-w0-foundation` | merged | `v2.0.0-w0` | #53 | ADRs 0006-0009 + config v2 + run state landed |
| W1 | Decoupling crítico | `feature/standalone-w1-decoupling` | merged | `v2.0.0-w1` | #56 (replaces #54) | SWARM external ref removed; dev-squad sync; second-brain optional; vault hard paths gone; lessons promoted to .agents/instructions/lessons/ |
| W2 | Compiler v2 (foundation) | `feature/standalone-w2-compiler-v2` | merged | `v2.0.0-w2-foundation` | #55 | Manifest schema v2; AdapterContract base; adapter specs (claude-code, codex); CLI verify/audit/doctor stubs. Adapter implementations land in W2-followups. |
| W3 | MCP Bundle (foundation) | `feature/standalone-w3-mcp-bundle` | merged | `v2.0.0-w3-foundation` | #57 | Registry + 3 bundles (core/extended/enterprise); 3 MCP server directories scaffolded. Server implementations land in W3-followups. |
| W4 | Hooks v2 (foundation) | `feature/standalone-w4-hooks-v2` | in-progress | `pre-w4` cut | — | handlers/ scaffolded; 8 pending entries declared in registry for migration from upstream user-level hooks. |
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

- [ ] All 6 adapter implementations extending AdapterBase (W2 implementation slice — separate PRs)
- [ ] Round-trip idempotency tests green (`compile → diff → re-compile == 0 diff`)
- [x] PR `feature/standalone-w2-compiler-v2` (foundation) merged to `master` (PR #55)
- [x] Tag `v2.0.0-w2-foundation` created from merge commit
- [x] Tag `pre-w3` created before Wave 3 begins

## Wave 3 — Tasks (foundation slice)

| Task | Subject | Commit | Status |
|---|---|---|---|
| W3-T1 | .agents/mcp/registry.yaml + three bundle declarations | `f58cdb0` | done |
| W3-T2 | Scaffold 3 MCP server directories (governance, swarm, axon-bridge) with READMEs | `15ef8ca` | done |
| W3-T3 | STATUS update + PR | (this commit) | in-progress |
| W3-T4..T8 | MCP server implementations + compile-time .mcp.json emit + tests | — | follow-up PRs |

Wave 3 is delivered in two slices to bound blast radius (same pattern as W2):
**Foundation slice (this PR)** — registry, bundles, server scaffolding READMEs; no MCP protocol code yet.
**Implementation slice (follow-up PRs)** — three MCP server implementations (one PR each), compiler integration to emit `.mcp.json` from registry, MCP protocol round-trip tests, npm + Smithery publication.

## Acceptance gate (W3 → W4)

- [ ] Three HSEOS-native MCP servers implemented (governance, swarm, axon-bridge)
- [ ] `hseos mcp install --bundle core` produces a valid `.mcp.json` consumable by the original platform adapter
- [ ] PR `feature/standalone-w3-mcp-bundle` (foundation) merged to `master`
- [ ] Tag `v2.0.0-w3-foundation` created from merge commit
- [ ] Tag `pre-w4` created before Wave 4 begins

## Wave 4 — Tasks (foundation slice)

| Task | Subject | Commit | Status |
|---|---|---|---|
| W4-T1 | handlers/ directory scaffold + 8 pending registry slots | `5b785e4` | done |
| W4-T2..T9 | One handler implementation per follow-up PR (plan-lint, pre-compact, on-prompt-submit, session-end, suggest-skill, code-index-{guard,post-edit}, on-notification) | — | follow-up PRs |

## Acceptance gate (W4 → W5)

- [ ] All 8 handler scripts implemented in .agents/hooks/handlers/
- [ ] PR `feature/standalone-w4-hooks-v2` (foundation) merged to `master`
- [ ] Tag `v2.0.0-w4-foundation` created from merge commit
- [ ] Tag `pre-w5` created before Wave 5 begins
