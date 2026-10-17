# `hseos-plugin-browser`

> **Status: scaffolded.** The capability is implemented in core (`packages/agent-environment`); this definition registers
> the packaged form generated from the same code.

## Purpose

A bounded, stateless batch of browser steps (`goto`, `click`, `type`, `press`, `wait_for`, `screenshot`, `dom_snapshot`)
against the project's own dev server. Every call opens a fresh context and discards it: no cookie or storage survives.
Screenshots and page text are returned as `data` parts with `trust: untrusted`, the final URL, a UTC time, a SHA-256
digest and the transform that produced them.

## Isolation and egress

The browser (`chrome-headless-shell`, pinned by revision) runs in the P2 sandbox, where `--no-sandbox` is granted only
inside the supervisor's bwrap launch. Its only way out is a proxy that relays to a Unix-socket egress broker running
outside the sandbox. The broker forwards only to an explicit `host:port` allowlist (default: the project's `localhost`
dev server); anything else is blocked and recorded as `ENV_BROWSER_EGRESS_DENIED`. DNS is never resolved in the sandbox.

## Packaging

`plugins/browser/plugin.json` lists the core files; `tools/lib/environment-plugin-pack.js` copies them at pack time
(no duplicated code, at most 40 entries and 1 MB). `playwright-core` and the browser are toolchain pins provisioned
offline and never enter a tarball; nothing is downloaded at run time.

## Host requirements

The pack is not self-contained by design: the egress broker (`tools/cli/lib/environment-egress-broker.js`), the isolation
package and the context media store belong to the HSEOS core host, which supplies them to
`createDefaultBrowserService`. The pack carries the browser contract, controller and sandbox host plus the pin installer.
