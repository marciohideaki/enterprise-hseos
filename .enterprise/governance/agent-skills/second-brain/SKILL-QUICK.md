---
name: second-brain
tier: quick
version: "1.0"
---

# Second-Brain Integration — Quick Reference

> Tier 1: use when starting any task in a project where `second_brain.enabled = true`.
> Load SKILL.md (Tier 2) for vault write formats, safe append protocol, and relevance criteria.

---

## 1. Detection (run once per session, cache result)

```
1. Read hseos.config.yaml → second_brain.enabled
2. If enabled: verify file exists at second_brain.path/CLAUDE.md
3. If verified: second-brain AVAILABLE — cache path in working memory
4. If not:      second-brain UNAVAILABLE — skip all reads/writes silently
```

If unavailable, do NOT raise an error. Continue with existing HSEOS sources of truth.

---

## 2. Read Protocol — per agent

Read only what's relevant to your current task. Never load the full vault.

| Agent | Read from vault | When |
|---|---|---|
| ORBIT | `_memory/current-state.md`, `_knowledge/goals.md` | Before starting an epic |
| NYX | `_memory/current-state.md`, `_knowledge/projects.md` | Before discovery phase |
| VECTOR | `_knowledge/goals.md`, `_knowledge/about-me.md` | Before planning phase |
| CIPHER | All files in `_decisions/`, `_learnings/architecture-*.md` | Before solutioning phase |
| GHOST | `_learnings/` files matching current domain keyword | Before story implementation |
| RAZOR | `_knowledge/projects.md` | Sprint planning |
| QUILL | `_memory/current-state.md`, `_knowledge/projects.md` | Before documentation |
| BLITZ | `_memory/current-state.md`, `_knowledge/goals.md`, `_decisions/` | Solo session start |
| SABLE | `_learnings/` files matching ops/runtime keywords | Before runtime verification |

**Domain keyword matching for GHOST/SABLE:** Search `_learnings/` filenames for words matching current task domain (e.g. working on K8s deploy → look for `gitops`, `kube`, `deploy`, `infra` in filenames).

---

## 3. Write Protocol — ORBIT, CIPHER, QUILL only

All other agents: read only. Never write to the vault unless you are ORBIT, CIPHER, or QUILL.

| Agent | Writes | Trigger | Path in vault |
|---|---|---|---|
| ORBIT | Epic delivery decision | Epic Phase 10 complete, decision is strategically significant | `_decisions/hseos/YYYY-MM-DD-{kebab-name}.md` |
| CIPHER | Architecture decision | After ADR is approved by human | `_decisions/hseos/YYYY-MM-DD-{kebab-name}.md` |
| QUILL | Epic learning | Phase 10, new pattern or insight discovered during epic | `_learnings/hseos-{kebab-topic}.md` |

### Write rules (mandatory)

1. **Never overwrite** — always check if file exists before creating. If exists, append or create with suffix `-v2`
2. **Unique names** — `YYYY-MM-DD` prefix guarantees uniqueness for decisions; topic name for learnings
3. **Vault frontmatter required** — every written file must have YAML frontmatter (see SKILL.md §2)
4. **WikiLinks** — link to related existing vault notes using `[[file-name]]` format
5. **Strategic threshold** — only write decisions/learnings that would be valuable in a future session with no other context. Micro-decisions (implementation details) do NOT go to the vault

---

## 4. `_memory/current-state.md` — special rules

This file is the bridge between user sessions. HSEOS agents must treat it carefully:

- **Read freely** — any agent can read it at session start
- **Write only via `hseos brain sync`** — never write directly during an active agent session
- **Exception:** ORBIT may append a single `## HSEOS — {epic-id}` section at Phase 10 if `hseos brain sync` is not available

---

## 5. Fallback chain

```
second-brain available → read vault files → enrich task context
second-brain unavailable → use HSEOS sources only (Constitution, authority, SKILLS-REGISTRY)
```

Never block execution because second-brain is unavailable. It is always optional enrichment.
