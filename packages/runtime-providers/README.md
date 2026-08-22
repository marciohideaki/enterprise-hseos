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
