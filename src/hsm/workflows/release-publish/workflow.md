# Release Publish

## Intent
Turn validated source into immutable release artifacts.

## Owner
FORGE

## Phases
1. Source freeze and SHA capture
2. CI workflow detection
3. Artifact build or CI publish
4. Registry verification
5. Evidence recording for downstream deployment

## Required Evidence
- source commit SHA
- pipeline URL or local build record
- image tag or artifact digest
- verification proof that the artifact exists in the target registry

## Gate
Hard-fail if publication evidence cannot be produced.
