---
name: second-brain
tier: quick
version: "2.0"
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
| NYX | `_memory/current-state.md`, `_knowledge/projects/{projeto}/README.md` | Before discovery phase |
| VECTOR | `_knowledge/goals.md`, `_knowledge/about-me.md` | Before planning phase |
| CIPHER | All files in `_decisions/`, `_learnings/architecture-*.md`, `_knowledge/projects/{projeto}/decisions.md` | Before solutioning phase |
| GHOST | `_learnings/` files matching domain keyword, `_knowledge/projects/{projeto}/gotchas.md`, `_sources/` matching domain | Before story implementation |
| RAZOR | `_knowledge/projects/{projeto}/roadmap.md`, `_knowledge/projects/{projeto}/work-log.md` | Sprint planning |
| QUILL | `_memory/current-state.md`, `_knowledge/projects/{projeto}/README.md` | Before documentation |
| BLITZ | `_memory/current-state.md`, `_knowledge/goals.md`, `_decisions/`, `_knowledge/projects/{projeto}/work-log.md` | Solo session start |
| SABLE | `_learnings/` files matching ops/runtime keywords | Before runtime verification |

**Domain keyword matching for GHOST/SABLE:** Search `_learnings/` filenames for words matching current task domain (e.g. working on K8s deploy → look for `gitops`, `kube`, `deploy`, `infra` in filenames).

---

## 3. Write Protocol — Two Tiers

### Tier 2 — Strategic Storage (ORBIT, CIPHER, QUILL only)

| Agent | Writes | Trigger | Path in vault |
|---|---|---|---|
| ORBIT | Epic delivery decision | Epic Phase 10 complete, strategically significant | `_decisions/hseos/YYYY-MM-DD-{kebab-name}.md` |
| CIPHER | Architecture decision | After ADR is approved by human | `_decisions/hseos/YYYY-MM-DD-{kebab-name}.md` |
| QUILL | Epic learning | Phase 10, new pattern or insight discovered | `_learnings/hseos-{kebab-topic}.md` |

### Tier 1 — Project Registry (any agent, low threshold)

| Who | Writes | Trigger | Path in vault |
|---|---|---|---|
| Any agent | Project gotcha | Non-obvious behavior discovered | `_knowledge/projects/{nome}/gotchas.md` |
| Any agent | Activity log entry | Any vault write operation | `_memory/activity-log.md` |
| `/end-session` | Work-log row | Session end | `_knowledge/projects/{nome}/work-log.md` |
| `/end-session` | Project decisions | Architecture/design choice | `_knowledge/projects/{nome}/decisions.md` |

Tier 1 writes do NOT require human approval and are NOT subject to the strategic threshold.

### Write rules (mandatory for all tiers)

1. **Never overwrite** — always check if file exists before creating. If exists, append or create with suffix `-v2`
2. **Unique names** — `YYYY-MM-DD` prefix guarantees uniqueness for decisions; topic name for learnings
3. **Vault frontmatter required** — every new file must have YAML frontmatter (see SKILL.md §2)
4. **WikiLinks** — link to related existing vault notes using `[[file-name]]` format
5. **Strategic threshold for Tier 2 only** — decisions/learnings that affect only one project go to `_knowledge/projects/{nome}/`, not `_decisions/hseos/`

---

## 4. `_memory/current-state.md` — special rules

This file is the bridge between user sessions. Two mechanisms write to it — both are valid and coexist:

- **Read freely** — any agent can read it at session start
- **`/end-session` (primary)** — replaces the main sections (What Was Done / Decisions Made / Current Phase / Next Steps / Open Questions) with conversation context. Written after any productive session.
- **`hseos brain sync` (complementary)** — appends an `## HSEOS — {epic-id}` block at the END. Written post-epic. Does not touch the `/end-session` sections.
- **HSEOS agents** — never write to `current-state.md` directly during active sessions. ORBIT may append a single `## HSEOS — {epic-id}` block at Phase 10 only if `hseos brain sync` is not available.

---

## 5. Fallback chain

```
second-brain available → read vault files → enrich task context
second-brain unavailable → use HSEOS sources only (Constitution, authority, SKILLS-REGISTRY)
```

Never block execution because second-brain is unavailable. It is always optional enrichment.
