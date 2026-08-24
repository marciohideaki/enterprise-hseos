# HSEOS Runtime Providers

`@hseos/runtime-providers` contains model-neutral implementations of the
`RuntimeProvider` port. The first bridge targets stable ACP v1 through either
an injected peer or the bounded `ProcessAcpPeer` JSON-RPC/stdio transport.
Executable selection, arguments and the replacement environment are explicit;
credential resolution and network access remain deployment responsibilities.

The reference bridge is deliberately L0 (`instructions`) only. It advertises no
filesystem, terminal or MCP client capability and requires the peer to
acknowledge the HSEOS `instructions_only` effect boundary during ACP
initialization. Any permission request or tool-call update is rejected and the
session is cancelled. A vendor adapter must not claim L1+ until a conformance
suite proves that every classified effect crosses the governed `ToolRuntime`.

ACP v2 is intentionally excluded because it remains a draft. Unknown or
malformed ACP v1 messages fail closed instead of being coerced into normalized
runtime events.

## Hosted runtime adapters

Codex, Claude Code and DeepSeek Harness expose different native integration
surfaces. HSEOS preserves that distinction while normalizing all three through
the `RuntimeProvider` port:

| Adapter | Native boundary | Declared level |
| --- | --- | --- |
| Codex | official app-server over bounded JSONL/stdio | L0 |
| Claude Code | official Agent SDK `query()` process boundary | L0 |
| DeepSeek Harness | stable ACP v1 peer | L0 |

The hosted provider classes still accept injected drivers for conformance
tests. Their production candidates now have direct drivers. Codex binds the
app-server executable; Claude binds both the Agent SDK module and the Claude
Code executable. Both bindings use canonical paths and SHA-256 evidence in the
public delegated CLI manifests.

The Claude driver assigns an explicit SDK session UUID before the first turn,
uses `resume` only after a transcript exists, replaces the child environment
with the selected names, disables built-in tools and filesystem settings, and
requires plan mode. The driver must attest `instructions_only` on create and
resume and may emit only text deltas. Any tool/content capability outside the
small non-effect allowlist terminates the session with `policy_denied`. The
DeepSeek class uses the ACP bridge directly; Cordis, MCP servers and DeepSeek
packages are not vendored or imported. Its process transport enforces absolute
executable/cwd paths, `shell: false`, a selected replacement environment, 1 MiB
line bounds, 64 pending requests and strict JSON-RPC response correlation.

The stock DeepSeek Harness ACP server intentionally advertises fresh sessions
only and does not attest HSEOS's `instructions_only` boundary. Consequently,
stock process initialization fails closed and cross-process resume remains
`capability_unavailable`. A public DeepSeek candidate profile must wait for a
tool-free, sandbox-attested composition; HSEOS does not simulate resume,
cancellation or effect confinement that the external runtime cannot prove.

These adapters deliberately resolve no credentials and declare no secret
references. They do not claim governed tools, lifecycle conformance or replay.
The public candidate profiles are `agent-codex-delegated-candidate` and
`agent-claude-delegated-candidate`; both expose `hseos agent run/resume/cancel`
against temporary schema-v8 ledgers. Deterministic external-process/module
fixtures cover composition without credentials. Real provider smokes belong to
a separately configured environment and cannot upgrade the manifest without
the corresponding HSEOS conformance suite.
