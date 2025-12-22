# Repository Curation & Replay Rules (Enterprise)
**Scope:** Repository Replay, Legacy-to-Vitrine Migration  
**Applies to:** Humans and BMAD Agents  
**Status:** Mandatory  
**Version:** 1.0  

---

## 1. Purpose
This document defines the **non-negotiable rules** for curating and replaying a legacy repository (Repository A) into a **clean, professional, and exemplary showcase repository** (Repository B).

This is **not** a development workflow.  
This is **not** an optimization or refactoring process.

This is a **controlled reconstruction of history**.

---

## 2. Core Principle
Repository B MUST represent:

- A **clean technical narrative**
- A **professional development flow**
- A **didactic and inspectable history**
- A **corporate-grade showcase repository**

Repository B is **curated**, not experimented.

---

## 3. Absolute Constraints
During replay, the following are **strictly forbidden**:

- Altering functional requirements
- Altering non-functional requirements
- Altering business rules
- Altering defined architecture
- Introducing improvements not present in the legacy
- Simplifying implementations for convenience
- Reordering epics or stories

If behavior exists in Repository A, it MUST exist in Repository B — no more, no less.

---

## 4. What Is Being Replayed
The replay process MUST preserve:

- Epics (logical intent)
- Stories (functional units)
- Final functional state per story
- Architectural patterns
- Naming conventions
- Technical decisions already taken

The replay process MUST NOT preserve:
- Failed attempts
- Retries
- Hotfix noise
- Emergency commits
- Debug artifacts
- Emotional or informal history

---

## 5. Epics and Stories Reconstruction
Epics and stories MUST be reconstructed by:

- Analyzing final functional outcomes
- Mapping code changes per story
- Preserving logical sequence
- Maintaining original intent, not textual commit messages

Epics and stories are **discovered**, not invented.

---

## 6. Commit Curation Rules
Commits in Repository B MUST:

- Represent a **complete logical unit**
- Be buildable and stable
- Reflect final intended behavior
- Be traceable to a single story or sub-step

Commits MUST NOT:
- Represent partial work
- Contain temporary fixes
- Reference bugs, retries, or mistakes
- Contain informal or emotional language

Commits represent **decisions**, not attempts.

---

## 7. Commit Message Quality
Commit messages MUST be:

- Clear
- Technical
- Descriptive
- Objective

They MUST describe **what was introduced**, not how painful it was.

Examples of forbidden language:
- “fix”
- “wip”
- “try again”
- “temp”
- “quick fix”

---

## 8. Branching During Replay
Replay MUST follow a **structured and predictable flow**:

- `main` → stable, curated history
- `develop` → integration during replay
- `feature/<epic>/<story>` → isolated replay unit

Branch naming MUST reflect epic and story intent.

---

## 9. Pull Requests as Narrative
Every Pull Request in Repository B MUST:

- Represent a story or cohesive feature
- Clearly state the epic context
- Describe what was reproduced
- Avoid any claim of improvement or optimization

Pull Requests are **technical documentation**, not ceremonies.

---

## 10. What “Clean History” Means
Clean history does NOT mean fewer commits.  
Clean history means:

- No ambiguity
- No noise
- No dead ends
- No misleading evolution

Every commit in Repository B MUST be defensible as:
> “This represents how a professional team would have implemented this story.”

---

## 11. Forbidden Behaviors
The following are forbidden during replay:

- Skipping stories
- Merging stories
- Rewriting requirements
- Introducing shortcuts
- Changing sequence for convenience
- “Fixing” the legacy

The replay process is **faithful**, not corrective.

---

## 12. Validation Criteria for Repository B
Repository B is considered valid ONLY if:

- The full functional scope of Repository A is present
- Architecture matches the original intent
- History is readable and coherent
- Commits are exemplary
- Pull Requests are professional and didactic
- No legacy noise is visible

---

## 13. Conflict Resolution Rule
In case of ambiguity:

- Prefer the **most restrictive interpretation**
- Escalate instead of assuming
- Never infer improvements
- Never compress history

Silence is a violation.

---

## 14. Authority
This document overrides:

- Generic Git workflows
- Optimization heuristics
- Productivity shortcuts

When operating in **Repository Replay / Vitrine mode**, this document is **the highest authority**.

---

**End of Document**
