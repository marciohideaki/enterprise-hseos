# Memory Evolution Roadmap

**Status:** Planned  
**Scope:** HSEOS runtime, workflow orchestration, multi-agent coordination  
**Last Updated:** 2026-03-25

---

## 1. Objective

Define the planned evolution of memory in HSEOS to improve:
- historical traceability
- workflow resume quality
- shared context across agents
- token efficiency
- execution performance
- operational simplicity

This document is **not yet normative**. It records the current recommended direction for future implementation.

---

## 2. Problem Statement

The current HSEOS flow has improved orchestration, run-state, readiness validation, and workflow handoff, but memory is still fragmented across:
- workflow run-state files
- BMAD planning artifacts
- sprint tracking artifacts
- chat history
- local repository state

This creates four issues:
- too much relevant state lives outside a shared memory substrate
- historical evolution is difficult to query structurally
- shared context between agents is not yet standardized
- token usage can grow unnecessarily if context is rebuilt from raw artifacts repeatedly

---

## 3. Architectural Decision Direction

The recommended direction is:

**SQLite as the primary memory store, exposed through a dedicated HSEOS memory MCP/tool, with hierarchical memory semantics.**

This means:
- SQLite stores memory as structured operational state
- an MCP/tool exposes read/write/query operations to agents and workflows
- workflows and agents consume memory through the tool, not through direct file conventions
- skills may document memory usage patterns, but skills are not the memory backend

---

## 4. Recommended Memory Model

HSEOS should evolve toward a layered memory architecture:

### 4.1 Event Memory

Append-only event log for everything that happened.

Examples:
- workflow initialized
- phase completed
- gate updated
- story status changed
- commit recorded
- deployment failed
- resume synchronized from artifacts

Purpose:
- auditability
- reconstructability
- low-cost writes
- causal trace across agents

### 4.2 Materialized Run-State

Small current-state snapshots derived from the event stream.

Examples:
- current workflow phase
- current handoff agent
- current gate states
- current story states
- current artifact references

Purpose:
- low-latency reads
- workflow resume
- minimal token cost in the hot path

### 4.3 Long-Term Shared Memory

Shared persistent memory with namespace boundaries.

Types:
- **Semantic memory:** facts, decisions, constraints, environment facts
- **Episodic memory:** retrospectives, prior incidents, notable execution outcomes
- **Procedural memory:** refined playbooks, operational instructions, learned execution rules

Purpose:
- cross-agent recall
- cross-run continuity
- reduction of repeated reasoning

### 4.4 Pinned Working Memory

Very small memory blocks always eligible for inclusion in context.

Examples:
- active objective
- current constraints
- critical ADR references
- current handoff summary
- top unresolved blockers

Purpose:
- reduce context rebuild cost
- keep high-signal information visible to the active agent

### 4.5 Background Consolidation

Compaction, summarization, reflection, and procedural refinement outside the hot path.

Purpose:
- keep prompt context small
- transform raw execution history into reusable knowledge
- avoid carrying full historical logs into every step

---

## 5. Why SQLite

SQLite is the recommended first implementation target because it offers:
- low operational cost
- local-first simplicity
- strong transactional guarantees
- sufficient performance for HSEOS memory workloads
- excellent fit for structured workflow state and event logging
- easy bundling in repository-local or runtime-local tooling

Additional advantages:
- FTS5 can support useful textual search without introducing a second system immediately
- schema migration is straightforward
- backup/export is easy
- local developer environments remain simple

SQLite is expected to be sufficient for:
- run-state
- workflow event logs
- story/gate/phase state
- artifact indexing
- factual long-term memory

---

## 6. Why MCP/Tool Instead of Skill

The recommended access mechanism is a **memory MCP/tool**, not a skill.

Reasoning:
- memory needs a stable runtime interface
- agents should not directly manage SQL or file semantics
- tools can enforce schema, namespaces, and mutation rules
- workflows need deterministic operations such as append, query, hydrate, compact
- skills are better suited to usage conventions, not data storage or lifecycle control

Skills may still be useful to:
- teach agent behavior around memory
- standardize what should be written
- standardize when compaction or reflection should occur

But the persistence layer itself should live behind a tool/MCP.

---

## 7. Recommended Initial Interfaces

The future memory MCP/tool should expose operations such as:

- `memory.append_event`
- `memory.get_run_state`
- `memory.upsert_run_state`
- `memory.list_workflow_events`
- `memory.record_gate`
- `memory.update_story_state`
- `memory.record_story_commit`
- `memory.get_handoff`
- `memory.search_semantic`
- `memory.search_episodic`
- `memory.upsert_procedural_note`
- `memory.sync_from_artifacts`
- `memory.compact_run_history`

These operations should be namespace-aware.

---

## 8. Recommended Namespace Strategy

Memory should be queryable by namespace.

Examples:
- `repo:enterprise-bmad`
- `repo:event-platform`
- `workflow:epic-delivery`
- `run:epic17`
- `epic:17`
- `team:delivery`
- `agent:orbit`

This allows:
- shared memory where appropriate
- isolation where necessary
- lower retrieval noise
- cheaper context reconstruction

---

## 9. Suggested SQLite Schema Direction

The following table families are recommended for the first implementation:

### 9.1 `events`

Append-only operational history.

Suggested fields:
- `id`
- `ts`
- `repo`
- `workflow_id`
- `run_id`
- `agent`
- `event_type`
- `entity_type`
- `entity_id`
- `payload_json`

### 9.2 `run_states`

Materialized current run snapshots.

Suggested fields:
- `run_id`
- `repo`
- `workflow_id`
- `phase_id`
- `current_agent`
- `status`
- `state_json`
- `updated_at`

### 9.3 `memories`

Long-term memory store.

Suggested fields:
- `id`
- `namespace`
- `memory_type`
- `title`
- `content`
- `tags_json`
- `source_type`
- `source_ref`
- `importance`
- `updated_at`

### 9.4 `artifacts`

Indexed references to external artifacts.

Suggested fields:
- `id`
- `repo`
- `artifact_type`
- `path_or_ref`
- `linked_entity_type`
- `linked_entity_id`
- `metadata_json`

### 9.5 `relationships`

Graph-style linkage between run, story, epic, phase, ADR, artifact, etc.

Suggested fields:
- `from_type`
- `from_id`
- `relation`
- `to_type`
- `to_id`

---

## 10. Retrieval Strategy

The preferred retrieval strategy is hybrid and hierarchical:

### 10.1 Hot Path Retrieval

Always prefer:
- current run-state
- pinned working memory
- a very small retrieved set of relevant memories

Do **not** replay full history into the prompt by default.

### 10.2 Cold Path Retrieval

Use longer search only for:
- retrospective analysis
- workflow reconstruction
- exception investigation
- knowledge distillation

### 10.3 Search Modes

Initial implementation:
- exact key lookup
- namespace filtering
- FTS5 textual search

Future optional extension:
- embedding-backed semantic retrieval

Embedding search should be considered a later optimization, not the first dependency.

---

## 11. Cost and Token Strategy

The main token-efficiency principle is:

**Store richly, retrieve sparsely.**

Implications:
- write events liberally
- materialize current state compactly
- retrieve only the minimum memory needed for the current step
- summarize and consolidate in background workflows

Expected benefits:
- lower prompt bloat
- fewer repeated artifact injections
- better multi-agent handoff
- less dependence on raw chat history

---

## 12. Phased Implementation Plan

### Phase 1 — Operational Memory Foundation

Deliver:
- SQLite store
- event log
- run-state materialization
- tool/MCP wrappers for workflow state operations

Priority: highest

### Phase 2 — Workflow Integration

Deliver:
- replace file-only run-state access with tool-backed access
- sync BMAD artifacts into the memory substrate
- standardize handoff retrieval through memory APIs

Priority: high

### Phase 3 — Shared Long-Term Memory

Deliver:
- semantic/episodic/procedural memory tables
- namespace-aware retrieval
- pinned memory blocks for active runs and teams

Priority: high

### Phase 4 — Background Consolidation

Deliver:
- history compaction
- reflective summaries
- procedural memory refinement

Priority: medium

### Phase 5 — Optional Semantic Retrieval Extension

Deliver:
- embedding-assisted retrieval if needed
- hybrid lexical + semantic ranking

Priority: optional / evidence-driven

---

## 13. Open Questions

The following points remain open and should be decided before implementation:

- Should the SQLite file live inside the repo, in `.hseos/`, or in a runtime-local path?
- Should memory be single-repo or multi-repo by default?
- Should artifacts remain file-authoritative while memory acts as an index, or should some workflow state move fully into SQLite?
- What retention/compaction rules apply to operational event history?
- What visibility rules should apply to shared memory across agents and teams?

---

## 14. Current Recommendation

If implementation starts now, the recommended path is:

1. build a SQLite-backed memory store
2. expose it through an HSEOS memory MCP/tool
3. model event log + run-state first
4. add shared semantic/episodic/procedural memory second
5. add embeddings only if lexical + structured retrieval proves insufficient

---

## 15. Relationship to Existing Standards

This roadmap should eventually inform or update:
- [Memory-Architecture-Standard.md](/opt/hideakisolutions/enterprise-bmad/.enterprise/.specs/cross/Memory-Architecture-Standard.md)
- [Multi-Agent-Architecture-Standard.md](/opt/hideakisolutions/enterprise-bmad/.enterprise/.specs/cross/Multi-Agent-Architecture-Standard.md)
- [Tool-Design-Governance-Standard.md](/opt/hideakisolutions/enterprise-bmad/.enterprise/.specs/cross/Tool-Design-Governance-Standard.md)

Until then, this document remains planning guidance rather than binding governance.
