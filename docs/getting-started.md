# Getting Started

> Day 1 guide for engineers joining a project that uses HSEOS.

---

## Prerequisites

- Node.js ≥ 18
- Git configured with your identity
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)
- Access to the project repository

---

## Step 1 — Install HSEOS in your project

From the root of your project:

```bash
npx hseos install
```

This sets up:
- `.claude/commands/` — all 14 agent commands (activated as Claude Code slash commands)
- `.enterprise/` — governance specs, agent authority files, skill library
- `.hseos/` — agent configurations, workflow definitions, local config
- Git hooks — pre-commit quality gates (lint, schema validation, commit hygiene)

### Select which AI tools to set up

By default, `hseos install` configures Claude Code and Cursor. To customize:

```bash
npx hseos install --tools claude-code,codex,gemini
npx hseos install --tools claude-code          # Claude Code only
npx hseos install --tools none                 # skip IDE setup, governance files only
```

Supported tools: `claude-code`, `cursor`, `windsurf`, `gemini`, `codex`, `antigravity`, `github-copilot`, `cline`, and more.

---

## Step 2 — Read the governance foundation

After install, read these in order:

1. **`CLAUDE.md`** — Seven Laws and agent roster (5 min)
2. **`.enterprise/.specs/constitution/Enterprise-Constitution.md`** — Non-negotiable rules (10 min)
3. **`docs/agents/`** — Browse the agents relevant to your role (see role guide below)

> You do not need to read all `.specs/` on day 1. Read the stack-specific standards (`.enterprise/.specs/stack/<your-stack>/`) when you start working in that area.

---

## Step 3 — Understand your role context

### If you are a feature engineer (day-to-day delivery)

The agents you'll interact with most:

| Agent | When you use it |
|---|---|
| **RAZOR** | Starting a sprint — story preparation and sprint planning |
| **GHOST** | Implementing a story — TDD execution |
| **GLITCH** | Validating coverage and quality before PR |
| **QUILL** | Writing or updating documentation |

Typical daily flow:
```
RAZOR (prepare story) → GHOST (implement) → GLITCH (validate) → QUILL (document) → PR
```

### If you are a tech lead or architect

| Agent | When you use it |
|---|---|
| **NYX** | Research, domain analysis, requirements elicitation |
| **VECTOR** | PRD and epic authoring |
| **CIPHER** | Architecture design, ADR drafting, boundary checks |
| **ORBIT** | Kicking off an orchestrated epic delivery |
| **SWARM** | Shipping a heterogeneous batch (3+ independent tasks) in parallel waves with worktree isolation |

### If you are a platform/DevOps engineer

| Agent | When you use it |
|---|---|
| **FORGE** | Publishing release artifacts, build promotion |
| **KUBE** | GitOps manifest updates, ArgoCD deploys |
| **SABLE** | Runtime verification post-deploy, smoke tests |

---

## Step 4 — Configure your deployment profile (if working with Kubernetes)

If your project deploys to Kubernetes, check whether `.hseos/config/kube-profile.yaml` exists:

```bash
cat .hseos/config/kube-profile.yaml
```

If absent, KUBE will auto-detect the GitOps model from your repo structure. See [agents/kube.md](agents/kube.md) for details.

---

## Step 5 — Run your first agent

Open Claude Code in your project and try:

```
/razor
```

Type `SP` for Sprint Planning. RAZOR will walk you through the sprint readiness checklist.

---

## Git workflow rules

HSEOS enforces these automatically via git hooks:

| Rule | What it means |
|---|---|
| No direct commits to `main`/`master` | Always work on a feature branch |
| No force push to protected branches | Use PRs |
| No AI tool attribution in commit messages | `Co-authored-by: Claude` will be rejected |
| Conventional commit format required | `feat:`, `fix:`, `chore:`, `docs:`, etc. |

If a commit is rejected, read the error message — it will tell you exactly which rule was violated and how to fix it.

---

## Quality gates (pre-commit)

Every commit triggers:

1. **Branch guard** — blocks commits directly to main/master
2. **Lint** — project linter (stack-specific)
3. **Agent schema tests** — validates agent YAML files
4. **Installation tests** — verifies framework integrity
5. **Security scan** — detects hardcoded secrets
6. **Commit hygiene** — format and attribution checks

If a gate fails, the commit is rejected with the specific failure message. Fix the issue and re-commit — do not use `--no-verify`.

---

## Getting help

| Question | Where to look |
|---|---|
| What does agent X do? | `docs/agents/<name>.md` |
| How does workflow Y work? | `docs/workflows.md` |
| What does skill Z enforce? | `docs/skills.md` |
| What are the architecture rules? | `.enterprise/.specs/constitution/` |
| What decisions have been made? | `.enterprise/agents/<code>/authority.md` |
| How to add a new skill? | `.enterprise/governance/agent-skills/README.md` |
| How to adopt external patterns? | `.enterprise/governance/skills-adoption-guide.md` |
