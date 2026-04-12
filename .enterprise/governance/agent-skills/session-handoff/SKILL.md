---
name: session-handoff
tier: full
version: "1.0"
description: "Use when ending a work session and a future agent or session must resume the same task without losing context"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
  inspired-by: superpowers/skills/handoff, claude-code-tips/skills/handoff
---

# Session Handoff — Full Protocol

> Tier 2: complete protocol for session continuity, multi-agent handoffs, and context transfer.

---

## Context

AI-assisted development sessions frequently end mid-task. Without a structured handoff, the next agent or session must re-discover context, re-read the same files, and often repeat failed attempts.

This skill ensures every session leaves a traceable artifact — `HANDOFF.md` — that enables the next agent to resume at full speed without history loss.

**Relationship to Second Brain:** Second Brain (`/end-session`) captures vault-level knowledge (ADRs, gotchas, learnings). HANDOFF.md captures session-level state (in-progress work, what to do next). They complement each other — use both.

---

## When to Use

- Before ending any session that left a task incomplete
- Before switching agents mid-epic (ORBIT dispatching sub-tasks to GHOST, then resuming later)
- Before context compaction on a long task
- Whenever the next action requires context that isn't in the codebase itself

---

## Full Workflow

### Step 1 — Check Existing HANDOFF.md
```bash
ls HANDOFF.md 2>/dev/null && cat HANDOFF.md || echo "No existing handoff"
```
If it exists, read it. Append to it — never overwrite without reading.

### Step 2 — Gather Session State
Collect:
- Files changed in this session: `git diff --name-only`
- Current branch: `git branch --show-current`
- Uncommitted work: `git status`
- Last commit: `git log -1 --oneline`
- Open tasks from TodoWrite or task list if applicable

### Step 3 — Write HANDOFF.md

Use the template below. Be specific — no vague entries.

```markdown
# HANDOFF — <feature or task name>
**Date:** YYYY-MM-DD HH:MM
**Branch:** <branch name>
**Agent:** <agent code, e.g. GHOST>
**Session type:** feature | fix | chore | spike

## Goal
<one sentence — the specific outcome this session was working towards>

## Current Progress

### Completed
- [x] <item> — `<file path if relevant>`
- [x] <item>

### In Progress (pick up here)
- [ ] <item> — `<file path>` — <specific next action>

### Not Started
- [ ] <item>

## What Worked
- **<approach>:** <why it worked, what to replicate>

## What Didn't Work (Do NOT Retry)
- **<approach>:** <why it failed, what to avoid>
- **<approach>:** <why it failed, what to avoid>

## Key Decisions Made This Session
- <decision> — rationale: <why>
- If an ADR was required: see `.enterprise/.specs/decisions/<ADR-XXXX>.md`

## Open Questions / Blockers
- [ ] <question that requires human decision>
- [ ] <blocker waiting on external dependency>

## Next Steps (ordered)
1. `<exact file>` — <exact action>
2. `<exact file>` — <exact action>
3. Run: `<exact command>`

## Context That Won't Be Obvious From Code
- <gotcha, assumption, or non-obvious constraint the next agent must know>
```

### Step 4 — Gitignore Check
```bash
grep -q "HANDOFF.md" .gitignore || echo "HANDOFF.md" >> .gitignore
```
HANDOFF.md is session state, not permanent artifact — it must not be committed.

### Step 4b — SESSION-CHECKPOINT (for sessions that will resume later)

If the next session will resume this exact task (not a new task), write a `SESSION-CHECKPOINT.md` in addition to `HANDOFF.md`. The checkpoint replaces re-reading the full BUILD-LOG or spec on resume.

```markdown
# SESSION-CHECKPOINT — <feature or task name>
**Date:** YYYY-MM-DD HH:MM
**Branch:** <branch>
**Status at checkpoint:** <one-line summary of where we stopped>

## What Was Decided This Session
- <decision 1> — rationale: <why>
- <decision 2> — rationale: <why>

## What Is Open (Not Yet Done)
- [ ] <item> — <file> — <exact next action>
- [ ] <item>

## What To Skip (Already Done, Don't Re-Do)
- <item> — completed at: <file or commit>

## Exact Resume Prompt
> "<paste this prompt verbatim to resume at full speed>"
>
> Example: "Resume task KG-5: implement Redis lock in `pkg/lock/distributed.go`. Brief is at `.enterprise/.specs/...`. Self-review gate required before handoff to GLITCH."
```

`SESSION-CHECKPOINT.md` is also gitignored session state.

```bash
grep -q "SESSION-CHECKPOINT.md" .gitignore || echo "SESSION-CHECKPOINT.md" >> .gitignore
```

### Step 5 — Second Brain Sync (if session was productive)
Per `CLAUDE.md §8`, also write to vault:
- Architectural decisions → `_knowledge/projects/enterprise-hseos/decisions.md`
- Gotchas → `_knowledge/projects/enterprise-hseos/gotchas.md`
- Activity log → `_memory/activity-log.md`

---

## Multi-Agent Handoff Protocol

When ORBIT dispatches a sub-task to GHOST and needs a handoff:

```markdown
## Agent Handoff: ORBIT → GHOST
**Task:** <task ID and description>
**Input artifacts:** <list of files/specs the implementor needs>
**Acceptance criteria:** <exactly what DONE looks like>
**Constraints:** <what must not be changed>
**Known complications:** <what the previous agent discovered>
**Return to:** ORBIT (after GLITCH review)
```

---

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| "Context will be in the code" | Code doesn't explain why attempts failed |
| "I'll remember what I was doing" | New session = zero memory |
| Vague entries ("worked on auth") | Useless — next agent still has to re-discover |
| Not recording failed attempts | Next agent will retry the same failed approach |
| Committing HANDOFF.md | Pollutes git history with ephemeral state |

---

---

## Racionalizações Comuns

| Racionalização | Realidade |
|---|---|
| "O contexto vai estar no código" | Código não explica por que abordagens falharam, quais foram tentadas, ou quais decisões foram implicitamente tomadas. |
| "Vou lembrar onde parei" | Nova sessão = zero memória. Sem HANDOFF.md, o próximo agente re-descobre tudo do zero — às vezes repetindo os mesmos erros. |
| "A sessão foi curta, não precisa de handoff" | Sessões curtas frequentemente ficam no meio de uma mudança. "Curta" não é critério — "incompleta" é. |
| "Já está no commit history" | Commit history mostra o que foi feito, não o que ainda precisa ser feito, o que falhou, ou as decisões tomadas nesta sessão. |
| "Vou criar o HANDOFF depois" | Handoff deve ser criado antes de encerrar a sessão — depois significa que o contexto já foi perdido. |

---

## Sinais de Alerta (Red Flags)

- Sessão encerrada com tarefa incompleta e sem HANDOFF.md criado
- HANDOFF.md com entradas vagas: "trabalhei em auth", "continuar depois" sem especificar arquivo e ação exata
- Seção "What Didn't Work" vazia em uma sessão que teve tentativas fracassadas
- HANDOFF.md commitado no repositório (deve ser gitignored)
- Next Steps sem referência a arquivo específico ou comando exato
- Sessão anterior relevante existe mas o próximo agente não verificou HANDOFF.md antes de começar

---

## Verificação (Exit Criteria)

- [ ] HANDOFF.md criado em sessão incompleta com todas as seções obrigatórias preenchidas
- [ ] "In Progress" tem arquivo específico e próxima ação exata (não genérica)
- [ ] "What Didn't Work" registra todas as abordagens tentadas que falharam
- [ ] HANDOFF.md está no `.gitignore` (não commitado)
- [ ] SESSION-CHECKPOINT.md criado se a sessão vai ser retomada no mesmo task
- [ ] Second Brain atualizado via `CLAUDE.md §8` para decisões arquiteturais ou gotchas descobertos

---

## Relationship to Other Skills

- `second-brain` — permanent vault knowledge capture (complements this skill)
- `project-state` — session context via STATE.md/TASKS.md (more structured, for ORBIT)
- `context-policy` — context compression before creating handoff
