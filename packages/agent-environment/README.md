# @hseos/agent-environment

Core runtime for the W5 environment capabilities. Today it holds the LSP capability (`environment.lsp.v1`).

- `framing.js` - `Content-Length` framing shared by the LSP client and, later, the DAP client.
- `lsp.js` - controller: input contract, scope validation (`ENV_LSP_OUT_OF_SCOPE`), untrusted `data` result with digest.
- `lsp-host.js` - runs inside the P1 sandbox, one language-server process per action.
- `index.js` - exports; the toolchain pin installer is loaded lazily.

Language servers (`typescript-language-server`, `typescript`, `pyright`) are offline toolchain pins, never part of the
package. The workspace is mounted read-only; a missing server or pin is reported as BLOCKED. The same files are
packaged as `plugins/lsp` by `tools/lib/environment-plugin-pack.js`.
