# ADR-0027: Explicit Hook and Workflow Contracts

## Status

Accepted on 2026-08-28 by explicit human authorization.

## Context

The hook compiler treated an omitted status as active, allowing incomplete
entries to become executable. The workflow registry also mixed executable
phase machines with an operational subsystem descriptor without declaring the
difference. Its MCP reader parsed YAML as indentation-sensitive text and could
return an inaccurate catalog.

Some workflow outputs also implied that opening a deployment pull request
included its merge, which conflicts with the mandatory human-approval gate.
Resource-intensive phases require a sequential default, but that contract was
not machine-readable.

## Decision

Canonical hooks use schema version 2.0 and every hook declares one of `active`,
`inactive`, `pending`, or `deprecated`. Only `active` hooks are emitted.
Schema 1.0 remains a compatibility input; its omitted status is normalized to
`active` by the compiler before downstream adapters receive it.

The workflow registry uses schema version 2.0. Every entry declares either:

- `kind: executable`, with non-empty ordered phases, checks, and
  `execution_mode: sequential`; or
- `kind: subsystem`, with operational surfaces but no executable phase fields.

CLI and MCP discovery share one parsed, fail-closed catalog loader. Stateful
execution actions reject subsystem descriptors. Deployment outputs separate PR
opening from explicit human approval and governed merge evidence.

## Alternatives Considered

### Preserve implicit defaults

Rejected because omission silently changes executable behavior and cannot be
distinguished from an authoring mistake.

### Split subsystem descriptors into another registry immediately

Rejected for this change because a typed entry establishes the boundary
without breaking discovery IDs. Physical extraction can follow once consumers
support a side-car registry.

### Keep independent CLI and MCP parsers

Rejected because two parsers had already produced different interpretations of
the same file.

## Consequences

### Positive

- Hook activation is explicit and auditable.
- Executable workflows cannot be confused with operational side-cars.
- Workflow phases declare their sequential execution default.
- CLI and MCP return the same workflow identities, types, profiles, and phases.
- PR merge claims align with the human approval policy.

### Negative

- Canonical hook and workflow registries require schema migration.
- New workflow entries must satisfy stricter structural validation.
- Legacy hook inputs remain supported until the compatibility path is retired.

## Mitigations

- Preserve all existing hook and workflow IDs.
- Normalize legacy hook omissions only at the compatibility boundary.
- Add schema rejection tests and real-catalog discovery tests.
- Keep subsystem discovery available while rejecting unsupported execution
  actions.

## References

- `ADR-0013-pr-closeout-and-branch-lifecycle.md`
- `AGENTS.md`
- `.enterprise/governance/hooks/registry.yaml`
- `.hseos/workflows/registry.yaml`
- `tools/cli/lib/workflow-catalog.js`
- `tools/cli/installers/lib/core/agent-core-compiler/sources/hooks-source.js`
