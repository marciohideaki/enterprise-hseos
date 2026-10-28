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

## W5 behaviour changes

The W5 candidate changes the behaviour below. None of it activates a production
state migration, publishes a release or enables a plugin; those remain separate
decisions. Historical events and already admitted contracts stay readable.

### MCP argument validation (W5-04)

- `limit` and `stale_minutes` given as strings (for example `{"limit": "10"}` or
  `{"stale_minutes": "30"}`) are no longer accepted. The transport validates
  `tools/call` arguments against the declared `inputSchema` and answers `-32602`.
  Send integers. The extra numeric range (`stale_minutes` 1 to 1440) exists only on
  the internal `scheduler_sweep_orphans` tool, which is a fixture.
- A legacy MCP HTTP request body above 1 MiB is answered with `413` and `-32600`
  (`Request body exceeds limit`); the body never reaches a tool.
- A message without an `id` (a notification) never receives a response, for every
  method, in both the legacy transport and the `mcp-2026` adapter.
- A malformed server or tool, or an unresolvable `$ref` in an `inputSchema`, fails
  at boot (exit `78`, `MCP_TOOL_CATALOG_INVALID` or `MCP_TOOL_SCHEMA_INVALID`)
  instead of being skipped or failing on the first call.
- A tool-argument validation failure in the `mcp-2026` adapter reports only the
  failing `keyword` and `instancePath` per issue in `error.data.issues`; property
  names, values, allowed values and schema paths are no longer echoed. An
  `outputSchema` violation reports no per-item detail, only
  `error.data.issues.issue_count`.
- The legacy transport returns an error message to the client only for errors the
  server worded itself (an `error.code` on its allowlist: `MCP_TOOL_UNKNOWN`,
  `MCP_SCOPE_DENIED`, `TASK_NOT_FOUND`, `HANDOFF_NOT_FOUND`, `RUN_NOT_FOUND`,
  `PROJECT_STATE_ARGUMENT_REQUIRED` and the `AXON_`, `MANAGED_GOVERNANCE_` and
  `EXECUTION_ACTIVATION_` families). Any other failure answers `Tool failed`
  (`-32000`) or `Internal error` (`-32603`); the cause goes to stderr only.
- Unknown tools and out-of-scope requests are denied and recorded. Outside the
  fixture the legacy path still runs, always through the gateway, and each denial
  is stored durably in `mcp_gateway_denials` in the legacy telemetry SQLite.

### Environment and memory tools over the governed MCP server (W4-C7)

- `environment.lsp.*`, `environment.dap.run`, `environment.browser.run`, `environment.computer.*` and
  `memory.{write,retrieve,delete}` have providers in the governed runtime. They are served only when the server is
  started with an `environmentHost`: a builder `({ ledger, approvalStore, resolveMemoryDeleteApproval }) => host` with
  `lsp`, `dap`, `browser`, `computer` (services of `packages/agent-environment`), `approvals` (the computer approval
  gate, needed with `computer`), `project_id` and `memory: { store, rules, actor, operator }`. The returned shape is
  validated at boot and a missing or unknown member fails loudly.
- A tool whose service the host does not provide is not listed in `tools/list`. A runtime caller that reaches the
  contract anyway gets the stable code `ENV_CAPABILITY_UNAVAILABLE` (distinct from `NOT_IMPLEMENTED`: the contract is
  implemented, the process has no provider for it). `memory.*` refuses any project other than the host's with
  `ENV_PROJECT_SCOPE_MISMATCH`.
- `computer.start`, `computer.act` and `memory.delete` ask for explicit approval through the existing elicitation flow.
  For `computer.act` the prompt shows the action, its arguments and the screenshot digest the service gate binds the
  grant to; the service gate is resolved only after that approval, in the approver's name. The server stays fixture-only
  (`EXECUTION_ACTIVATION_PENDING` otherwise).

### Context floor for `max_tokens` (H-4)

New task admissions refuse a `limits.max_tokens` that cannot hold the first model request, with the stable
`detail.code` `ENGINEERING_MAX_TOKENS_BELOW_FLOOR`. The message names the minimum and the received value
(for the `addition.json` task with the default 8192 output reserve: minimum 11903; a provider with a smaller
output cap lowers it). Before, such a task was admitted and ended in `session-failed:internal_error` with a
generic message, because the context overflow is not one of the runtime's normalized failure codes
(`packages/agent-runtime/runtime.js`, unchanged). Raise `max_tokens` to at least the reported minimum.
The control API checks the exact cap of the binding or plugin model it resolves; only `validate-task` without a
model source and the structural pre-read of `agent run` assume the smallest possible reserve (3712 for
`addition.json`), and `agent run` repeats the check with the exact cap.

The minimum is a lower bound, not a guarantee: a value just above it can still end in the generic failure.
Measured margins above the minimum: 752 to 753 tokens for the schema 1 `addition.json` task (caps 96 to 8192),
2359 tokens for the schema 2 project fixture with a plugin model of cap 8192; extensions and environment tools were
not measured. Later requests must also fit and report `session-budget-exceeded` (with its numbers) when they do
not. Contracts already admitted, replays, job claim and recovery, and a plain `readEngineeringTask` are not
re-checked; `job expand` does re-check, like the W5-10b rules. No field, type or schema version changes.

### Stricter acceptance for engineering tasks (W5-10b)

New task admissions now refuse a delivery that cannot be verified, with stable
`detail.code` values:

- `ENGINEERING_ACCEPTANCE_WEAK`: the contract declares no protected `command_checks`
  and its verifier is not a pinned module verifier (`node-module-v1` or
  `python-module-v1`), so acceptance would rest on static text matching such as
  `web-content-v1`.
- `ENGINEERING_ACCEPTANCE_UNCOVERED` (W2): a criterion does not name, in `check_ids`, at least one
  executable check (a protected command check or a check of a pinned module verifier;
  `web-content-v1` never counts). This closes the owner waiver MAJOR-1 of W5-10b, which had kept
  coverage global through `verifier.acceptance_ids`; contracts already admitted remain readable
  and their `contract_sha256` does not change.
- `ENGINEERING_COMMAND_ARG_INVALID`: an argument of a command used by a
  `command_checks` entry is outside the conservative argument alphabet.
- Cross-rule refusals that used to share one `detail.code` now have their own (list in
  `docs/engineering-control-api.md`); the old code stays with the primary rule of its family, so a client
  that matched a shared code must also match the new ones. Contracts that were valid stay valid.
- `command_checks` arguments are unwrapped (percent-escapes, `file:`, `-cVALUE`, `:line:col`, `=` splits)
  before the outside-root and writable checks, at every parse; new admissions also refuse the wrapped
  forms with `ENGINEERING_COMMAND_ARG_INVALID`.
- An argument that unwraps to more than 64 distinct readings is refused with
  `ENGINEERING_COMMAND_ARG_INVALID` at every parse (fail-closed; exactly 64 is accepted).
- Order of checks changed for contracts with more than one fault: `source_ids` and `requirement_ids` are
  checked for repeats before unknown ids, and `initial_files` are checked for readability, then digest, then
  the byte budget (before, all of these were `ENGINEERING_INITIAL_FILES_INVALID` or
  `ENGINEERING_TRACEABILITY_BROKEN`). A contract with a single fault gets the same refusal, with the code of
  that fault.
- The scope denial message is `input does not match schema v1: path is not one of the paths this task
declares in scope.read or scope.write` (code `ENGINEERING_SCOPE_DENIED` unchanged, no input value echoed).
- `ENGINEERING_PROTECTED_CONFIG_MISSING`: a contract with `command_checks` lists a
  known project configuration file among its readable or initial files without
  declaring it in the verifier's protected paths.

Scope of the change: it applies only to new admissions (task create, workflow
create and job create, retry and expand, including the `/v1/jobs/commands`
pre-check). Claim, recovery, replay of an earlier admission and reading an
existing task keep the previous rules, so work admitted before the upgrade still
runs. Existing refusals gained `detail.code` labels without changing what they
accept. To adapt a contract that is now refused, add protected `command_checks` or use a pinned
module verifier, protect the configuration files the checks read, then submit it again. To roll back,
return to the previous runtime; admitted tasks are unaffected.

### `pids_max` is required for client campaign adapters (live battery T2)

The `native` (Codex and Claude) and `claude-account` campaign adapters no longer
accept a binding whose options omit `pids_max`. Before, an omitted value silently
fell back to the executor default of 32 processes, which real clients exceed.

- Behaviour: options without `pids_max` (an integer from 32 to 256) are refused
  when the adapter is created, with `code: CONTROL_PROVIDER_CONFIGURATION_INVALID`.
  The message starts with that code and carries the original validation message,
  which names the field; the original error is kept as `cause`. The same applies
  to `native_options` of the ACP adapter, which builds a native adapter. Values
  outside 32-256 were already refused and still are.
- Pinned digests: the artifact digest of the native adapter changes because the
  files it covers changed, and `binding_sha256` changes whenever the options do.
  Re-pin any stored manifest that names the old values.
- Not affected: the Antigravity adapter keeps `pids_max` optional; the executor
  accepts the same 32-256 range, now read from the isolation profiles instead of
  being repeated in `executor.js`.
- To adapt: add `pids_max` to the adapter options (the calibration notes in
  `docs/evolution/w3/ADAPTERS-CAMPAIGN.md` recommend 256 until `pids_peak` is
  measured), recompute the binding digest and submit the manifest again. To roll
  back, return to the previous runtime.

## `hseos install`: concurrent installs in one directory are refused

Two `install`, `update` or quick-update runs writing the same project directory
could interleave their writes to the manifest. They now take an exclusive lock,
`<directory>/.hseos-install.lock`, which holds the pid of the running install.

- A second run in the same directory is refused: it prints
  `Another hseos install is already running in <directory> (pid N)` and exits
  with code 75 (`EX_TEMPFAIL`). Nothing is queued and nothing is written. Retry
  when the first run finishes.
- A lock whose holder is dead (crash, `kill -9`) is taken over automatically,
  under a short-lived `<directory>/.hseos-install.lock.takeover` mutex so two
  runs can never both discard it. The lock is released on success, on error and
  on SIGINT, SIGTERM and SIGHUP.
- If the pid in the lock was recycled by an unrelated live process, the refusal
  names the lock file: delete it by hand once you know no install is running.
- The lock covers the installer's own writes (`install`, `update`, quick update
  and agent recompilation). Files the CLI writes after the installer returns
  (capability selection, platform bindings) are outside it. The directory is
  created before the lock if it does not exist yet, and the lock file shows up
  in `git status` of the project only while an install is running.
- Installs in different directories do not block each other. A single install
  behaves as before and leaves no lock behind.
- To adapt: scripts that start several installs in one directory must run them
  one after the other, or treat exit 75 as "try again". To roll back, return to
  the previous runtime.
