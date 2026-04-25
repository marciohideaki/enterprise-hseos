# Contributing to HSEOS

> **Governance-first contributions.** Every change flows through a branch, passes quality gates, and is reviewed by a human before merge. AI agents execute — humans decide.

---

## Prerequisites

- Node.js ≥ 18
- Git configured with your identity (`git config user.name` and `git config user.email`)
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- HSEOS installed in your local checkout (`npx hseos install`)

---

## Branch workflow

```
master (protected)
  └─ feat/<scope>           Feature branches
  └─ fix/<scope>            Bug fixes
  └─ docs/<scope>           Documentation only
  └─ chore/<scope>          Tooling, deps, CI
  └─ refactor/<scope>       Refactoring without behavior change
```

**Rules (enforced by git hooks):**
- No direct commits to `master`
- No force push to protected branches
- Every PR requires at least one human approval

---

## Commit format

HSEOS enforces [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**Allowed types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`

**Rejected patterns:**
- `Co-authored-by: Claude` or any AI tool attribution
- HSEOS methodology terms (`FR-`, `NFR-`, `Story:`, `Epic:`) in commit bodies
- Vague descriptions (`fix stuff`, `update`, `wip`)

---

## Quality gates (pre-commit)

Every commit automatically runs:

| Gate | What it checks |
|------|---------------|
| Branch guard | Blocks commits directly to master |
| Lint | Project linter (stack-specific) |
| Agent schema | Validates `.hseos/agents/*.yaml` and `.enterprise/` YAML files |
| Installation tests | Verifies framework integrity (18 checks) |
| Security scan | Detects hardcoded secrets and credentials |
| Commit hygiene | Format, attribution, and methodology-term checks |

Run manually at any time:

```bash
VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh
```

If a gate fails, fix the issue and re-commit. **Never use `--no-verify`.**

---

## Pull request process

1. Create a branch from `master`
2. Make your changes, commit with conventional commits
3. Run quality gates and confirm all pass
4. Open a PR using the template at `.github/pull_request_template.md`
5. Fill every section — validation results table is mandatory
6. Request review from a human maintainer
7. **AI agents must not merge PRs** — human approval required

---

## Adding or modifying skills

Skills live in `.enterprise/governance/agent-skills/`. Each skill has:

```
<skill-name>/
  SKILL.md          # Full algorithm with edge cases
  SKILL-QUICK.md    # Fast checklist (Tier 1)
```

After adding a skill, register it in `.enterprise/governance/agent-skills/SKILLS-REGISTRY.md` with trigger conditions.

See `.enterprise/governance/skills-adoption-guide.md` for the full adoption process.

---

## Adding or modifying agents

Agent definitions live in `.hseos/agents/`. Schema validation runs on every commit — use the existing agent files as reference.

If your change introduces a new architectural boundary or authority delegation, an ADR is required. See `.enterprise/.specs/constitution/Enterprise-Constitution.md`.

---

## Documentation

- English docs: `docs/` (primary, always required)
- Portuguese docs: `docs/pt-br/` (translation, keep in sync)
- Agent profiles: `docs/agents/<name>.md`

When modifying a doc in `docs/`, update the corresponding `docs/pt-br/` file in the same PR if the change is substantive.

---

## Governance documents

| Document | Purpose |
|----------|---------|
| `.enterprise/.specs/constitution/Enterprise-Constitution.md` | Non-negotiable rules |
| `.enterprise/policies/automated-validation.md` | Quality gate policy |
| `scripts/governance/quality-gates.sh` | Gate runner |
| `.github/pull_request_template.md` | PR checklist |

---

## Getting help

Open an issue or start a discussion in the repository. For governance questions, reference the constitution — it is the authoritative source.
