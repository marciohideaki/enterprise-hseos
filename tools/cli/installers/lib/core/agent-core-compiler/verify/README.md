# Self-Verification — Compiler v2

> Status: Foundation (Wave 6 partial). The full `hseos doctor / verify / audit` implementation lands in subsequent W6 commits. This directory holds the module skeletons that the CLI subcommand stubs (added in W2-T3) will eventually call.

This directory will house three first-class self-verification modules per ADR-0006 §Self-Verification System and ADR-0007 §Pipeline:

| Module | Purpose | CLI command |
|---|---|---|
| `doctor.js` | 8-check health report (repo structure, manifest integrity, skills consistency, hooks reachable, MCP servers, adapters compiled, governance baseline, state tracking) | `hseos agent-core doctor` |
| `audit.js` | Source-vs-compiled drift detection — hashes assets, compares to manifest signatures, reports stale adapter outputs | `hseos agent-core audit` |
| `integrity.js` | Hash chain verification — validates that `.agents/.signatures/<adapter>.sha256` matches the current emitted bundle for each adapter | `hseos agent-core verify` |

## Output contract

Each module returns a structured object plus prints a human-readable summary on stdout:

```javascript
{
  ok: boolean,           // overall pass
  checks: [
    {
      id: 'string',
      title: 'string',
      ok: boolean,
      details: 'string?',
      remedy: 'string?'  // suggested fix when !ok
    }
  ],
  warnings: ['string'],
  errors: ['string']
}
```

Exit codes follow Unix conventions:
- `0` — all checks passed
- `1` — one or more errors
- `2` — warnings only (still actionable)

## SessionStart integration (Wave 6 implementation)

A `sessionstart-hseos-doctor-quick` hook entry will be added to `.agents/hooks/registry.yaml` calling `hseos agent-core doctor --quick --json` (≤ 200 ms target). The result is logged via the existing state-emit pipeline.

## CI integration (Wave 6 implementation)

`.github/workflows/hseos-audit.yml` will run `hseos agent-core audit` on every PR. Drift fails the workflow.

## Authoring conventions

- Pure functions when possible; side effects are limited to reading files and invoking sha256
- No throws — all failure modes encoded in the returned object
- Each check is independently testable (mock filesystem in unit tests)
- Output is deterministic (no timestamps, no random ordering)
