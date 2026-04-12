---
inclusion: manual
description: Active feature development context — invoke with #dev-mode when implementing a feature or story
---

# Dev Mode — Feature Development Context

> Invoke with `#dev-mode` when actively implementing a feature, story, or task.

## Active Development Protocol

1. **Spec First** — read the feature spec before writing any code
   - Spec location: `.enterprise/.specs/` or feature's own PRD
   - If no spec: create one using `spec-driven` skill before coding

2. **Task Isolation** — each task runs in its own worktree
   ```bash
   ./scripts/governance/worktree-manager.sh create <task-id> feature/<phase>
   ```

3. **Test Before Code** — write failing test first (where applicable)
   - Use `test-coverage` skill for coverage requirements
   - Minimum: test the primary success path before implementing

4. **Implement Incrementally** — small, testable increments
   - Commit after each working increment
   - Do not accumulate uncommitted changes across multiple features

5. **Verify Before Done** — load `verification-before-completion` skill before reporting complete

## Code Quality Standards

- Functions ≤ 50 lines
- Nesting depth ≤ 4 levels
- No mutation of external state (prefer immutable updates)
- Error handling at every I/O boundary
- Input validation at system boundaries only (not internal functions)

## Commit When
- Tests pass for the current increment
- Commit message passes hygiene check
- No debug code, console.log, or TODO without ticket reference left in
