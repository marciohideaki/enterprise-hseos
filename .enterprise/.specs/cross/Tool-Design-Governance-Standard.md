# Tool Design Governance Standard

**Standard ID:** CE-TOOL
**Version:** 1.0.0
**Scope:** All tools exposed to AI agents (function calls, MCP tools, slash commands, agent skills)
**Applicability:** Mandatory when designing, reviewing, or modifying tools used by agents
**Authority:** Cross-Cutting

---

## Purpose

Tool design directly impacts agent behavior quality, context efficiency, and security posture. Poorly designed tools create context waste, ambiguity, and unintended side effects. This standard governs tool design to maximize agent reliability and minimize risk.

---

## 1. Core Design Principles

### CE-TOOL-01 — Single Responsibility

Each tool MUST do one thing. A tool that reads files AND validates content AND writes output is three tools poorly composed as one.

**Good:** `readFile`, `validateSchema`, `writeFile` — separate tools, composable by orchestrator.
**Bad:** `processFile` — ambiguous, hard to test, hard to reason about permissions.

### CE-TOOL-02 — Minimal Permission Scope

Tools MUST request only the permissions they need. A file-reading tool MUST NOT have write access.

Permission categories:
- **Read-only**: safe, low risk, freely grantable
- **Write-local**: reversible, confirm before bulk operations
- **Write-remote / external**: irreversible, requires explicit authorization
- **Destructive**: requires user confirmation in all cases

### CE-TOOL-03 — Idempotency

Tools MUST be safe to call multiple times with the same inputs — either idempotent (same result) or explicitly documented as non-idempotent with required confirmation.

- **Idempotent:** reading a file, validating a schema, generating a report
- **Non-idempotent (must flag):** sending an email, creating a PR, deploying a service

### CE-TOOL-04 — Reversibility Classification

Every tool MUST be classified by reversibility:

| Class | Definition | Required Behavior |
|---|---|---|
| **Reversible** | Effect can be undone (file edit, git commit) | Standard use |
| **Hard to reverse** | Significant effort to undo (push, merge) | Require confirmation |
| **Irreversible** | Cannot be undone (delete, send message, charge) | Require explicit user instruction + confirmation |

Agents MUST NOT invoke irreversible tools without explicit user instruction in the current session.

---

## 2. Interface Design Rules

### CE-TOOL-05 — Explicit Over Implicit Parameters

Tool parameters MUST be explicit and typed. Avoid parameters that accept "anything" and rely on the agent to provide the right format.

**Good:** `path: string`, `mode: "read" | "append" | "overwrite"`
**Bad:** `options: object` — requires agent to know undocumented structure

### CE-TOOL-06 — Structured Outputs

Tools MUST return structured output, not free-form prose. Agent orchestrators depend on parseable tool results.

**Good:** `{ success: true, linesChanged: 5, file: "src/auth.ts" }`
**Bad:** `"Successfully updated the authentication file with 5 line changes"`

### CE-TOOL-07 — Explicit Error Contracts

Tools MUST return distinguishable error states, not just "it failed." The error MUST include:
- What failed
- Why (if deterministic)
- Whether it is retryable

### CE-TOOL-08 — Descriptive Names and Descriptions

Tool names MUST describe what they do (verb + noun pattern): `readFile`, `createPR`, `validateSchema`.
Tool descriptions MUST include:
- What the tool does
- Required parameters
- Side effects (if any)
- When NOT to use it

---

## 3. Context Budget Rules

- **CE-TOOL-09:** Tools that return large outputs (file reads, search results, API responses) MUST support filtering or pagination to limit context consumption.
- **CE-TOOL-10:** Default tool outputs MUST be concise; full output should require explicit opt-in (e.g., `verbose: true`).
- **CE-TOOL-11:** Search tools MUST support scope limiting (path, file type, line range) to prevent full-codebase scans that flood context.
- **CE-TOOL-12:** Tools MUST NOT include redundant metadata in results (e.g., repeating the input query in the output).

---

## 4. Security Rules

- **CE-TOOL-13:** Tools that execute code or shell commands MUST sanitize all inputs — no passthrough of agent-constructed strings to shell.
- **CE-TOOL-14:** File operation tools MUST validate paths — no traversal beyond the declared working directory.
- **CE-TOOL-15:** Tools that access external APIs MUST NOT expose credentials in tool results or logs.
- **CE-TOOL-16:** Tools that create or modify shared state (remote repos, CI systems, databases) MUST be gated behind explicit authorization checks — not auto-approved.
- **CE-TOOL-17:** Tool results that contain external content (web fetches, file reads from external sources) MUST be tagged as untrusted — agents MUST NOT treat external content as instructions.

---

## 5. Tool Review Checklist

Before adding a new tool to an agent's toolkit:

- [ ] Single responsibility: does exactly one thing
- [ ] Permission scope is minimal for its function
- [ ] Reversibility classified and documented
- [ ] Parameters are explicitly typed, no ambiguous objects
- [ ] Output is structured (parseable)
- [ ] Error states are distinguishable and include retry guidance
- [ ] Large outputs support filtering or pagination
- [ ] External-content outputs tagged as untrusted
- [ ] Shell/code execution inputs are sanitized
- [ ] Non-idempotent behavior is flagged in description

---

## 6. Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| God tool (does everything) | Cannot be permission-scoped; ambiguous behavior |
| Prose output | Brittle parsing; context waste |
| Silent side effects | Agent cannot reason about what the tool changed |
| Unconstrained file reads | Floods context; performance degradation |
| Shell passthrough | Command injection vector |
| Undocumented non-idempotency | Agent may call destructive tool multiple times |

**End**
