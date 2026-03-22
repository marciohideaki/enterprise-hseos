# Git Workflow Playbook (Enterprise)
**Scope:** All repositories and contributors (human or AI)  
**Status:** Mandatory  
**Version:** 1.0  

---

## 1. Purpose
This playbook defines the **mandatory Git workflow standards** for Enterprise projects.

The repository is:
- A **source of truth**
- A **technical showcase**
- A **long-term asset**

Poor Git hygiene is considered an engineering failure.

---

## 2. Repository as a Showcase
Every repository MUST:

- Tell a clear technical story
- Be understandable by external reviewers
- Reflect engineering maturity
- Avoid experimental or incomplete artifacts in main branches

The repository is a **vitrine**, not a scratchpad.

---

## 3. Branching Strategy
All projects MUST follow **GitFlow**.

### Mandatory branches:
- `main` → production-ready, stable, releasable
- `develop` → integration branch

### Supporting branches:
- `feature/<ticket-or-short-name>`
- `hotfix/<issue>`
- `release/<version>`

Direct commits to `main` or `develop` are forbidden.

### Active repository model

Per [ADR-0007](../.specs/decisions/ADR-0007-integration-governance-branching-model.md):

- `master` is the currently stable branch in this repository
- `develop` is the active integration branch
- all new `feature/*` work for staged delivery MUST start from `develop`

If repository defaults lag behind this model, governance still follows the ADR and not UI defaults.

---

## 4. Feature & Story Completion Rule
Every **feature or story MUST be committed at 100% completeness**.

This means:
- Code complete
- Tests included (when applicable)
- Documentation updated
- ADRs created (if required)

Partial or “WIP” features MUST NOT be merged.

---

## 5. Commit Standards

### 5.1 Commit Atomicity
Each commit MUST:
- Represent a logical, self-contained change
- Be buildable and testable
- Not break the repository state

---

### 5.2 Commit Messages
Commits MUST be:
- Clear
- Descriptive
- Written in imperative form

Example:
Add order validation to checkout flow

“fix”, “wip”, “temp”, “test” commits are forbidden in shared branches.

---

## 6. Pull Request Rules
All changes MUST go through Pull Requests.

Each PR MUST include:
- Clear description of intent
- Scope of change
- Related issues or stories
- ADR references (if applicable)

PRs that lack context MUST be rejected.

---

## 7. Story Traceability
Every PR SHOULD be traceable to:
- A story
- A task
- A requirement
- Or an ADR

Anonymous changes are forbidden.

---

## 8. Merge Rules
PRs may be merged ONLY if:

- CI/CD passes
- Governance checks pass
- No unresolved comments exist
- Branch is up-to-date with `develop` or `main`

---

## 9. History Hygiene
History MUST remain clean:

- Squash merges are allowed and encouraged
- Rewriting shared branch history is forbidden
- Accidental commits MUST be reverted properly

---

## 10. Forbidden Practices
The following are forbidden:

- Committing broken code
- Committing unfinished features
- Using the repository as backup storage
- Bypassing PRs
- “I’ll fix later” merges

---

## 11. Agent-Specific Rules
AI Agents MUST:

- Follow the same Git rules as humans
- Never push directly to protected branches
- Never create noisy commit histories
- Produce PR-ready outputs only

---

## 12. Enforcement
Violations MAY result in:
- PR rejection
- CI/CD failure
- Mandatory rework

Governance over speed. Always.

---

**End of Playbook**
