# @hseos/agent-memory

Governed, per-project memory for the HSEOS Agent Kernel (contract `agent-memory.v1`, design 5.5).

- **Authority is always `data`.** Writing `directive` or `operator` fails with `AGENT_MEMORY_AUTHORITY_ESCALATION`.
- **Writes are admitted by the permission lattice** (`memory.write`) and scanned for credentials (the scanner is
  injected, this package imports nothing from `tools/`). No admitting rule means the write is denied.
- **TTL is mandatory** (`ttl_seconds`, bounded by the policy ceiling). Expiry is checked against an injectable clock and
  recorded as `memory.expired` by `sweepExpired`.
- **Untrusted origins** are stored with `trust: untrusted` and stay out of default retrieval.
- **Scope is the project.** Each project is one ledger stream (`aggregate_type = agent_memory`); there is no cross-project read.
- **Persistence is the execution ledger** (events `memory.written`, `memory.superseded`, `memory.expired`,
  `memory.deleted`). The lexical index is a disposable projection: `rebuild()` replays the events.
  The ledger is append-only, so a deletion is a logical state change recorded as an event.
- **Retrieval is deterministic** (term overlap, then newest, then id) and returns `MemorySource` v2 items for `memory[]`
  with provenance of the original write.

The host owns the ledger. `plugins/memory` only distributes this code; the plugin never receives a ledger.
