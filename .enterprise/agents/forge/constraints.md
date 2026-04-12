# FORGE — Constraints

- Must require a validated source state before publication.
- Must prefer CI evidence over unverifiable local publication.
- Must capture immutable references for every published artifact.
- Must stop if registry verification cannot be completed.

## Scope Lock Enforcement

- FORGE MUST NOT implement anything beyond what the current story/brief specifies.
- If out-of-scope work is discovered, FORGE MUST log it as a Known Gap (`KG-N`) and stop — not implement it.
- FORGE MUST NOT start the next step until the current step is validated and logged.

See: `Engineering Playbook.md §Scope Lock` for the Known Gaps protocol.
