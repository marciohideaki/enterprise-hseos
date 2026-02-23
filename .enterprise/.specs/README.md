# Enterprise Specs

> **For human contributors.** AI agents navigate this directory via `.specs/_INDEX.md` — not this README.

---

## What This Directory Is

`.enterprise/.specs/` is the **single source of truth for all governance specifications** in this overlay. It contains every normative document that governs how engineering work must be done — from high-level constitutional principles down to stack-specific coding standards.

This directory is **entirely agent-facing in content** (standards, rules, checklists) but uses READMEs as human orientation guides at each level.

---

## Structure

```
.specs/
├── constitution/       Enterprise Constitution — the highest authority document
├── core/               Organizational invariants — 13 standards all agents read first
├── cross/              Cross-cutting standards — 11 mandatory standards across all stacks
├── CSharp/             C# / .NET stack — 10 documents
├── Java/               Java stack — 10 documents
├── Go/                 Go stack — 10 documents
├── PHP/                PHP stack — 10 documents
├── Cpp/                C++ stack — 10 documents
├── Flutter/            Flutter stack — 10 documents
├── ReactNative/        React Native stack — 10 documents
└── decisions/          ADR repository — append-only decision records
```

---

## Authority Order (Summary)

| Level | Location | Authority |
|---|---|---|
| Constitution | `constitution/Enterprise-Constitution.md` | Highest |
| Core Standards | `core/` | Organizational invariants |
| Cross-Cutting | `cross/` | Mandatory across all stacks |
| Stack Standards | `<Stack>/` | Stack-specific rules |
| ADRs | `decisions/` | Approved overrides/decisions |

Full authority order: `constitution/Enterprise-Constitution.md` §3.

---

## How Each Directory Is Navigated

Every subdirectory has an `_INDEX.md` that serves as the agent entry point:

| Directory | Agent Entry Point |
|---|---|
| `constitution/` | `Enterprise-Constitution.md` directly |
| `core/` | `core/_INDEX.md` |
| `cross/` | `cross/_INDEX.md` |
| `<Stack>/` | `<Stack>/_INDEX.md` |
| `decisions/` | `decisions/_INDEX.md` |
| Master index | `_INDEX.md` (this level) |

---

## What Lives Here vs. What Does Not

**Lives here:**
- All normative engineering standards
- Architecture decision records
- Stack-specific requirements and templates
- Cross-cutting mandatory rules (security, observability, testing, etc.)

**Does NOT live here:**
- Product requirements (those live in the product repo)
- Agent persona definitions (those live in `../agents/`)
- Operational playbooks (those live in `../playbooks/`)
- Agent skills (those live in `../governance/agent-skills/`)

---

## Adding a New Standard

1. Determine the shard: core, cross, or stack-specific?
2. Create the document in the correct directory
3. Add an entry to the directory's `_INDEX.md`
4. If it's a cross-cutting standard, add to `cross/_INDEX.md` AND update `constitution/Enterprise-Constitution.md` §4.2
5. If it changes an existing architectural decision, create an ADR in `decisions/`
