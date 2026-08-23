# ADR-0009 — HSEOS Plugin Marketplace (Dual-Format)

**Status:** Accepted (ratified 2026-07-08)
**Date:** 2026-05-07
**Authors:** Platform Architecture
**Affects Standards:** Compiler module; SKILLS-REGISTRY; install/uninstall lifecycle; documentation policy
**Supersedes:** N/A
**Superseded By:** N/A
**Depends on:** ADR-0006 (Standalone Architecture), ADR-0007 (Compiler v2)

---

## Context

The Anthropic plugin marketplace (`.claude-plugin/marketplace.json` consumed by their CLI) and the OpenAI Codex plugin format (`.codex-plugin/plugin.json` with `skills/`, `.app.json`, `agents/`, `commands/`, `hooks.json` surfaces) have stabilized in 2026. There is no neutral marketplace standard yet; community projects publish to one, the other, or both.

HSEOS today does not ship plugins. Its value as a portable framework is limited if a user adopting HSEOS in a fresh project cannot install pre-built capabilities (skill creators, hookify CLIs, PR review toolkits) along with the agent core. Conversely, if HSEOS adopts the Anthropic marketplace exclusively, it forfeits OpenAI Codex distribution; if it adopts only Codex, it forfeits the larger Anthropic ecosystem.

A neutral plugin marketplace internal to HSEOS — emitting both formats from a single source — is the analogue of ADR-0007's adapter contract for plugins.

---

## Decision

We will create the **HSEOS Plugin Marketplace** as a dual-format publication channel.

**Source of truth** (vendor-neutral, amended by harness normalization):

```
.enterprise/governance/plugins/
├── registry.yaml              # marketplace catalog
└── definitions/<plugin-id>/
    ├── plugin.yaml            # neutral manifest
    ├── README.md
    ├── skills/                # optional — SKILL.md files
    ├── hooks/                 # optional — handlers + registry fragment
    ├── commands/              # optional — slash command definitions
    ├── agents/                # optional — agent YAML extending base
    └── mcp/                   # optional — extra MCP servers
```

The compiler materializes an exact neutral view under `.agents/plugins/` and
then emits vendor views under `.claude-plugin/` and `.codex-plugin/`. Direct
authoring under either generated tree is unsupported and is overwritten by the
next compile. Pre-normalization projects may temporarily use `.agents/plugins/`
as a bounded compatibility source; G9 owns removal of that fallback.

**Plugin manifest** (`.agents/plugins/definitions/<id>/plugin.yaml`):

```yaml
id: hseos-skill-creator
version: "1.0.0"
description: "Interactive skill scaffolding compliant with HSEOS Tier 1/2 frontmatter"
extends: official:skill-creator@1.2.0   # optional provenance reference; not resolved by G8
license: MIT
authors: ["Hideaki Solutions"]
requires_bundles: [core]
surfaces:
  skills: [skills/SKILL.md]
  hooks: [hooks/registry.yaml]
  commands: [commands/skill-new.md]
verification:
  conformance_tests: tests/
```

**Compiler emits both vendor formats** during Wave 5:
- `.claude-plugin/marketplace.json` plus per-plugin directories under `.claude-plugin/plugins/`
- `.codex-plugin/plugin.json` plus per-plugin directories under `.codex-plugin/plugins/`

**Initial four plugins** (Wave 5):

| Plugin | Purpose |
|---|---|
| `hseos-skill-creator` | Generates SKILL.md+QUICK.md pairs with HSEOS-compliant frontmatter (tier, load_strategy, triggers, adapter_overrides) |
| `hseos-hookify` | Authors hooks in `.enterprise/governance/hooks/registry.yaml` with adapter dispatch |
| `hseos-pr-review` | Wraps `pr-review-toolkit` upstream with HSEOS commit-hygiene + commit-msg validation |
| `hseos-security-guidance` | Bundles secure-coding, threat-modeling, and dependency-audit skill activations as one plugin |

**Discovery and install:**
- `hseos plugin list` shows the marketplace catalog
- `hseos plugin install <id>` validates conformance and writes complete trees to `.claude-plugin/` and `.codex-plugin/`
- `hseos plugin remove <id>` performs reverse cleanup
- `hseos plugin doctor` runs each plugin's conformance tests

**Versioning and `extends`:** plugins MAY declare `extends: official:<id>@<version>` as syntax-validated provenance metadata. G8 does not resolve networks, fetch upstream plugins, or claim behavior layering. A future resolver requires its own capability, tests, cache/integrity policy, and ADR amendment before activation.

---

## Consequences

### Positive
- HSEOS-aware plugins (skill-creator emits HSEOS Tier-policy frontmatter; hookify uses the neutral registry format).
- One source of truth, two distribution channels — community installs HSEOS plugins regardless of vendor preference.
- `extends` preserves an explicit upstream provenance relationship without implicit network behavior.
- Conformance tests prevent malformed plugins from polluting the marketplace.

### Negative / Trade-offs
- Plugin metadata maintained in `plugin.yaml` plus emitted in two vendor formats — small drift surface, mitigated by compiler ownership.
- Plugin authoring requires familiarity with the `.enterprise → .agents → vendor` compilation model.
- Upstream behavior is not inherited automatically; a plugin must bundle and test every behavior it publishes.

### Risks
- Marketplace fragmentation if either vendor adds proprietary surfaces — mitigated by capability declaration in `plugin.yaml` and adapter capability matrix from ADR-0007.
- Conformance tests may lag plugin features — mitigated by gating publication on `hseos plugin doctor` exit 0.
- Plugins ship as part of `v2.0.0` but remain a small surface (4 initial plugins) — community contributions ramp post-launch.

---

## Affected Standards

| Standard | Section | Change |
|---|---|---|
| `.enterprise/governance/plugins/` | Directory | Holds the canonical registry, definitions, and manifest schema |
| `.agents/plugins/` | Generated directory | Exact neutral compiler output; legacy authoring fallback is temporary |
| Compiler (`agent-core-compiler/`) | New target | Emits `.claude-plugin/marketplace.json` and `.codex-plugin/` |
| `tools/cli/commands/plugin.js` (NEW) | Module | Implements `list`, `install`, `remove`, `doctor` |
| Documentation policy | New artifact | `PLUGIN-AUTHORING.md` lifecycle guide |

---

## Compliance

- [ ] Approved by Engineering Leadership (Marcio Hideaki)
- [ ] Wave 5 PR (`feature/standalone-w5-plugins`) merged with the four initial plugins + dual-format publication
- [ ] `hseos plugin install hseos-skill-creator` succeeds on a fresh clone
- [ ] `.claude-plugin/marketplace.json` validates against vendor schema
- [ ] `.codex-plugin/plugin.json` validates against vendor schema
- [ ] Activation date: upon merge of Wave 5

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Adopt the Anthropic marketplace exclusively | Forfeits OpenAI Codex distribution channel and any future vendor with an alternate plugin format. |
| Adopt the Codex marketplace exclusively | Forfeits the larger and earlier-established Anthropic plugin ecosystem. |
| Defer plugins to v2.1 | Plugins are a primary distribution lever; deferring delays HSEOS appearing in the marketplace surface where adoption decisions happen. |
| Ship plugins as raw npm packages with no marketplace metadata | Loses discoverability via vendor marketplaces; loses the `extends` relationship to upstream plugins; loses conformance contract. |
