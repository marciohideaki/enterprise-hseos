---
name: second-brain
tier: full
version: "1.0"
---

# Second-Brain Integration — Full Reference

> Tier 2: vault write formats, safe append protocol, relevance criteria, `hseos brain sync` specification, domain keyword map.

---

## 1. Vault Overview

The second-brain is a personal knowledge vault at the path configured in `hseos.config.yaml → second_brain.path`. It is owned by the user and follows its own operating rules (`CLAUDE.md` inside the vault). HSEOS treats it as read-mostly, with controlled writes for decisions and learnings that have cross-project strategic value.

**Vault authority hierarchy (from vault's CLAUDE.md):**
1. `CLAUDE.md` — law of the vault; defines format, guardrails, conventions
2. `_memory/current-state.md` — live session bridge
3. `_decisions/` — architectural decision records
4. `_learnings/` — accumulated patterns and insights
5. `_knowledge/` — identity, goals, projects

HSEOS never creates or modifies `CLAUDE.md` or `_knowledge/` files. Those are the user's domain.

---

## 2. Write Formats (vault-compatible)

### 2.1 Decision format (`_decisions/hseos/YYYY-MM-DD-{name}.md`)

```markdown
---
tags: [decision, hseos, {domain-tag}]
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# {Decision Title}

**Fonte:** `{project}/{epic-id}` — gerado por HSEOS {ORBIT|CIPHER}
**Aplicação:** {scope — project name, all projects, specific module}

---

## Contexto

{Why this decision was needed. What problem or constraint triggered it.}

## Decisão

{The actual decision in 1-2 sentences. Be direct.}

## Raciocínio

{Why this approach over alternatives. Data or evidence if available.}

## Consequências

{What changes because of this decision. What constraints it creates.}

## Trade-offs

{What we gave up. What risks we accepted.}

## Reversibilidade

{Alta / Média / Baixa — and why.}

---

## Related

- [[{related-vault-note}]] — {why related}
```

**Domain tags:** `architecture`, `security`, `devops`, `delivery`, `governance`, `ai-sdlc`, `performance`, `data`

### 2.2 Learning format (`_learnings/hseos-{topic}.md`)

```markdown
---
tags: [learning, hseos, {domain-tag}]
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# {Learning Title}

**Fonte:** `{project}/{epic-id}` — registrado por HSEOS QUILL
**Contexto:** {Short description of when/where this was learned}

---

## O que aprendemos

{The core insight. Be specific — vague learnings are useless.}

## Por que importa

{The consequence of NOT knowing this. Why it's worth recording.}

## Como aplicar

{Concrete steps or checklist for applying this in future work.}

## Impacto

{What changed in how we work because of this learning.}

---

## Related

- [[{related-vault-note}]] — {why related}
```

---

## 3. Safe Append Protocol for `_memory/current-state.md`

This file is the user's session bridge. HSEOS must not disrupt its structure.

**Allowed operations:**
- Read anytime
- Append a delimited HSEOS block at the END of the file (never in the middle)

**Append format:**
```markdown
---

## HSEOS — {epic-id} ({date})

**Épico:** {epic-name}
**Fase concluída:** Phase {N} — {phase-name}
**Agente:** {AGENT-CODE}
**Resultado:** {1-2 sentence summary of what was delivered}
**Próximos passos HSEOS:** {1-3 items}
**Artefatos:** {list of key files created/modified}
```

**Guard:** If the file already has a `## HSEOS` block from today → skip (do not duplicate).

---

## 4. Strategic Threshold — When to Write vs. Skip

Write to vault only if ALL are true:
1. The decision/learning would be valuable to reference in a future session with NO other context
2. It affects more than one project OR establishes a cross-cutting pattern
3. It is NOT already documented in `_decisions/` or `_learnings/` (check before creating)
4. Human has approved the decision/learning (ADR signed off, epic accepted)

**Skip the vault if:**
- Implementation detail specific to one story
- Temporary workaround
- Debug notes or investigation logs
- Information already in `enterprise-hseos` ADRs and learnable from the repo

---

## 5. Domain Keyword Map — `_learnings/` relevance by domain

Use this to select which learnings to read for a given task:

| Task domain | `_learnings/` keywords to match |
|---|---|
| Architecture / DDD | `architecture`, `canonical`, `hexagonal`, `ddd` |
| AI-SDLC / agents | `ai-sdlc`, `hseos`, `agent-skills`, `context-management` |
| Event-driven / messaging | `event-driven`, `event-sourcing` |
| API design | `api-design` |
| Testing | `testing-strategy` |
| Shared infrastructure | `shared-bases` |
| Context management | `context-management` |
| Governance | `hseos-seven-laws`, `constitution` |

Read at most 2-3 files per task. More is context waste.

---

## 6. `hseos brain sync` — What It Does

The CLI command `hseos brain sync` runs at the end of an epic delivery (after Phase 10). It:

1. Scans `.hseos-output/{epic-id}/` for HSEOS-generated ADRs and decision notes
2. Converts them to vault ADR format and writes to `_decisions/hseos/`
3. Scans `.hseos-output/{epic-id}/` for QUILL-generated learnings
4. Converts to vault learning format and writes to `_learnings/`
5. Appends an HSEOS block to `_memory/current-state.md`

This is the **only sanctioned write path for current-state.md**. Agents never write to it directly during active sessions.

---

## 7. Relation to `/braindump` and `/end-session`

These are the user's personal vault commands. HSEOS does not replicate or replace them.

| Operation | Who runs it | What it captures |
|---|---|---|
| `/end-session` | User (manual) | Full conversation context, personal insights, free-form decisions |
| `/braindump` | User (manual) | Real-time ideas, connections, session captures |
| `hseos brain sync` | HSEOS CLI (post-epic) | Structured HSEOS artifacts: ADRs, learnings, epic summary |

**When to suggest to user:** At Phase 10 completion, QUILL may prompt: "Run `/end-session` to capture the full conversation context in your vault."

---

## 8. Escalation

Stop and inform user when:
- `second_brain.path` is configured but `CLAUDE.md` not found (path may be wrong)
- A write would overwrite an existing vault file (never auto-overwrite)
- A decision conflicts with an existing vault ADR (flag the conflict explicitly)
- The vault `_memory/current-state.md` already has a newer HSEOS block than the current epic (state may be ahead — do not regress)
