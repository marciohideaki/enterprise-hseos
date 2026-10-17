# `hseos-plugin-lsp`

> **Status: scaffolded.** The capability is implemented in core (`packages/agent-environment`); this definition registers
> the packaged form generated from the same code.

## Purpose

Read-only code intelligence for TypeScript (`typescript-language-server` on `typescript`) and Python (`pyright`),
restricted to the workspace root. Results are `data` with `trust: untrusted` and carry a SHA-256 digest.

## Packaging

`plugins/lsp/plugin.json` lists the core files; `tools/lib/environment-plugin-pack.js` copies them at pack time
(no duplicated code, at most 40 entries and 1 MB). Language servers are toolchain pins installed offline by the
operator and never enter a tarball.
