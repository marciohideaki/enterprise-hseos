# HSEOS v4 candidate: migration and rollback

This coordinated distribution is a candidate, not an operational activation.
The v3 checkout/distribution and its histories remain separate and intact. Do not
replace an installed v3 runtime until the candidate's required gates and your
activation review have passed. Internal `@hseos/*` modules ship together; they are
not independently published releases.

## Evolution toolchain

The subsequent evolution requires Node.js 22 or newer and configures CI for
Node 22/24. Install dependencies with the same Node executable used to run the
CLI: native SQLite binaries are ABI-specific. The historical candidate's Node
20/22 receipts remain unchanged and do not certify the evolution. Keep the
previous distribution for rollback until the new gates and activation review
pass. See [evolution status](evolution/STATUS.md).

## Task execution

Use `agent run --task-contract <file> --scripted-responses <file>` for the bounded
keyless engineering examples. See [the task contract](engineering-task-contract.md).
`session.completed` still means the session ended. Only `task_result: approved`
means the protected verifier accepted the task. Existing session histories are not
reinterpreted. This candidate has no automatic paid-provider activation.

## Workflow execution

`workflow run --definition <file>` composes task contracts through the existing
WorkflowEngine, LocalSubagentProvider and execution supervisor. Definitions bind
inputs, exact commands, protected acceptance, dependencies and finite tree limits.
Tasks initially have no children. The root reserves the declared leaf ceilings;
usage is derived from canonical session events and unused capacity is released
when the engine releases the workflow. A rejected verifier requests bounded diagnosis/correction when the contract permits it;
dependent tasks wait until approval. An exhausted correction limit stops dependents.

Use `workflow validate --definition <file>` before creating a run. The returned
state directory supports `workflow status --state`, `workflow cancel --state` and
`workflow resume --state --expected-sequence`. `--create-only` prepares a run.
A live cancellation waits for task settlement. After a worker dies, resume verifies
its PID/start-time identity and the expired durable claim. It skips approved tasks,
resumes verification for completed sessions, and reconciles interrupted nonterminal
sessions against current artifacts and durable intents. Original deadlines and
reservations remain unchanged. Unexplained changes and interrupted command/model
outcomes require explicit answers bound to the current reconciliation report. Cancellation can reap
that dead worker's executor and settle the workflow without retrying the command.
Older candidate claims without provable owner identity remain blocked.

Methodology entries in the catalog are recipes. Passing a readiness check does
not make a recipe executable. Bind its concrete tasks and acceptance criteria into
a new definition; do not infer command authority from Markdown instructions.

The v3 mutable YAML actions (`init`, `advance`, `gate`, `sync`, `batch`, story state
updates and legacy resume) are retired. The v4 CLI contains no YAML execution
engine. `workflow status <recipe> --repo <path> --run-id <id>` reads a legacy run
without modifying it. Historical runs cannot be resumed or automatically converted
into effects. Keep their files as audit evidence and start a new, validated run.

Complete YAML definitions using the new task-graph schema can be converted with
`hseos workflow migrate --definition definition.yaml --output definition.json`.
The destination must be new. Migration validates contracts, dependencies, budgets
and protected criteria; it never executes tasks. Recipes and legacy run state are
ineligible until concrete task contracts are supplied. Validate the generated JSON
again before starting a new run.

Executable tasks may instead contain `binding`, the complete existing candidate
provider binding, with an empty or omitted `responses` list. The same task runtime
uses the existing credential broker. Do not put secret values in definitions;
only the binding's secret reference belongs there. Executing such a definition is
an explicit provider selection and requires its credential and spending authority.

## State and rollback

Candidate session/task migrations apply only to explicitly temporary fixture
SQLite databases. They do not activate production state migrations. New task
snapshots and evidence have their own version; old session snapshots remain on
the existing read path.

To roll back a consumer trial, stop its processes and return to the unchanged v3
distribution/configuration. Preserve the v4 state directory if evidence is needed;
discard only its disposable workspace after review. Never copy a v4 database over
a v3 database or rewrite legacy run files. The ai-jail active profile, dashboards,
managed governance and global installation are not changed by this candidate.

Release publication, the applicable v3 deprecation window and operational cutover
remain separate release decisions. This guide does not authorize any of them.


## Additional candidate events

Protected corrections add `model.revision.requested` with exact continuation
lineage. Reconciliation adds `tool.execution.reconciled` for previously uncertain
receipts and `session.reconciled` for proof references and conservative reservations.
Previous evidence remains intact. The task ledger records reviews, diagnoses and
reconciliation answers. These additive contracts require the updated coordinated
candidate to read newly written events; do not downgrade a database containing
them into an older runtime. No production migration is activated automatically.
See [diagnosis and reconciliation commands](engineering-task-contract.md).
