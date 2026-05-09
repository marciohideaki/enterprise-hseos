# Adapter Authoring Guide — Bring Your Own Adapter (BYOA)

> **Status: complete (v2.0.0 / Wave 7).** The `@hseos/adapter-sdk` is shipped in-tree at `packages/adapter-sdk/`. The reference BYOA adapter (Goose) lives at `tools/cli/installers/lib/core/agent-core-compiler/adapters/goose.js`.

<p align="center">
  <img src="../assets/adapter-sdk-flow.png" alt="Adapter compile pipeline — neutral sources → AdapterBase.emit → vendor output" width="90%" />
</p>

The HSEOS Standalone Gold Premium architecture (ADR-0007) is multi-vendor by design. Anyone can ship a vendor adapter as an independent npm package that the HSEOS compiler discovers and consumes — without changing the core.

## The contract

Every adapter satisfies two artifacts:

1. **Declarative spec** at `.agents/adapters/<id>.yaml` — validated against `_schema.yaml`. Declares capabilities, output paths, and fallback prose.
2. **Implementation class** extending `AdapterBase` from `@hseos/adapter-sdk` (or, until W7 implementation, from the in-tree `tools/cli/installers/lib/core/agent-core-compiler/adapters/_base.js`). Overrides `emit(sources, outputDir)` at minimum.

## Authoring steps

### 1. Pick an id

The id MUST match an entry in `.agents/manifest.schema.json adapters[].id` enum. Six are reserved for the initial v2.0 set (`claude-code`, `codex`, `cursor`, `continue`, `aider`, `cline`); a seventh slot is held for the BYOA reference (`goose`). Adding a new id requires a manifest schema bump.

### 2. Write the declarative spec

```yaml
# .agents/adapters/myvendor.yaml
version: "1.0"
id: myvendor
implementation: packages/adapter-myvendor/index.js   # or @hseos/adapter-myvendor
capabilities:
  hooks:
    events: [PreToolUse, PostToolUse]
    matchers: [tool_name]
  subagents:
    native: true
    format: my_format
  mcp:
    transport: stdio
    config: .myvendor/mcp.json
output:
  entrypoint: .myvendor/AGENTS.md
  files:
    - { type: settings, path: .myvendor/config.yaml, generated: true, mergeable: true }
    - { type: mcp, path: .myvendor/mcp.json, generated: true, mergeable: true }
fallbacks:
  unsupported_capability: "MyVendor has no slash-command equivalent; surface as agent extensions instead."
```

### 3. Implement the class

```javascript
// packages/adapter-myvendor/index.js
const { AdapterBase } = require('@hseos/adapter-sdk');

class MyVendorAdapter extends AdapterBase {
  static get id() { return 'myvendor'; }
  static get version() { return '1.0'; }

  async emit(sources, outputDir) {
    // sources = { skills, hooks, mcp, agents, commands, plugins, ui }
    // outputDir = absolute path to where this adapter writes its files
    //
    // Read the neutral sources, transform to your vendor format, write
    // the files declared in your spec's `output.files[]`.
  }
}

module.exports = MyVendorAdapter;
```

### 4. Round-trip idempotency tests

Every adapter MUST satisfy: `compile → diff → re-compile produces zero diff`. The `@hseos/adapter-sdk` ships a `runRoundTripTest(adapter)` helper.

### 5. Publish

```bash
npm publish --access public  # under @hseos/ scope or your own
```

The HSEOS compiler discovers any package matching the prefix `@hseos/adapter-` (configurable via `hseos.config.yaml → adapters.discovery_prefixes[]`). Once installed in a project's `node_modules/`, the compiler picks it up automatically on the next `hseos agent-core compile`.

## Capability matrix

The compiler emits `.agents/instructions/CAPABILITY-MATRIX.md` (lands in W4 implementation) summarizing which capability is supported by each registered adapter, with the documented fallback prose for missing capabilities. Authors should keep their `fallbacks.unsupported_capability` field accurate.

## Validation contract

Before emit, the compiler runs:

1. JSON Schema validation against `.agents/adapters/_schema.yaml`
2. `adapter.validate(sources, manifest)` — returns `{ ok, warnings[], errors[] }`
3. Capability declaration sanity check (declared capabilities must match what `emit` produces)

Failed validation logs a warning and skips the adapter; it never blocks the rest of the build.

## See also

- ADR-0007 — Compiler v2 multi-adapter contract
- ADR-0006 — Standalone architecture (P4 vendor parity, P5 zero global path)
- `packages/adapter-sdk/` — SDK source (in-tree)
- `.agents/adapters/_schema.yaml` — full spec schema
- `tools/cli/installers/lib/core/agent-core-compiler/adapters/_base.js` — `AdapterBase` canonical source
- `tools/cli/installers/lib/core/agent-core-compiler/adapters/goose.js` — reference BYOA adapter

---

## Quick Reference — `AdapterBase` API

| Method | Required | Description |
|--------|----------|-------------|
| `static get id()` | ✅ | Unique adapter identifier (e.g., `'my-tool'`) |
| `static get version()` | ✅ | Semver string (`'1.0'`) |
| `async emit(sources, outputDir)` | ✅ | Main transform: reads neutral sources, writes vendor files |
| `async validate(sources, manifest)` | optional | Pre-emit validation; return `{ ok, warnings[], errors[] }` |
| `async clean(outputDir)` | optional | Remove generated files on uninstall |

### `sources` object shape

```javascript
{
  skills:   [...],   // normalized skill definitions
  hooks:    [...],   // neutral hook registry entries
  mcp:      [...],   // MCP server definitions
  agents:   [...],   // agent YAML definitions
  commands: [...],   // slash command definitions
  plugins:  [...],   // installed plugin manifests
  ui:       { ... }  // UI surface metadata
}
```

---

## Testing Your Adapter

```bash
# Run the adapter round-trip test
node -e "
const { runRoundTripTest } = require('./packages/adapter-sdk');
const MyAdapter = require('./packages/adapter-myadapter');
runRoundTripTest(MyAdapter).then(r => {
  if (!r.ok) { console.error(r.errors); process.exit(1); }
  console.log('Round-trip OK');
});
"

# Full adapter SDK test suite
npm run test:adapter-sdk
```

---

## Registered Adapters (v2.0.0)

| ID | Bundled | Discovery |
|----|---------|-----------|
| `claude-code` | ✅ | Built-in |
| `codex` | ✅ | Built-in |
| `cursor` | ✅ | Built-in |
| `continue` | ✅ | Built-in |
| `aider` | ✅ | Built-in |
| `cline` | ✅ | Built-in |
| `goose` | ✅ | Built-in (BYOA reference) |
| `@hseos/adapter-*` | — | Auto-discovered via `node_modules/@hseos/adapter-` prefix |
