# `hseos-plugin-memory`

> **Status: scaffolded.** The capability is implemented in core (`packages/agent-memory`); this definition registers
> the packaged form generated from the same code.

## Purpose

Per-project memory with fixed `data` authority, mandatory TTL, a credential scan on write and an admitting policy.
Untrusted origins stay out of default retrieval; retrieval feeds `memory[]` with provenance.

## Packaging

`plugins/memory/plugin.json` lists the core files; `tools/lib/environment-plugin-pack.js` copies them at pack time
(no duplicated code, at most 40 entries and 1 MB). The plugin receives no ledger: writes are executed by the host
against its execution ledger.
