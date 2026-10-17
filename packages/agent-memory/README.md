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

## Trust boundary: what the host MUST inject

The package is a library, not a gate for untrusted callers. The trusted host (the process that owns the execution
ledger) is the only party allowed to call `write`, `forget` and `sweepExpired`, and it must never forward these values
from tool arguments or model output:

| Supplied by                       | Values                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The host, in the second parameter | `rules` (policy from the permission lattice, never from the entry), `approved` (a real human approval), `actor` (the authenticated identity), `expected_version`, `execution_mode`              |
| The caller, in the entry          | `memory_id`, `scope`, `content`, `origin`, `trust`, `classification`, `source_ref`, `ttl_seconds`, `supersedes` (and optionally `authority: data`, `source_digest` equal to the content digest) |

The package enforces what it can: unknown or host-owned fields inside the entry are refused, `created_at` comes from
the injected clock, `write_policy_ref` comes from the admitting rule, `origin: operator` needs an `operator` actor, an
untrusted origin can only be stored as untrusted, `bypass` or approval without a deciding rule never admits, and
`forget` needs an `operator` actor. It cannot know whether the host authenticated that actor or obtained the approval
honestly. A host that lets a model choose `rules`, `approved` or `actor` has bypassed the governance.

Known residuals: there is no per-project quota (every read replays the project stream), deletion and expiry are logical
(the ledger keeps the content), and no PII scan exists beyond the injected credential scanner.
