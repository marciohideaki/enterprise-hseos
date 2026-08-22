# HSEOS Runtime Providers

`@hseos/runtime-providers` contains model-neutral implementations of the
`RuntimeProvider` port. The first bridge targets stable ACP v1 through an
injected, process-neutral peer; spawning processes, resolving credentials and
network access remain adapter responsibilities.

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
| Codex | official app-server, injected behind a driver | L0 |
| Claude Code | official Agent SDK, injected behind a driver | L0 |
| DeepSeek Harness | stable ACP v1 peer | L0 |

The Codex and Claude classes accept a process-neutral driver supplied by the
host. The driver must attest `instructions_only` on create and resume and may
emit only text deltas. An effect attempt terminates the session with
`policy_denied`. The DeepSeek class uses the ACP bridge directly; Cordis, MCP
servers and DeepSeek packages are not vendored or imported.

These adapters deliberately resolve no credentials and declare no secret
references. They do not claim governed tools, lifecycle conformance or replay.
External SDK/app-server composition smokes belong to a separately configured
environment and cannot upgrade the manifest without the corresponding HSEOS
conformance suite.
