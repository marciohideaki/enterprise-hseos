# Live battery evidence

Receipts of the tasks of the live battery (a model dispatched through a governed
provider campaign, applied through the managed-project route and judged by a
protected verifier). One folder per task (`t1` to `t4`).

Each folder holds:

- `receipt.json`: format `hseos-live-battery-receipt/v1`. It lists the dispatch
  attempts (campaign, command, tokens, result, cause of a failure), the real work
  done, the capabilities used with the system record that backs each claim, the
  cost, the pins of the protected verifier and tests, the gates, what the receipt
  does not prove and the product findings.
- `dispatch-<n>/`: copies of the run outputs: `ledger-rows.json` (campaign
  rows), `campaign-report.json`, `result.json` (step results of the harness),
  gzipped verifier and coverage logs and the patch the model produced.
- `prompt.txt`: the exact prompt sent to the model.

Reading rules:

- `recorded_by: system` only where the record belongs to the campaign ledger or to
  the protected verifier. A value returned by the harness script and not retained
  as a ledger event is `agent_claim_only`.
- `NOT_EXERCISED` is a capability the task did not touch, with the reason.
- A prescriptive prompt proves the governed route, not the model's design ability.
- Subscription receipts carry `cost_microusd: null`; `committed_microusd: 0` is not
  a measured cost.
- Redaction: `owner` and `provider_session_id` are replaced by `<redacted>`.
- Request allowance: a task can open more than one campaign. Record the sum of
  authorised requests, the task ceiling from the owner decision and the real
  consumption (T2: 3 authorised across two campaigns, ceiling 2, consumed 2).
- `known_findings_not_fixed` lists review findings that were accepted without a
  fix, with their locations.

## Index

| Task | Receipt           | Dispatches                                                                                         | Battery requests after the task |
| ---- | ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| T2   | `t2/receipt.json` | 2 campaigns, 2 requests (attempt 1 FAIL by harness, attempt 2 PASS)                                | 2 of 12                         |
| T3   | `t3/receipt.json` | 1 campaign, 1 of 3 authorised requests (PASS)                                                      | 3 of 12                         |
| T4   | `t4/receipt.json` | 1 campaign, 1 of 2 authorised requests (PASS)                                                      | 4 of 12                         |
| T1   | `t1/receipt.json` | 5 campaigns, 5 of 5 authorised requests (4 without receipt, causes in the receipt; attempt 5 PASS) | 9 of 12                         |
