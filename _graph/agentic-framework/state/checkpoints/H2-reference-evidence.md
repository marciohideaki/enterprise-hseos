# H2 — Reference completion requires a successful tool effect

Artifact type: Code execution contract and checkpoint.
Scope: hseos-governed-autonomous-engineering / harness-reference-evidence.
Governing documents: Enterprise Constitution; ADR-0024; automated-validation;
specification-consumption; capability-graph; AGENTS.md; hseos-goal-loop.
Mode: Loop. Status: in-progress.
Baseline: a8423081934d64538d71ef8289f072d51566a870.
Feature: feature/governed-autonomous-engineering. Independent task branch:
task/harness-reference-evidence. H1 is independently committed as 92dd027;
no task branch is chained and no merge is authorized.

## Frozen acceptance

A disposable reference run whose actual governed filesystem write fails must
persist session.failed with tool_failed, emit no success message and expose no
world_state artifact as a verified result. Preserve the failed tool outcome.
Successful reference runs continue to persist the requested state and pass existing
confinement, resume and cancellation tests. The general kernel may still let real
providers repair tool failures; this correction belongs to the scripted reference.
verify_step: test/test-agent-capability-cli.js, then full mandatory quality gate.
Negative fixture: replace the expected output file with a directory before resume;
this triggers a real filesystem error without mocking the provider or event store.
At most two failed correction attempts. No active controls or test thresholds change.
Rollback: discard isolated diff. No operational migration, provider call or activation.

## Reuse and evidence

Capability intake: extend runtime:agent-reference via its existing provider route,
ToolRuntime, ExecutionEventLedger and RelationalSessionEventStore. H1 intake searched
the versioned graph/corpus and found this public implementation in the catalog;
no new abstraction, package, capability owner or state authority is introduced.
Axon index unavailable; declared direct source inspection. Sources:
tools/cli/lib/reference-agent-runtime.js, temporary-state-tool.js, temporary-kernel-assembly.js;
packages/tool-runtime/tool-runtime.js; packages/agent-runtime/runtime.js.
Evidence is deterministic local filesystem/SQLite evidence, not real model eval.
DoD focus: DOD-20/23, with DOD-21 required before task completion. Whole mission DoD
and real 18-run campaign remain pending and unchanged.

## Regression and correction evidence

Baseline rejects the added check: requested failed, observed completed.
Correction 1 removes the fabricated completion. The new test then reached a deeper
assertion and showed that the existing governed execution contract records uncertain
with EXECUTION_OUTCOME_IN_DOUBT after provider exceptions. This is correct conservative
semantics for a started effect. The new assertion is corrected to require that exact
state/error, preserving the frozen requirement of no success claim and no blind retry.
No existing test or control is changed; the prior failed test output is retained.

## Verification

Focused suite: 9/9 passed. Full worktree-manager validation: exit 0, 0 failures,
1 existing documentation warning. Final no-retry assertion passed in the full suite.
Lint, schemas, security and governance checks passed; exact source/log digests are
in state/evidence/harness-reference-evidence/result.json. Ready for local task commit;
no merge, publication, real-provider execution or operational activation.
