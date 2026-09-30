# Disposable engineering task contract (candidate)

Artifact type: CLI contract documentation.
Scope: structural validation and bounded deterministic candidate execution.
Governance: [ADR-0040](../.enterprise/.specs/decisions/ADR-0040-disposable-engineering-execution.md),
Enterprise Constitution, automated-validation policy, existing AgentLimitsSchema.

```bash
hseos agent validate-task --task-contract task.json --json
```

Validation reads one regular, single-link JSON file of at most 1 MiB. It creates no
session, resolves no provider secret, runs no task command and writes no workspace.
The JSON receipt contains the task id, a SHA-256 of the canonical parsed contract,
`status: structurally-valid`, `execution_authorized: false` and
`verifier_attested: false`. Invalid input fails with a nonzero exit without echoing
source contents. Structural validation alone never enables execution.

The [example fixture](../test/fixtures/engineering-task/addition.json) intentionally
contains unfinished code and a placeholder verifier digest. Its structural validity
does not prove implementation or availability of that verifier.

| Field | Contract v1 |
|---|---|
| `schema_version`, `task_id` | Version 1 and existing kernel identifier grammar |
| `execution_profile` | `disposable-engineering-candidate`; explicit local candidate |
| `baseline_sha` | Exact 40-character lowercase Git SHA; not proof of checkout identity |
| `sources` | Bounded specification/memory data, each with id, content and verified SHA-256 |
| `requirements` | Unique ids and descriptions linked to known source ids; all sources used |
| `acceptance` | Unique criteria linked to requirements; all requirements covered |
| `initial_files` | Bounded path/content/digest entries inside read scope |
| `scope.read`, `scope.write` | Exact relative file paths, at most 64 combined; write is a subset of read |
| `commands` | Unique ids, runtime `node` or `python`, declared entrypoint and exact argument array |
| `limits` | Existing AgentLimitsSchema, safe integers; this initial slice permits no children/workflows |
| `max_failed_corrections` | Integer from 0 to 2; bounds correction attempts within the original session and budget (0 disables them) |
| `max_artifact_bytes`, `max_output_bytes` | Positive bounded budgets; initial contents must fit |
| `verifier` | External `verifier://` reference/digest and exactly all acceptance ids |
| `rollback` | `discard-disposable-workspace` |

Objects reject unknown fields. Paths use portable alphanumeric-leading segments
with dots, dashes and underscores; no absolute paths, traversal, hidden control
paths, backslashes, wildcards or file/directory prefix collisions. This first
fixture contract does not describe arbitrary legacy project layouts or installs.

Sources remain data, even when they contain imperative text. The validator neither
assigns privileged message roles nor resolves semantic contradictions. Future
execution must independently check intent conflicts, the checkout/baseline, actual
filesystem links and identity, budgets against active authority, runtime and
sandbox bindings, and the protected verifier. A forged verifier digest can pass
structural validation but must never authorize execution or acceptance.

## Reproduce the candidate outside the checkout

Install the root package in an empty consumer directory, then generate one of the
three protected examples (`addition`, `clamp`, `unique`) from that installation:

```bash
node node_modules/hseos/tools/examples/engineering-task.js addition ./addition
npx --no-install hseos agent validate-task --task-contract addition/task.json --json
npx --no-install hseos agent run --task-contract addition/task.json --scripted-responses addition/responses.json --json
```

The generator pins the installed verifier implementation and its criteria. Its
synthetic baseline is not a Git checkout attestation. These scripted responses
exercise the real kernel/tools/executor; they do not demonstrate model reasoning.
No provider credentials are read. A task without responses returns `not_executed`.

Linux x64, bwrap, `/usr/bin/node`, `/usr/bin/python3`, prlimit and an already
delegated cgroup v2 parent with memory/pids controllers and writable `cgroup.kill`
are required. Missing prerequisites block execution; there is no host fallback.
The code executor receives a read-only disposable workspace, read-only system
runtime mounts, private temporary storage, namespaces, network-denying seccomp and
an empty inherited environment. Gateway writes are exact-path, digest-conditional,
byte-bounded operations. The task cannot modify the verifier or control database.
The executor caps its descendant group at 32 processes and 256 MiB (no swap),
bounds output and elapsed time, and drains the group before reporting completion.
These fixed candidate limits are not configurable production capacity guarantees.

The receipt separates session `status` from `task_result` (`approved`, `failed`,
`blocked`, `not_executed`). A model stop or process exit zero does not approve the
task. The trusted verifier compares outputs from isolated artifact execution with
protected criteria. Versioned evidence binds contract, session, artifact snapshot,
verifier and isolation digest. With `max_failed_corrections` set to 1 or 2, a protected
rejection requests diagnosis and correction before the session ends. Existing
contracts with zero keep their single-attempt behavior.

Use the returned state directory for subsequent operations:

```bash
npx --no-install hseos agent status --profile disposable-engineering-candidate --state <state> --json
npx --no-install hseos agent cancel --profile disposable-engineering-candidate --state <state> --json
npx --no-install hseos agent resume --profile disposable-engineering-candidate --state <state> --expected-sequence <sequence> --json
```

`--create-only` prepares a resumable task with its original deadline. Concurrent
starts use an optimistic claim. A worker interrupted after claiming execution
requires effect reconciliation; resume does not replay possibly completed writes.
Cross-process cancellation waits for the owner to confirm teardown; absent
confirmation it reports `blocked`, not success. A cancelled task is `not_executed`
with reason `cancelled`, meaning acceptance was not completed; earlier changes may
exist in its preserved disposable workspace. Discarding that workspace is rollback.

The additive task-event schema is activated only in temporary fixture databases.
Existing histories are not rewritten. The separate 18-run campaign with real
providers remains outside deterministic evidence.
Existing reference/provider profiles retain their contracts; ai-jail configuration
and production activation are unchanged.

The candidate also accepts `--binding <provider-binding.yaml>` in place of scripted
responses. It reuses the existing immutable OpenAI-compatible candidate binding
and broker. Only `env://` credential references and `transport.max_attempts: 1` are supported
by this public path. Uncertain provider attempts are not retried with a fresh budget.
The trusted worker talks to the private Unix socket; the isolated executor receives
neither that socket nor credential-bearing environment variables. Broker checks
block reflections of the configured credential in request/response free text,
including split response chunks. They do not detect every possible secret.
Create-only and evidence/status/cancellation operations do not start provider egress.
A new dispatch on resume resolves the original binding and keeps the original deadline.

`hseos agent evidence --profile disposable-engineering-candidate --state <state> --json`
returns the immutable contract, latest artifact snapshot and versioned verification
record. A worker interrupted after a completed session can resume only independent
verification after descendant cleanup; recorded tools are not dispatched again.
Interrupted tools are inspected through reconciliation before any continuation.
Unresolved questions require explicit answers bound to the current report.

No external model campaign is implied by tests against a simulated upstream. Real
bindings, spend authorization and the separate 18-run campaign remain necessary.


## Diagnosis and bounded correction

Generate a deterministic rejection/correction example from the installed package:

```bash
node node_modules/hseos/tools/examples/engineering-task.js correction ./correction
npx --no-install hseos agent run --task-contract correction/task.json --scripted-responses correction/responses.json --json
```

The scripted `fixture.submit` marker represents a model stop; it is not an executable
tool. The protected review compares the artifacts against the original acceptance
criteria. Its feedback includes the observed files and their `files_sha256`.
Before a corrective write, the worker must call `engineering.diagnose` with that
digest, a cause, a correction plan and valid original `requirement_ids`. The gateway
rejects corrective writes without a matching diagnosis. The explanation is a model
hypothesis, while acceptance remains independently verified. Neither a new correction
nor a new recovery turn resets time, token or tool budgets. Workflow dependencies
remain blocked until the corrected task is approved or its correction limit ends.

## Inspect uncertainty before continuing

```bash
hseos agent reconcile --profile disposable-engineering-candidate --state <state> --json
hseos workflow reconcile --state <workflow-state> --json
```

These operations do not call a model provider. They prove worker quiescence and
isolation, inspect the workspace and run the protected verifier. Reports include
current file digests, durable intents, incomplete operations, budget accounting,
verification and `questions`. A matching write effect is not repeated. Its missing
original receipt remains recorded as interrupted; independently observed state is
separate evidence and cannot forge provider success.

When `questions` is nonempty, resume stays blocked. Supply an explicit response:

```json
{
  "report_sha256": "<sha256-from-current-report>",
  "decision": "continue-from-observed-state",
  "answer": "<your explanation acknowledging the specific observed uncertainty>"
}
```

```bash
hseos agent resume --profile disposable-engineering-candidate --state <state> --expected-sequence <sequence> --reconciliation-decision answer.json --json
```

For workflows, put the same decision objects in a JSON object keyed by task id
and pass `--reconciliation-decisions answers.json` to `workflow resume`.
The worker reinspects state before accepting the response. A stale digest or a
changed sequence prevents continuation. A response never expands scope, privileges,
commands, acceptance criteria or budget, and cannot waive missing isolation or an
expired deadline. Partial model responses and unknown command outcomes are not
silently replayed; their abandonment requires the explicit response. Unconfirmed
model usage is conservatively charged, separately from provider-reported usage.

Nonterminal interrupted sessions continue in a new turn of the same session after
settlement, preserving all prior events. A completed session can only resume pending
verification without new model/tool events. Already failed/cancelled sessions or
final task outcomes are not reopened; inspect their evidence and define a new task
if further work is needed. Detected uncertainty is always surfaced as a question;
no text response is treated as permission to bypass the kernel's hard constraints.
