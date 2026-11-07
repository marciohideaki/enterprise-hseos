---
name: legacy-code-review
tier: quick
version: '1.0.0'
description: 'Use when automating a risk-based review of a legacy-system PR, branch, commit range, or a related PR set'
---

# Legacy Code Review — Quick Check

Use for an automated review of a legacy-system diff. This is a risk classifier
and evidence generator; it never substitutes human approval.

## Before reviewing

- [ ] Resolve the exact base and head SHAs; do not review a stale PR revision.
- [ ] Collect the diff, changed tests, CI evidence and only the adjacent context
      needed to prove or refute a risk.
- [ ] Record absent constraints as `sem restrição específica`.
- [ ] Classify findings caused or materially worsened by the change; mark other
      findings `pre_existing: true` and non-blocking.

## Decision policy

- `BLOCK`: only critical/high findings with high confidence and concrete evidence.
- `HUMAN_REVIEW_REQUIRED`: critical/high with medium confidence, or a material
  requirement ambiguity.
- `PASS_WITH_COMMENTS`: actionable medium/low findings only.
- `PASS`: no actionable finding.

## Review focus

- Security and authorization boundaries; secrets; untrusted inputs; privileged CI.
- Correctness, data integrity, retries, concurrency and silent errors.
- Backward compatibility for APIs, schemas, events, configuration and persisted data.
- Deploy/rollback coexistence, migrations and merge order.
- Tests, observability and input-proportional performance.

## Publication rules

- Publish inline comments only when actionable, evidenced and not duplicated by a
  deterministic tool; cap comments at 12 (Policy section of `SKILL.md`).
- Do not publish low-confidence hypotheses as defects or style-only preferences.
- For multiple PRs, review each independently before reviewing interactions.

Load `SKILL.md` for the full workflow, the policy, the input and output contracts and the prompts.
