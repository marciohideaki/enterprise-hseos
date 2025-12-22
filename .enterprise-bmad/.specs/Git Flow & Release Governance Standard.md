# Git Flow & Release Governance Standard

**Version:** 1.0

## 1. Purpose
Defines the mandatory Git workflow, branching strategy, commit rules, tagging and release governance.

## 2. Branching Model (Git Flow – Adapted)

### Permanent Branches
- `main`: production-ready code
- `develop`: integration branch

### Temporary Branches
- `feature/<ticket>-<short-name>`
- `hotfix/<ticket>-<short-name>`
- `release/<version>` (optional, for stabilization)

### Rules
- No direct commits to `main` or `develop`
- All changes go through Pull Requests

## 3. Branch Strategy
- Branches are created **per feature/story**, never per epic
- Epics are planning constructs only

## 4. Commit Rules
- Conventional Commits are mandatory
- Commits must be small, atomic and compilable
- Commits must not reference AI, automation or agents

### Forbidden Terms (regex enforced)
```
(?i)\b(ai|ia|gpt|chatgpt|claude|copilot|bmad|automation|automated|agent|llm)\b
```

## 5. Pull Requests
- PRs must target `develop`
- Tests must pass
- PR Checklist must be completed
- ADR required for architectural deviations

## 6. Tags & Releases
- Tags are created **only for releases**
- Semantic Versioning is mandatory: `vMAJOR.MINOR.PATCH`
- Tags are created automatically by CI

## 7. CI/CD Gates
- Build success
- Tests passing
- Linting and formatting
- Commit message validation

## Summary
Git is treated as part of the architecture and governance model.