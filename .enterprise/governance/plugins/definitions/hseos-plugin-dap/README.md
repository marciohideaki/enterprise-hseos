# `hseos-plugin-dap`

> **Status: scaffolded.** The capability is implemented in core (`packages/agent-environment`); this definition registers
> the packaged form generated from the same code.

## Purpose

Scripted, bounded debug sessions for Node (`js-debug`) and Python (`debugpy`), restricted to the workspace root:
breakpoints, stack, variables and stepping, then the debuggee is terminated. There is no persistent session.
`evaluate`, `setVariable`, `setExpression`, `restartFrame` and conditional breakpoints are out of contract.
Results are `data` with `trust: untrusted` and carry a SHA-256 digest.

## Packaging

`plugins/dap/plugin.json` lists the core files; `tools/lib/environment-plugin-pack.js` copies them at pack time
(no duplicated code, at most 40 entries and 1 MB). The adapters are toolchain pins installed offline by the
operator and never enter a tarball.
