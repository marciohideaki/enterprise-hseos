# Structural Execution Governance

## Purpose

Apply deterministic, fail-closed governance before runtime mutation or mission claim proceeds.

## When To Use

Use this capability when:

- validating execution policy packs
- explaining why a runtime request is allowed or denied
- governing mission claims and retries
- constraining tool, module, path, and mission metadata selection

## Use Cases

- deny a critical mission with missing owner or deadline
- restrict mission labels, dependencies, or retry classes to an approved envelope
- validate a policy pack before rollout
- inspect why a request was denied without relying on prompt behavior

## Commands

```bash
hseos policy validate .enterprise/policies/execution/foundation.policy.yaml
hseos policy explain .enterprise/policies/execution/foundation.policy.yaml
hseos policy explain --project-dir /path/to/project --request-file /path/to/request.yaml
```

## Example Request Shape

```yaml
actionType: work-item
directory: /workspace/project
mission:
  type: remediation
  priority: critical
  owner: platform-ops
  deadlineAt: 2026-03-31T12:00:00Z
  labels:
    - runtime
  dependencies:
    - policy-baseline
  retryClass: transient
```

## Limits

- governance is deterministic and local-first
- policy does not create approvals; it only evaluates requests
- current policy model does not provide a graphical authoring surface

## Troubleshooting

- if `validate` fails, inspect YAML structure and required policy fields first
- if a mission is denied, run `policy explain` against the pack or request to isolate the violated rule
- if claim and retry disagree, verify that runtime is passing the same mission metadata in both paths
