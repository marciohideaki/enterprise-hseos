# `@hseos/adapter-sdk`

> **Status: scaffolded.** Implementation lands as a follow-up PR within Wave 7. Declared in ADR-0007 §BYOA and §Adapter SDK.

The Bring-Your-Own-Adapter (BYOA) SDK for the HSEOS standalone v2.0 architecture. Lets third-party authors ship a coding-agent vendor adapter as a published npm package that the HSEOS compiler discovers via `node_modules/@hseos/adapter-*` without any change to the core.

## Why an SDK

ADR-0007 specifies that the modular `agent-core-compiler/` directory in `tools/cli/installers/lib/core/` exposes:

- `AdapterBase` class — eight virtual lifecycle methods (`validate`, `emit`, `verify`, `clean`) plus three capability mappers
- Declarative `_schema.yaml` for adapter spec yamls (`.agents/adapters/<id>.yaml`)
- Six initial adapter implementations: claude-code, codex, cursor, continue, aider, cline

Until Wave 7, this contract lives inside the HSEOS repo. The Wave 7 implementation slice extracts:

- `AdapterBase` and capability mappers → `packages/adapter-sdk/`
- The schema → `packages/adapter-sdk/schema/adapter-spec.schema.yaml`
- A working template adapter → `packages/adapter-template/`

…and publishes the SDK as `@hseos/adapter-sdk` on npm. Third-party adapters then `npm install @hseos/adapter-sdk`, `extends AdapterBase`, and `npm publish` under `@hseos/adapter-<vendor>` (or any other namespace; the compiler discovers the prefix `@hseos/adapter-` by convention but can be overridden via `hseos.config.yaml` `adapters.discovery_prefixes[]`).

## Authoring contract (preview)

```javascript
// node_modules/@hseos/adapter-myvendor/index.js
const { AdapterBase } = require('@hseos/adapter-sdk');

class MyVendorAdapter extends AdapterBase {
  static get id() { return 'myvendor'; }
  static get capabilities() {
    return {
      hooks: { events: ['PreToolUse', 'PostToolUse'] },
      subagents: { native: true, format: 'markdown_with_frontmatter' },
      mcp: { transport: 'stdio', config: '.myvendor/mcp.json' },
    };
  }

  async emit(sources, outputDir) {
    // Read .agents/skills, .agents/hooks/registry.yaml, etc. from sources.
    // Write platform-specific files into outputDir.
  }
}

module.exports = MyVendorAdapter;
```

The companion declarative spec at `.agents/adapters/myvendor.yaml` is validated by `_schema.yaml` (`v2.0`), declaring the same capabilities matrix, output paths, and fallback prose.

## Discovery (Wave 7 implementation)

The compiler walks `node_modules/@hseos/adapter-*` (and any prefixes declared in `hseos.config.yaml`). Each candidate must:

1. Export a default class extending `AdapterBase`
2. Have a matching `.agents/adapters/<id>.yaml` spec validated against `_schema.yaml`
3. Pass round-trip idempotency tests (`compile → diff → re-compile produces zero diff`)

When a discovered adapter fails validation, the compiler logs a warning and skips it (`status: pending` in the manifest); it never blocks the rest of the build.

## Reference adapter — Goose

Wave 7 will additionally ship a `goose` adapter as a working BYOA reference impl. Goose is an LF AAIF member project (Block/Square heritage, MCP-native, multi-provider). The adapter spec is already declared at `.agents/adapters/goose.yaml`; the implementation lands when this SDK extracts.

## Acceptance

- [ ] `@hseos/adapter-sdk` published on npm with semver discipline
- [ ] `@hseos/adapter-template` published as a working scaffold
- [ ] Compiler discovers third-party adapters via `node_modules/@hseos/adapter-*`
- [ ] Goose reference adapter compiles HSEOS-emitted artifacts that Goose itself can consume
