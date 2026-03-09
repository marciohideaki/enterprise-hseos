# Constitution Directory

> **For human contributors.** AI agents read `Enterprise-Constitution.md` directly — not this README.

---

## What This Directory Contains

| File | Purpose |
|---|---|
| `Enterprise-Constitution.md` | The single, authoritative governance constitution (v2.0) |

That's it. One document. No addendums, no splits.

---

## About the Constitution (v2.0)

The `Enterprise-Constitution.md` is the **highest-authority document** in the entire governance overlay. Everything else — core standards, cross-cutting standards, stack standards, ADRs — derives its authority from or must comply with this document.

**v2.0 history:** Previously split into two documents (`HSEOS-Enterprise-Constitution.md` + an Addendum). The split existed because the overlay was built on top of an upstream framework whose files were not to be modified. Once the overlay became fully owned, the split was eliminated and both documents were merged into one coherent constitution.

**Why a single document?** An addendum implies you cannot modify the original. If you own the document, there is no reason to maintain two files covering the same subject — it creates inconsistency risk and cognitive overhead.

---

## What the Constitution Governs

The constitution defines (in order of sections):

1. **Purpose** — why AI agents exist in this engineering context
2. **Non-Negotiables** — hard rules that cannot be overridden (GitHub as source of truth, state-of-the-art baseline, no silent deviations)
3. **Document Authority & Precedence** — the hierarchy that resolves conflicts between governance documents
4. **Canonical Documentation Layout** — where each type of document lives and why
5. **Operating Model** — human vs. agent responsibilities
6. **Documentation and Sharding Policy** — how large documents are split
7. **Standards Enforcement** — quality gates and "no silent deviations" rule
8. **Agent Behavior Rules** — what agents must and must not do
9. **Conflict Resolution** — what to do when documents contradict each other
10. **Decision Records** — ADR policy
11. **Agent Skill Consumption** — how agents load and use skills
12. **Definitions** — shared terminology
13. **Change Control** — how the constitution itself is modified
14. **Acceptance** — binding for all contributors

---

## Changing the Constitution

Changes to the Constitution require:
1. An explicit PR
2. Review by Engineering Leadership
3. A version bump (v2.0 → v2.1 etc.)

Agents MUST NOT modify the constitution autonomously.
