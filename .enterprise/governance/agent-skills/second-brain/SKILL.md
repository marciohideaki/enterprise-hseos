---
name: second-brain
tier: full
version: "2.0"
---

# Second-Brain Integration — Full Reference

> Tier 2: vault write formats, safe append protocol, relevance criteria, `hseos brain sync` specification, domain keyword map.

---

## 1. Vault Overview

The second-brain is a personal knowledge vault at the path configured in `hseos.config.yaml → second_brain.path`. It is owned by the user and follows its own operating rules (`CLAUDE.md` inside the vault).

**2-Tier Architecture:**

```
Tier 1 — Project Registry:  _knowledge/projects/{nome}/   ← operational, project-local, low threshold
Tier 2 — Strategic Storage: _decisions/, _learnings/       ← cross-project, high threshold, human-approved
Operational Backbone:       _memory/activity-log.md        ← append-only, all vault operations
External Sources:           _sources/                      ← external sources ingested via /ingest
```

**Vault authority hierarchy (from vault's CLAUDE.md):**
1. `CLAUDE.md` — law of the vault; defines format, guardrails, conventions
2. `_memory/current-state.md` — live session bridge (written by `/end-session`, not only `hseos brain sync`)
3. `_decisions/` — architectural decision records (strategic, cross-project)
4. `_learnings/` — accumulated patterns and insights (strategic, cross-project)
5. `_knowledge/projects/{nome}/` — project registry (operational, project-local)
6. `_memory/activity-log.md` — append-only operation log

HSEOS never creates or modifies `CLAUDE.md`. The `_knowledge/projects/` files are jointly managed by the user (via `/end-session`) and HSEOS (for cross-project context enrichment).

---

## 2. Write Formats (vault-compatible)

### 2.3 Project Registry Format (`_knowledge/projects/{nome}/`)

Each project has 7 files. These are **operational** — low write threshold, no human approval required.

**work-log.md** — append one row per unit of work:
```
| YYYY-MM-DD | {tipo} | {descrição concisa de 1 linha} | {epic-id ou —} | concluído |
```
Work types: `epic` `feature` `story` `task` `fix` `chore` `spike` `session`

**decisions.md** (project-local ADRs) — append format:
```markdown
### {YYYY-MM-DD} — {Título da Decisão}
**Contexto:** Por que essa decisão foi necessária
**Decisão:** O que foi decidido
**Consequências:** Trade-offs e o que mudou
**Reversibilidade:** Fácil / Difícil / Irreversível
```

**gotchas.md** — append format:
```markdown
### {Título curto}
**Problema:** O que acontece se você não souber isso
**Solução/Contexto:** Como funciona de fato
```

**roadmap.md** — update in-place: `## Fase Atual`, `## Próximas Fases`, `## Backlog`

**README.md, modules.md, integrations.md** — update in-place when structure changes.

Note: Writes to `_knowledge/projects/{nome}/` do NOT require strategic threshold. They are operational records written by `/end-session` after any session that produced code, decisions, or learnings.

---

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

## 3. Protocol for `_memory/current-state.md`

This file is the user's session bridge. It is updated by two mechanisms that coexist:

- **`/end-session`** (primary): replaces the main sections with conversation context from the session. Written after any productive session, regardless of whether a formal HSEOS epic was active.
- **`hseos brain sync`** (complementary): appends an `## HSEOS — {epic-id}` block at the END. Written post-epic to add structured HSEOS artifacts.

**`/end-session` write format** (replaces sections, not appends):
```markdown
## Last Update: {data} ({tipo} — {projeto})

### What Was Done
{List of concrete actions — files created/edited, code implemented, decisions made}

### Decisions Made
{Decisions taken, with brief context — or "Nenhuma decisão estratégica nesta sessão."}

### Current Phase
{Current project — phase in progress}

### Next Steps
{Concrete next steps, ordered by priority}

### Open Questions
{Pending questions or decisions}
```

**`hseos brain sync` append format** (adds HSEOS block at END of file):
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

**Guards:**
- If file already has a `## HSEOS` block from today → skip (do not duplicate)
- HSEOS agents never write to `current-state.md` directly during active sessions — only `hseos brain sync` appends the HSEOS block
- The `/end-session` sections are the user's domain; HSEOS should not overwrite them

---

## 4. Strategic Threshold — When to Write vs. Skip

**Two distinct thresholds apply depending on the write target:**

### Tier 1 — Project Registry (`_knowledge/projects/{nome}/`) — LOW threshold
Write freely after any session that produced code, decisions, or learnings. No human approval required.
- work-log: every session
- gotchas: any non-obvious behavior discovered
- decisions: any architectural or design choice made
- roadmap: when phase advances

### Tier 2 — Strategic Storage (`_decisions/hseos/`, `_learnings/hseos-*`) — HIGH threshold
Write only if ALL are true:
1. The decision/learning would be valuable in a future session with NO other context
2. It affects more than one project OR establishes a cross-cutting pattern
3. It is NOT already documented in `_decisions/` or `_learnings/` (check before creating)
4. Human has approved the decision/learning (ADR signed off, epic accepted)

**Skip Tier 2 if:**
- Implementation detail specific to one story
- Temporary workaround or debug notes
- Information already in `enterprise-hseos` ADRs and learnable from the repo
- The insight is project-local (write to `_knowledge/projects/{nome}/decisions.md` instead)

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

**Relationship to `/end-session`:** These two mechanisms are complementary, not alternatives.
- `/end-session` = conversation context (what was discussed, decided, and learned in the session). User runs it manually after any session.
- `hseos brain sync` = structured HSEOS artifacts (ADRs, learnings, epic summaries). Run post-epic.

Both can and should coexist in `current-state.md`. `hseos brain sync` appends at the END without modifying the `/end-session` sections.

At Phase 10 completion, QUILL may prompt: "Run `/end-session` to capture the full conversation context in your vault, then run `hseos brain sync` to sync structured artifacts."

---

## 7. Relation to `/braindump` and `/end-session`

These are the user's personal vault commands. HSEOS does not replicate or replace them.

| Operation | Who runs it | What it captures | Writes to |
|---|---|---|---|
| `/end-session [project]` | User (manual) | Full conversation context, work classification, auto-registers project | work-log, gotchas, decisions, roadmap, current-state |
| `/braindump` | User (manual) | Real-time ideas, connections, session captures | `_sessions/`, `_learnings/` |
| `hseos brain sync` | HSEOS CLI (post-epic) | Structured HSEOS artifacts: ADRs, learnings, epic summary | `_decisions/hseos/`, `_learnings/`, current-state (HSEOS block) |

**`/end-session` full specification:**
- Accepts `$ARGUMENTS` with project name (e.g., `/end-session cryptor`) OR auto-detects from conversation context
- Classifies work type: `epic` | `feature` | `story` | `task` | `fix` | `chore` | `spike` | `session`
- **Auto-registers project**: if `_knowledge/projects/{nome}/` does not exist, reads project's `CLAUDE.md` and creates the 7-file structure automatically, updates `_index/MASTER-INDEX.md`
- Writes: work-log row, gotchas (if any), decisions (if any), roadmap update, current-state sections
- Checks for `hseos brain sync` opportunity (if `.hseos-output/` has unsynced epic artifacts)
- Appends to `_memory/activity-log.md`

**When to suggest to user:** At Phase 10 completion, QUILL prompts: "Run `/end-session {project}` to capture conversation context, then `hseos brain sync` for structured artifacts."

---

## 8. Activity Log (`_memory/activity-log.md`)

Append-only log of all vault operations. Every agent that writes to the vault must append to this log.

**Format:** `## [YYYY-MM-DD HH:MM] operação | descrição`

**Valid operations:**
| Operation | When |
|---|---|
| `session-start` | Beginning of a session |
| `session-end` | End of a session |
| `braindump` | `/braindump` command executed |
| `ingest` | `/ingest` command: source captured |
| `lint` | `/lint` command: audit complete |
| `heartbeat` | Automated daily health check |
| `compact` | Context compacted (PreCompact hook) |
| `decision` | Strategic decision written to `_decisions/` |
| `learning` | Learning written to `_learnings/` |
| `update` | Project registry updated |

**Rules:**
- Never edit existing entries — append only
- 90-day retention; older entries may be moved to `_sessions/`
- HSEOS agents writing to vault must append a `update | {description}` entry

---

## 9. External Sources (`_sources/`)

Directory for external content ingested via the `/ingest` command. Agents may read `_sources/` as supplementary context.

**File naming:** `_sources/{YYYY-MM-DD}-{slug}.md`

**Required frontmatter:**
```yaml
---
tags: [source, {domain}]
source_url: {url or "local"}
source_type: article | doc | spec | reference
author: {author or "unknown"}
ingested: YYYY-MM-DD
---
```

**When to read:** GHOST agents may scan `_sources/` for domain-relevant content before story implementation (filename keyword matching, same logic as `_learnings/`).

**Contradiction check:** `/ingest` command cross-references new sources against `_decisions/` for conflicts. HSEOS agents reading `_sources/` should apply the same check.

---

## 10. `/lint` Command

Audits the health of the knowledge graph. HSEOS agents should not run this — it is a user-invoked vault maintenance command.

**What it checks:**
- Index synchronism: MASTER-INDEX, PATTERN-MATRIX, FEATURE-CATALOG vs. actual files
- Frontmatter completeness on all notes
- Broken WikiLinks (`[[file]]` references to non-existent files)
- Orphan files (not referenced by any index)
- Stale notes (not updated in > 90 days, not archived)

**Output:** Writes `_memory/lint-latest.md` with findings; appends to activity log.

**When to suggest:** At Phase 10 completion, after significant vault writes (auto-registration, batch decisions), QUILL may suggest: "Run `/lint` to verify vault integrity after this session's writes."

---

## 11. Escalation

Stop and inform user when:
- `second_brain.path` is configured but `CLAUDE.md` not found (path may be wrong)
- A write would overwrite an existing vault file (never auto-overwrite)
- A decision conflicts with an existing vault ADR (flag the conflict explicitly)
- The vault `_memory/current-state.md` already has a newer HSEOS block than the current epic (state may be ahead — do not regress)
