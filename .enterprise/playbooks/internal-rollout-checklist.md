# Internal Rollout Checklist

## Purpose

This playbook defines the minimum checklist to adopt the stable HSEOS runtime baseline internally without opening new architectural scope.

## When To Use

Use this playbook when:

- preparing the first internal teams to use the stable baseline on `develop`
- validating rollout readiness after a consolidation wave
- deciding whether the baseline may move from rehearsal to broader internal use

## Scope Of This Rollout

The current internal rollout covers:

- structural execution governance through `hseos policy`
- mission execution runtime through `hseos run`
- governed retry, including `hseos run retry-ready`
- execution observability through `hseos ops`
- CORTEX context recall and impact through `hseos cortex`

It does not assume:

- a graphical control plane
- autonomous retry scheduling
- semantic or vector-backed memory infrastructure

## Checklist

### Baseline Integrity

- [ ] `develop` is aligned with `origin/develop`
- [ ] `npm test --silent` passes
- [ ] `VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh --phase code` passes for runtime changes
- [ ] `VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh --phase doc` passes for rollout or governance doc changes
- [ ] ADRs and playbooks describe the implemented baseline without drift

### Runtime Governance

- [ ] execution policy packs validate successfully through `hseos policy validate`
- [ ] mission-aware governance covers the mission metadata required by the adopting team
- [ ] blocker approval flow is understood by operators before runtime use
- [ ] fail-closed behavior has been demonstrated on at least one denied runtime path

### Operational Readiness

- [ ] operators can read `hseos ops summary`, `posture`, `blockers`, and `approvals`
- [ ] runtime evidence is being produced and retained under `.hseos/data/runtime/evidence`
- [ ] retryable invalidations and approval-gated blockers can be explained operationally
- [ ] rollback expectation is documented for the adopting team

### Context Readiness

- [ ] CORTEX retrieval works on the target project scope
- [ ] mission claims persist `context.json` and retrieval trace correctly
- [ ] impact output is usable for the target codebase and not polluted by generated artifacts

### Adoption Control

- [ ] rollout owner is identified
- [ ] initial internal consumers are named explicitly
- [ ] adoption is limited to controlled internal use until a broader rollout decision is made
- [ ] open gaps are recorded as hardening work, not silently accepted drift

## Exit Criteria

The baseline may be treated as ready for controlled internal rollout when:

1. all checklist items above are complete or explicitly waived
2. any waiver is documented in a decision or release note
3. no blocking gaps remain in runtime governance, operational posture, or evidence generation

## Recommended Sequence

1. validate the baseline on `develop`
2. confirm policy packs and runtime evidence behavior
3. rehearse approval and retry handling with operators
4. enable the baseline for the first internal consumer group
5. collect hardening feedback before expanding adoption
