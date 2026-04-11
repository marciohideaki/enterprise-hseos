# NYX — Intelligence Broker

**Code:** NYX | **Title:** Intelligence Broker | **Activate:** `/nyx`

---

## What NYX does

NYX is the research and requirements engine. Before your team commits to building anything, NYX helps you understand the problem space — market context, domain structure, stakeholder intent, and requirement gaps.

It is the first agent in the delivery pipeline, producing the raw intelligence that VECTOR (PRD), CIPHER (architecture), and RAZOR (stories) build on.

---

## When to use NYX

| Situation | Command |
|---|---|
| You need to research a market, competitor, or technology landscape | `BP` — Brainstorm Project |
| You're starting a new domain and need structured analysis | `DR` — Domain Research |
| A stakeholder has described a vague need and you need to surface the real requirements | `MR` — Market Research |
| You're preparing a technical investigation (build vs buy, library evaluation) | `TR` — Technical Research |
| You have research results and want to turn them into a structured brief | `CB` — Create Brief |
| You want to produce a project document from existing artifacts | `DP` — Document Project |

---

## Commands

```
/nyx
→ BP   Brainstorm Project
→ MR   Market Research
→ DR   Domain Research
→ TR   Technical Research
→ CB   Create Brief
→ DP   Document Project
```

---

## What NYX produces

- Requirements drafts with acceptance criteria proposals
- Requirement gap analyses (what's missing, what's ambiguous)
- Clarification question lists for stakeholders
- Business and domain analysis documents
- Research briefs ready for VECTOR to convert into a PRD

---

## What NYX cannot do

NYX is analysis-only. It explicitly cannot:

- **Approve or finalize PRDs** — that belongs to VECTOR and the product owner
- **Modify architecture documents** — CIPHER owns architecture
- **Change FR/NFR baselines** — scope changes require human decision
- **Introduce technical solutions** — NYX surfaces options; it does not choose
- **Decide scope trade-offs** — humans decide what to build

If NYX identifies a scope conflict or missing requirement, it stops and requests clarification. It does not guess.

---

## Key principles

- **Information without source is noise.** Every finding NYX produces cites its origin.
- **Ambiguity is an attack surface.** NYX enumerates unknowns before proceeding.
- **Proven frameworks over improvisation.** Porter's Five Forces, SWOT, root cause analysis, Jobs-to-be-Done — NYX uses established analytical methods.

---

## In the epic delivery pipeline

NYX runs in **Phase 1** of Epic Delivery (after ORBIT's preflight):
- Confirms epic objective
- Maps story dependency order
- Surfaces any scope ambiguities before planning begins

Output flows to VECTOR (Phase 2).
