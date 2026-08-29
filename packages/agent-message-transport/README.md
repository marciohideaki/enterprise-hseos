# Agent message transport

Provider-neutral, durable agent-to-agent text messaging for ADR-0024. The reference adapter persists append-only SQLite facts before acknowledging `delivered`, `held`, `refused`, `expired`, or `acknowledged`; operational schema activation remains separately gated by G9. Until that gate is satisfied, the SQLite store deliberately accepts only a private, dedicated database directly inside a temporary fixture directory and refuses shared application databases before creating any schema.

Messages are bounded text, never executable commands or approval/configuration carriers. Sender authority is not transferred to the recipient. The reference local relay implements monotonic time, transactional TTL/dedup/inbox/rate enforcement, inbound `accept|hold|refuse`, and authorized one-shot `notify_when_idle` without polling. Persisted identities and payloads are reconstructed fail-closed.

Every local relay or MCP, HTTP, or remote adapter is immutably bound to one principal. Claimed sender, recipient, and requester identities must match that principal before dispatch; adapter inputs and outputs are independently validated and frozen. Relay/store/database internals are private, registered ports are nominal, and duck-typed or prototype-inherited substitutes are rejected.

Presence mutation requires a separate opaque control-plane capability and is intentionally absent from the provider-facing relay port. One-shot subscription identifiers are recorded in an immutable SQLite tombstone table, so a restart cannot replay an already consumed or expired identifier.
