# Delivery Readiness

## Intent
Validate whether a repository is prepared to enter an HSEOS delivery workflow.

## Owner
ORBIT

## When To Use
- before starting epic delivery in a new repository
- before resuming a partially executed run
- before enabling release or runtime phases in a system that only had core delivery

## Output
- readiness report grouped by `required`, `recommended`, and `optional`
- predecessor workflow guidance when artifacts are missing
- suggested next action for each failed check

## Validation Rules
1. Check governance baseline first.
2. Check planning and implementation artifacts second.
3. Check toolchain third.
4. Only recommend execution when all required checks pass for the selected profile.

## Profiles
- `core`: governance, planning, implementation, local quality
- `release`: publication and registry prerequisites
- `runtime`: GitOps, cluster access, smoke/regression assets
- `full`: all of the above

## Clean Stop Conditions
- target repository path does not exist
- workflow ID is unknown

## Hard Fail Conditions
- selected profile has unmet required prerequisites

## Recommended Invocation
`hseos workflow validate delivery-readiness --repo <target-repo> --profile <core|release|runtime|full>`
