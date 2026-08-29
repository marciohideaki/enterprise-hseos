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

## Delegated runtime adapters

Hosted coding agents and external ACP processes expose different native
integration surfaces. HSEOS preserves those distinctions while normalizing
them through the `RuntimeProvider` port:

| Adapter class        | Native boundary                               | Declared level |
| -------------------- | --------------------------------------------- | -------------- |
| Hosted app server    | bounded JSONL/stdio                            | L0             |
| Hosted agent SDK     | SDK-owned process boundary                     | L0             |
| External ACP process | stable ACP v1 peer                             | L0             |

The hosted provider classes accept injected drivers for conformance tests and
bind their production candidates through canonical paths with SHA-256 evidence
in public delegated CLI manifests.

The SDK driver assigns an explicit session UUID before the first turn, uses
`resume` only after a transcript exists, replaces the child environment with
selected names, disables built-in tools and filesystem settings, and requires
plan mode. The driver must attest `instructions_only` on create and resume and
may emit only text deltas. Any tool or content capability outside the small
non-effect allowlist terminates the session with `policy_denied`.

The external ACP adapter uses the protocol bridge directly and vendors no
external runtime or MCP server. Its transport enforces absolute executable and
working-directory paths, `shell: false`, a selected replacement environment,
1 MiB line bounds, 64 pending requests and strict JSON-RPC response
correlation.

An ACP process that advertises only fresh sessions or omits the HSEOS
`instructions_only` attestation fails closed. Cross-process resume remains
`capability_unavailable` unless the peer proves `loadSession`. A public
one-shot candidate additionally requires a tool-free, sandbox-attested
composition; HSEOS does not simulate resume, cancellation or effect confinement
that an external runtime cannot prove.

The composition validator accepts only the declared model adapter and ACP
process plugin, requires one model route, and requires workspace context,
skills, Bash, job tools and goals to be disabled. It rejects links and every
additional plugin, then returns an immutable SHA-256-bound `one_shot` effect
attestation. That attestation permits only same-process host reattachment
before the single turn; a fresh provider still rejects resume when the external
ACP server has no `loadSession`.

These adapters deliberately resolve no credentials and declare no secret
references. They do not claim governed tools, lifecycle conformance or replay.
The public candidate profiles are `agent-codex-delegated-candidate` and
`agent-claude-delegated-candidate`. Claude exposes `hseos agent
run/resume/cancel` against temporary schema-v9 ledgers. The direct Codex
app-server profile is explicitly run-only because the real raw server does not
persist an empty pre-turn thread for later process reattachment; its completed
one-turn record remains durable. Deterministic external-process/module fixtures
cover composition without credentials, but cannot upgrade that public
lifecycle claim. Real provider smokes belong to a separately configured
environment and cannot upgrade the manifest without the corresponding HSEOS
conformance suite.

## Hosted worker lifecycle

Worker ownership is an additive responsibility of `DelegatedRuntimeHost`, not a second provider state machine. A live delegated session may be claimed with a bounded lease; heartbeats extend only the current epoch, and every send or cancel after a claim must present the exact worker ID and lease epoch. Expiry or a bounded drain deadline records an immutable `orphaned` fact before a replacement receives the next epoch, fencing the old worker.

A process-level SIGTERM handler can call `drainAndParkWorker()` to record `draining` and then an exact runtime-sequence checkpoint as `parked`; the library deliberately installs no global signal handler. `retireWorker()` durably retires the binding, and only a different worker may subsequently claim it. Worker facts are registered by pending fixture migration 009, so this conformance surface does not activate the operational schema or weaken G9.
