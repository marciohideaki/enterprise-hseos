# Adapter SDK — Compiler v2

> Status: Foundation (Wave 2 partial). The full compiler refactor (sources, lib, verify, manifest builder) lands in subsequent W2 commits. This directory holds the BYOA contract that the refactor will consume.

This directory will house adapter implementations after the compiler v2 refactor. Each adapter:

- Extends `AdapterBase` (`_base.js`)
- Carries a static `id` matching its declarative spec at `.agents/adapters/<id>.yaml`
- Implements `async emit(sources, outputDir)` to produce platform-specific files

See ADR-0007 (Compiler v2 multi-adapter contract) for the full design.

## Authoring a new adapter

1. Add `.agents/adapters/<id>.yaml` declaring capabilities and output paths (validated against `_schema.yaml`).
2. Create `<id>.js` here that extends `AdapterBase` and overrides `emit`, plus optional `validate`, `verify`, `clean`.
3. Register the adapter id in the manifest (manifest.schema.json `adapters[].id` enum).
4. Implement round-trip idempotency tests: `compile → diff → re-compile produces zero diff`.

## BYOA via npm

The compiler discovers adapters via `node_modules/@hseos/adapter-*` after Wave 7 ships `@hseos/adapter-sdk`. Until then, adapter implementations live in-tree.
