# ADR-0007 — Agent-Core Compiler v2 (Multi-Adapter Contract)

**Status:** Accepted (ratified 2026-07-08)
**Date:** 2026-05-07
**Authors:** Platform Architecture
**Affects Standards:** Compiler module (`tools/cli/installers/lib/core/agent-core-compiler.js`); manifest schema (`.agents/manifest.yaml`); installation/uninstall lifecycle
**Supersedes:** N/A
**Superseded By:** N/A
**Depends on:** ADR-0006 (Standalone Architecture)

---

## Context

The current `agent-core-compiler.js` (382 lines, single file) emits two adapter targets and treats vendor-specific output paths as inline branches. The standalone v2.0 plan requires emitting at least six adapter targets (Anthropic platform, OpenAI CLI, Cursor, Continue, Aider, Cline) and a follow-up Goose adapter as proof of the BYOA pattern. Adding adapters by branch growth would explode complexity and make community contributions impractical.

The compiler also currently lacks: (a) hash-pinned integrity per asset; (b) drift detection between source and compiled adapter; (c) a declarative spec describing each adapter's capabilities and output paths; (d) a stable contract for third-party adapter authors.

---

## Decision

We will refactor the compiler into a modular pipeline with a declarative `AdapterContract` and ship an Adapter SDK enabling Bring-Your-Own-Adapter (BYOA).

**Module layout** (replacing the single `agent-core-compiler.js`):

```
tools/cli/installers/lib/core/agent-core-compiler/
├── index.js                          # pipeline orchestrator
├── sources/{skills,hooks,mcp,agents,commands,plugins,ui}-source.js
├── adapters/{<vendor>,_base,_schema}.js
├── lib/{frontmatter,slug,hash,merge,path-resolver}.js
├── verify/{integrity,drift,doctor}.js
└── manifest/{builder,schema}.js
```

**Adapter contract** (`adapters/_base.js`):

```javascript
class AdapterBase {
  static get id() {}
  static get version() {}
  static get capabilities() {}     // declarative list
  async validate(sources, manifest) {}
  async emit(sources, outputDir) {}
  async verify(outputDir) {}
  async clean(outputDir) {}
  mapHookEvent(neutralEvent) {}
  mapToolName(neutralName) {}
  resolvePath(neutralPath, ctx) {}
}
```

**Adapter spec** (`.agents/adapters/<vendor>.yaml` — declarative):

```yaml
version: "1.0"
id: <vendor>
implementation: tools/.../adapters/<vendor>.js
capabilities:
  hooks: {events: [...], matchers: [...]}
  subagents: {native: bool, format: ...}
  slash_commands: {native: bool, location: ...}
  mcp: {transport: stdio|http, config: <path>}
  statusline: {native: bool}
  settings: {location: ..., schema: ...}
output:
  entrypoint: <file>
  files:
    - {type, path, generated, mergeable}
fallbacks:
  unsupported_capability: "<documented behaviour>"
```

**Pipeline** (`hseos agent-core compile`):
1. Load Sources (skills, hooks, mcp, agents, commands, plugins, ui)
2. Validate against JSON Schemas
3. Resolve bundles, capabilities, paths
4. Render Adapters — for each enabled adapter: `adapter.emit(sources)`
5. Hash & Sign — write `.agents/.signatures/<adapter>.sha256`
6. Manifest — write `.agents/manifest.yaml` v2
7. Verify — integrity check; drift report
8. Report — CLI summary table

**BYOA** (third-party adapter as npm package):
- Discovery: scan `node_modules/@hseos/adapter-*`
- Installation: `npm install @hseos/adapter-<X>` then `hseos agent-core compile --target <X>`
- Adapter SDK published as `@hseos/adapter-sdk`; template repo as `@hseos/adapter-template`

**Initial supported vendors** (all merged in Wave 2):
1. Anthropic platform CLI
2. OpenAI CLI
3. Cursor (3.0+)
4. Continue.dev
5. Aider
6. Cline

**Reference BYOA adapter** (Wave 7): Goose (LF AAIF reference impl).

---

## Consequences

### Positive
- New adapters add through plug-in package; the core never changes.
- Capability mismatches surface declaratively in `CAPABILITY-MATRIX.md` rather than as silent runtime failures.
- Hash-pinned signatures make drift mechanically detectable in CI and on `SessionStart`.
- The contract is simple enough for community contribution (one `_base.js` subclass + one `.yaml` spec).

### Negative / Trade-offs
- One-time refactor of the existing 382-line monolith into ~15 modules.
- JSON Schema definition + maintenance overhead for sources, manifest, and adapter spec.
- Symlink-vs-copy fallback adds Windows-specific code paths in `path-resolver.js`.

### Risks
- Adapter implementations may diverge in quality if community PRs don't follow `_base.js` validation contract — mitigated by schema validation in CI and a published `@hseos/adapter-template` with conformance tests.
- Performance regression on large skill counts (>200) — mitigated by source caching keyed by file `mtime` and hashes.

---

## Affected Standards

| Standard | Section | Change |
|---|---|---|
| `tools/cli/installers/lib/core/agent-core-compiler.js` | Entire module | Replaced by modular `agent-core-compiler/` directory |
| `.agents/manifest.yaml` | Schema | Bumped to v2.0; new fields `adapters[].sha256`, `mcp_bundles_active`, `plugins[]` |
| `.agents/adapters/` (NEW) | Directory | Holds declarative adapter specs, JSON-Schema validated |
| `tools/cli/commands/agent-core.js` | Subcommands | Adds `compile --target <X|all>`, `verify`, `audit`, `doctor` |

---

## Compliance

- [ ] Approved by Engineering Leadership (Marcio Hideaki)
- [ ] Wave 2 PR (`feature/standalone-w2-compiler-v2`) merged with 6 adapters at green
- [ ] Round-trip idempotency tests passing per adapter (`compile → diff → re-compile` produces zero diff)
- [ ] `@hseos/adapter-sdk` extracted in Wave 7 with template + tutorial
- [ ] Activation date: upon merge of Wave 2

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Continue with single-file compiler, add adapters as inline branches | Complexity grows linearly with vendor count; contributions impractical; unit tests entangled. |
| Generate adapters via JSON-only declarative DSL with no JS code | Insufficient expressivity for path resolution, hook event mapping, capability checks; would force a bespoke DSL ahead of an established one. |
| Adopt an existing framework (Mastra, AgentKit) as the compiler base | Mastra/AgentKit are runtime frameworks, not compiler/codegen targets; mismatch. Coupling HSEOS to a specific framework defeats P1. |
| Defer BYOA to v3.0 | Wave 7 requires only an SDK extraction of the already-modular adapters; no incremental cost beyond documentation. Deferring delays the AAIF-positioning argument. |
