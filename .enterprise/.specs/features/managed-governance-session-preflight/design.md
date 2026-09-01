# Managed Governance Session Preflight — Design

## Authority Boundary

The preflight is an observer. It reads local governance, queries the loopback managed control plane,
compares immutable identifiers and writes only runtime evidence. It never changes a decision or the
instruction cascade. The local Constitution remains authoritative in every outcome.

## Flow

```text
session start / CLI / MCP
  -> validate local query config + repository contract + managed binding
  -> securely read and normalize the local Constitution
  -> query the existing effective-context read port
  -> locate the exact Constitution source path in the active projection
  -> compare repository_id + sha256 digest
  -> return a typed managed-shadow result
  -> CLI/hook only: atomically persist latest evidence
```

## Contracts

The result is a strict object with these stable fields:

- `schema_version`, `mode`, `status`, `reason_code`, `blocking`;
- `authoritative_source`, `repository_id`, `checked_at`;
- `constitution.source_path`, `local_digest`, `remote_digest`, `matched`;
- `remote.status`, `source_commit`;
- `evidence_path` only when persistence succeeds.

The service rejects unknown remote context shapes and duplicate Constitution entries. Network,
protocol and remote-shape failures collapse to `remote_unavailable`; local contract and safe-read
failures collapse to `invalid_local_contract`. Error text is bounded and never includes raw content,
URLs with credentials, tokens or environment values.

## Evidence

The CLI persists only the latest result at
`.hseos/state/managed-governance/session-preflight.json`. The directory is runtime state and already
gitignored. Writes use a same-directory exclusive temporary file, `fsync`, atomic rename and mode
`0600`. MCP invocation disables persistence to preserve its stateless read-only contract.

## Adapter Integration

The canonical hook registry receives one active, non-blocking `SessionStart` entry for adapters with
native support. Its project-scoped handler checks for `.hseos/config/managed-governance.json`, finds
the local packaged CLI and executes the preflight with a bounded external timeout when available.
Missing configuration is silent; drift and unavailable states are concise advisories.

For Codex and other adapters without a native `SessionStart` event, the portable instruction
cascade documents `hseos governance session preflight --json` as the explicit fallback. This is a
capability declaration, not a claim of automatic execution.

## Security and Failure Semantics

- Only project-local regular files without symbolic or hard links are read.
- The existing query adapter continues to accept loopback HTTP only.
- Remote response size and timeout bounds remain enforced.
- No credentials are read or persisted by the preflight.
- Every result has `blocking: false`; the hook additionally guards execution with fail-open shell
  semantics.
- No `managed-enforced` branch exists in this component.

## Verification

- Unit tests cover normalization, equality, drift, identity mismatch, remote outage, unsafe files,
  duplicate/missing remote Constitution and atomic evidence.
- CLI tests cover JSON/human rendering and zero exit status for all shadow outcomes.
- MCP tests cover read-only exposure and disabled evidence persistence.
- Hook tests cover configured invocation, silent no-op and advisory failure handling.
- Compiler tests prove the canonical hook is emitted only for supported adapters with an explicit
  fallback elsewhere.
