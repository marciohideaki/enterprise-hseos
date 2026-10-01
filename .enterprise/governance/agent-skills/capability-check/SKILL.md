---
name: capability-check
version: "1.0"
description: "Check reusable capability candidates and record the required intake before implementation"
trigger: "before creating or editing an exported component, hook, provider, utility, token, service, or infrastructure helper"
skip: "tests, stories, mocks, generated files, or edits without a new export"
metadata:
  owner: platform-governance
---

# Capability Check

## Tier 1 — discovery

Run `hseos capability-check <symbol|name|file> [--directory <path>] [--json]`. The check is deterministic and registry-first:

1. It loads the platform bindings from the runtime defaults, the user layer and the project file (`.hseos/config/platform-bindings.yaml`; this command takes no platform flags) to get the mode (`platform`, `hybrid`, `local`), the stacks and any `keep-local` or `exception` override.
2. It resolves the query through the ECP capability registry (snapshot, path or synced remote) by name, alias, contract, package or symbol, and lists the implementations for the project's stacks.
3. It prints a verdict per capability: `consume <package>` when an implementation exists for the stack, `extend (implement the contract for <stack> in the owning core)` when none does, `overridden: <outcome> (<ref>, expires <date>)` for a recorded override, and `informational` in local mode. In hybrid mode a verdict is also marked `advisory` unless an implementation is `stable`.
4. A secondary filesystem scan (labelled `heuristic`) lists filename matches in `packages/`, `cores/`, `src/BuildingBlocks/` and the configured workspace (`workspace.cores_root` or `HSEOS_CAPABILITY_WORKSPACE`, nested or flat layout). Symlinks are followed only inside their root.

`--json` prints `{ query, mode, mode_source, stacks, registry, results, filesystem_candidates, warnings, errors }`. Exit code 1 means the bindings or the registry failed their integrity checks; exit code 2 is a usage error (empty query, `--directory` not a directory); a query with no match is a completed query. The mode recorded in git (`HEAD`) is the baseline, so an uncommitted weakening is rejected.

Use the Capability Graph as the authority for identity and ownership; the registry result decides `consume` versus `extend`, and the heuristic list is only a pointer to local code.

## Tier 2 — intake

Create a v2 intake decision before code. The decision must contain exact graph evidence, semantic discovery evidence or `unavailable`, candidate consumers, rationale, risk controls, and the selected outcome. `promote` requires `graph_update`; `keep-local` explicitly describes the product/provider boundary. Chain `core-drift` to update the Core Registry projection.
