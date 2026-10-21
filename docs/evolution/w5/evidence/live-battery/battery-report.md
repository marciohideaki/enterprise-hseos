# Live battery: consolidated report (L0, T1 to T4)

Consolidation of the live battery run in a connected session (2026-10-17 to 2026-10-21): a model dispatched through a
governed provider campaign (subscription route, `binding:claude-w5-account`, `claude-sonnet-5-5`), its plan applied
through the managed-project route and judged by a protected verifier whose digest is pinned before the first
reservation. The per-task evidence is in `t1/` to `t4/` (receipt, prompt, one folder per dispatch); this file adds the
cross-task view and the cost of the squad. It holds no raw prompt text beyond what the receipts already carry, no
credential and no account identifier.

This report does not repeat any prompt. The exact prompt of each task is committed by design in `t1/prompt.txt` to
`t4/prompt.txt` (see the README of this folder), next to its receipt, together with the redacted ledgers.

Local paths: the `result.json`, `ledger-rows.json` and receipts cite paths such as `/build/tmp/...` and worktree
paths. They are local references of the execution (harness, clones and logs kept outside the repository), not files
of this repository, and may not exist on another machine.

## 1. Outcome

| Task | What was fixed or added                                                                                                                  | Capabilities exercised                                      | Dispatches                                    | Verifier                                                              | Review                                                                       | PR / merge                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| L0   | Read-only evidence catalogue per capability (outside the repository); no dispatch                                                        | none (preparation)                                          | 0 of 1 reserved                               | not applicable                                                        | not applicable                                                               | not applicable                                                        |
| T2   | `pids_max` required in the native and claude-account campaign adapters; the executor reads its range from the isolation profiles         | FR10 (pids_max limits only), FR14, FR15, FR11               | 2 (attempt 1 FAIL by harness, attempt 2 PASS) | PASS, 104 of 104 tests, package surface 1 of 1, kernel coverage 90/80 | skeptical review run by the Commander's reviewer; the receipt records none   | #231, merged                                                          |
| T3   | The engineering runtime declares authority and provenance for its context sources; `context.assembled` is emitted as v2 with `sources[]` | FR01/FR02, FR14, FR15, FR11                                 | 1 (PASS)                                      | PASS, 85 of 85 tests, kernel coverage 90/80                           | skeptical review run by the Commander's reviewer; the receipt records none   | #232, merged                                                          |
| T4   | HTML escaping in the kanban client (`tools/state-ui-server/web/app.js`): quotes, wave, agent run id, colour validation                   | FR14, FR15, FR11 and a UI audit                             | 1 (PASS)                                      | PASS, 14 test cases plus the existing suite; 16 after review          | 1 round of correction (test strengthened, 16 mutations killed); approved     | #233, merged                                                          |
| T1   | The capability intake guard detects CommonJS logical, bracket and alias export forms (`tools/cli/lib/capability-intake-guard.js`)        | FR14 and FR15 on the v2 window contract (large files), FR11 | 5 (4 without receipt, attempt 5 PASS)         | PASS, 12 "cjs gaps" tests and 101 guard tests, package surface 1 of 1 | approved with reservations; 1 round of correction (complexity test, receipt) | on `task/w5-t1-guard` (commits 9b068841 and 562741d2), merges with W5 |

Every task changed a real defect or gap in the repository: none of the five tasks is synthetic. The model wrote the
production change of T1 to T4 through one governed `engineering.patch` each; tests, harness, evidence and receipts were
prepared by the executors.

## 2. Requests: authorised against consumed

Owner decision (`owner-decision.md`, 2026-10-17): cost 0, one binding, battery ceiling 12 requests, one campaign per
wave, 45 minutes per campaign. Wave ceilings: L0 1, T3 3, T1 3, T2 2, T4 2, reserve 1.

| Task      | Wave ceiling | Allowed by the campaigns (sum of `max_requests`) | Consumed | Note                                                                                                   |
| --------- | -----------: | -----------------------------------------------: | -------: | ------------------------------------------------------------------------------------------------------ |
| L0        |            1 |                                                0 |        0 | no dispatch was needed                                                                                 |
| T2        |            2 |                                        3 (2 + 1) |        2 | the second campaign carried over an unused allowance with the Commander's approval                     |
| T3        |            3 |                                                3 |        1 |                                                                                                        |
| T4        |            2 |                                                2 |        1 |                                                                                                        |
| T1        |            3 |                            9 (3 + 2 + 1 + 2 + 1) |        5 | 3 under the 2026-10-17 authorisation reconfirmed on 2026-10-21, then 2 under a new owner authorisation |
| **Total** |       **12** |                                           **17** |    **9** | consumed 9 of 12                                                                                       |

T1 went above its wave ceiling of 3 only with explicit owner decisions (2026-10-21, two later authorisations), and the
battery stayed within 12. The campaign allowances are a ceiling, not a consumption: a campaign can allow more than the
wave ceiling because a new campaign is opened per attempt.

## 3. Receipts (real usage)

Under the subscription route the receipt carries `cost_microusd: null` and the campaign `committed_microusd: 0`: it is
not a measured cost, and the dispatch cost to the owner is zero by the decision above.

| Task | Passing attempt |                                           Input tokens |                     Output tokens | `cost_microusd` | Reserved to receipt |
| ---- | --------------- | -----------------------------------------------------: | --------------------------------: | --------------- | ------------------: |
| T2   | 2               |                                                  7,436 |                             2,429 | null            |                16 s |
| T3   | 1               |                                                  6,829 |                             2,469 | null            |                17 s |
| T4   | 1               |                                                  6,893 |                             2,673 | null            |                17 s |
| T1   | 5               | 7,977 (7,784 cache read, 191 cache creation, 2 direct) | 14,971 (12,824 of them reasoning) | null            |               110 s |

T2 attempt 1 (FAIL by the harness, not by the model) used 7,436 input and 2,410 output tokens and 18 s from reservation to receipt. The times come from the campaign ledger rows. The T2 receipt keeps its historical `wall_s` (208 s and 117 s), which do not match the ledger; it carries a correction note and `wall_s_ledger`. The four T1 attempts
without a receipt have no usage: their reservations stay counted as spent.

## 4. Review and correction rounds

- T4: skeptical review approved with reservations (production correct, test blind to the border colour and to the
  edges of the colour pattern). One correction round, 16 mutations of `app.js` killed.
- T1: skeptical review approved with reservations: master against HEAD differential 0 over 315 files, 38 adversarial
  cases without regression. One correction round: a ratio-based complexity test for heavy CommonJS input.
- T2 and T3: a skeptical reviewer ran (transcripts in section 6); the receipts record no round.
- Two executor adjustments on top of the T1 model output (lint, and removal of a second tokenizer pass) are recorded
  with separate diffs in `t1/`.

## 5. Limitations

- The prompts were prescriptive (the design, the blocks to replace and the exact calls were given): each dispatch
  proves the governed route, not the model's ability to design the change.
- The dispatch is single-shot text: the model gets no tool results, so reading a large file by range and searching
  were not exercised from the model side.
- NOT_EXERCISED: a real browser with console, real computer-use, LSP and DAP outside fixtures, memory, MCP and
  compaction/resume/fork. The campaign model only emits text and `environment.*` events are not persisted.
- Verifier coverage: the in-sandbox check only compiles the changed file; the behavioural verdict is the external
  verifier. T4 and T1 changed files outside the kernel coverage set, so no 90/80 gate applies to them.
- Evidence of T4 is by HTML string, not by a browser; the kanban server still sends no Content-Security-Policy.
- The T1 detection of aliases is by name pattern, without scope resolution; known false negatives are listed in
  `t1/receipt.json`.
- No receipt in this battery is a measured monetary cost.

## 6. Product findings

| Finding                                                                                                                                                                                 | Where                                                                                           | State                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The conservative token counter rejects an acceptable session at its last step, after the dispatch was spent                                                                             | `packages/agent-runtime/runtime.js:499-506`                                                     | open (T2)                                                                       |
| The managed-project contract refused any file above 65,536 characters (the T1 guard is 123 KB)                                                                                          | `tools/cli/lib/engineering-task-contract.js`                                                    | resolved by the window contract of W1 (large files by range and anchored patch) |
| The campaign worker drops its error and the runner ignores stderr, so every failure after a reservation is only `CONTROL_OUTCOME_UNCERTAIN`; any non-success client result is `refused` | `provider-claude-account-worker.js`, `provider-campaign-process.js`, `claude-cli-driver.js:275` | open, W6-E9                                                                     |
| The output limit of the manifest counts reasoning tokens (12,824 of 14,971 in T1) and is also the client cap, so a short plan can fail after minutes                                    | `provider-claude-account-adapter.js:212`                                                        | open, W6-E9                                                                     |
| Input tokens including cache reads and creation are limited to the manifest `max_input_tokens`                                                                                          | `provider-campaign-control.js:651`                                                              | open, W6-E9                                                                     |
| The governed route applies a patch as produced: model output needed prettier (T3, T4) and lint and performance adjustments (T1)                                                         | route design                                                                                    | open, noted in each receipt                                                     |
| `tools/state-ui-server` sends no Content-Security-Policy                                                                                                                                | `tools/state-ui-server/index.js`                                                                | open (T4)                                                                       |

## 7. Cost of the squad per activity

This is the estimated cost of running the squad (executors and reviewers) in this session, measured from the agent
transcripts with `interaction-metrics.py`. It is a different quantity from the zero cost of the model dispatches: the
dispatches went through the subscription route with `committed_microusd: 0`, while the squad's own cost is a
token-based estimate.

Method and limits:

- One row per agent transcript (JSONL); each assistant step is attributed to the activity of the tool it called.
- Prices are a parameter of the script. None is built in, so this report assumes the list price of a Sonnet-class model
  per million tokens: input 3.00, cache read 0.30, cache write 3.75, output 15.00 (USD). It is an estimate, not an
  invoice; reviewers that briefly used a larger model for one step are priced at the same rate.
- "Active time" is model latency plus tool time, not elapsed time (an agent waiting for the Commander or for a
  heavy-run queue is not counted).
- The `T4b-exec-and-T1` transcript is one agent that continued from T4 to T1 and is cut at 2026-10-21T17:48Z; the
  reviewer `T4-reviewer` also reviewed T1. Their rows cannot be split per task.
- Not found: a separate T1 executor or reviewer (T1 was prepared and run by the T4 executor agent and reviewed by the T4
  reviewer), and the Commander's own session (planning, decisions, merges), which mixes all work and was not
  analysed. Two reviewer transcripts named `aR-T1-reviewer` and `aR-T3-reviewer` date from 2026-10-09 (an earlier W5
  review of other work) and are excluded.

The raw output of the script for each transcript is in `cost/` (activity table and span; prices 3.00, 0.30, 3.75 and 15.00 USD per million tokens).

### 7.1 Per agent

| Transcript        | Task    | Role                                                                      | API calls | Tool calls | Output tokens | Cache-write tokens | Cache-read tokens | Active time (h) | Estimated USD |
| ----------------- | ------- | ------------------------------------------------------------------------- | --------: | ---------: | ------------: | -----------------: | ----------------: | --------------: | ------------: |
| `L0a-exec`        | L0      | Executor (read-only evidence catalogue)                                   |        55 |         66 |        35,199 |            193,629 |         7,175,185 |            0.08 |          3.40 |
| `T1a-exec`        | T1      | Executor (scope study, step 1)                                            |        36 |         34 |        35,257 |            144,346 |         3,419,468 |            0.09 |          2.10 |
| `T2a-exec`        | T2      | Executor (scope study)                                                    |        16 |         20 |        13,014 |             99,363 |         1,161,229 |            0.04 |          0.90 |
| `T2b-exec`        | T2      | Executor (red tests, harness, evidence, commit)                           |       174 |        165 |       118,972 |          1,891,395 |        34,985,363 |            0.92 |         19.40 |
| `T2-reviewer`     | T2      | Skeptical reviewer                                                        |        22 |         20 |        14,090 |             99,920 |         1,617,148 |            0.12 |          1.10 |
| `T3a-exec`        | T3      | Executor (scope study)                                                    |        12 |         19 |         9,316 |             94,992 |           860,505 |            0.02 |          0.80 |
| `T3b-exec`        | T3      | Executor (red tests, harness, evidence, commit)                           |       113 |        109 |        62,221 |            720,373 |        15,956,938 |            0.69 |          8.40 |
| `T3-reviewer`     | T3      | Skeptical reviewer                                                        |        14 |         17 |        10,023 |             99,469 |         1,014,715 |            0.05 |          0.80 |
| `T4a-exec`        | T4      | Executor (scope study)                                                    |        12 |         16 |         9,839 |             98,685 |           888,020 |            0.07 |          0.80 |
| `T4b-exec-and-T1` | T4 + T1 | Executor (T4 red tests to commit; T1 preparation, dispatch, port, commit) |       266 |        246 |       192,154 |          8,032,867 |        65,050,017 |            3.48 |         52.50 |
| `T4-reviewer`     | T4 + T1 | Skeptical reviewer (reviewed T4, later T1)                                |        50 |         51 |        33,807 |            510,650 |         4,949,495 |            0.27 |          3.90 |
| **Total**         |         |                                                                           |       770 |        763 |       533,892 |         11,985,689 |       137,078,083 |            5.84 |     **94.10** |

### 7.2 Per activity (battery agents only, same total)

| Activity            | API calls | Tool calls | Output tokens | Cache-write tokens | Cache-read tokens | Model+tool time (h) | Estimated USD | Share |
| ------------------- | --------: | ---------: | ------------: | -----------------: | ----------------: | ------------------: | ------------: | ----: |
| exploracao_codigo   |       285 |        312 |       109,703 |          4,394,451 |        47,619,186 |                1.72 |         32.41 | 34.5% |
| teste               |        92 |         93 |        54,761 |          2,635,653 |        16,049,667 |                2.09 |         15.52 | 16.5% |
| git_estado          |        95 |        101 |        56,709 |          1,459,240 |        17,721,840 |                0.29 |         11.64 | 12.4% |
| raciocinio_resposta |        62 |          0 |        88,415 |            838,517 |        12,076,435 |                0.20 |          8.09 |  8.6% |
| lint_format         |        62 |         62 |        84,508 |            496,164 |        12,319,852 |                0.47 |          6.82 |  7.3% |
| implementacao       |        83 |         87 |       101,389 |            168,337 |        15,098,496 |                0.28 |          6.68 |  7.1% |
| commit              |        27 |         28 |        13,459 |          1,134,862 |         6,080,518 |                0.46 |          6.28 |  6.7% |
| leitura_spec        |        29 |         44 |         9,025 |            639,225 |         4,209,961 |                0.03 |          3.80 |  4.0% |
| outros              |        17 |         18 |         2,915 |            180,640 |         2,861,405 |                0.01 |          1.58 |  1.7% |
| inventario_g3       |        15 |         15 |         9,312 |             31,920 |         2,747,119 |                0.29 |          1.08 |  1.2% |
| coordenacao         |         3 |          3 |         3,696 |              6,680 |           293,604 |                0.01 |          0.17 |  0.2% |

### 7.3 Outside the battery tasks

Liveness-correction work requested during the battery (not part of T1 to T4, excluded from the totals above):

| Transcript              | Work                | Role     | API calls | Tool calls | Output tokens | Active time (h) | Estimated USD |
| ----------------------- | ------------------- | -------- | --------: | ---------: | ------------: | --------------: | ------------: |
| `liveness-fix-exec`     | Liveness correction | Executor |        42 |         38 |        15,578 |            0.28 |          2.80 |
| `liveness-fix-reviewer` | Liveness correction | Reviewer |        38 |         36 |        10,292 |            0.38 |          1.40 |

Reading: 63% of the estimated cost is code exploration, tests and repository state queries; the longest
single agent is the one that carried T4 and T1 through harness, dispatch diagnosis, evidence and commits.
