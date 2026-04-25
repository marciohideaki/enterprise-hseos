# PLAN — Wave 1: Foundation (state tracking)

**Run ID:** 20260425-1900-state-w1-foundation
**G2 Status:** APPROVED (cleared in /plan mode by human review)
**Wave:** 1 of 7

## Task Graph

All 5 tasks are 100% parallel (disjoint NEW files). Single wave, single PR.

```
        ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
        │ T1.1 │  │ T1.2 │  │ T1.3 │  │ T1.4 │  │ T1.5 │
        └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘
           └─────────┴─────────┴─────────┴─────────┘
                            │
                            ▼
                   WAVE-1-REPORT.md
                            │
                            ▼
                       Halt at G4
                       (human PR open)
```

## Tasks

### T1.1 — Migration 001: agent-state tables
**File:** `tools/mcp-project-state/migrations/001-agent-state-tables.sql` (new)
**Tier:** haiku · **Effort:** Small
**Goal:** Create 7 tables with `as_*` prefix: `as_runs`, `as_tasks`, `as_agent_runs`, `as_events`, `as_handoffs`, `as_wave_executions`, `as_worktree_state` + indexes on `(status)`, `(last_heartbeat_at)`, `(agent_run_id, ts)`, `(run_id, wave)`.
**Acceptance:** SQL valid SQLite syntax; `IF NOT EXISTS` guards; foreign keys; CHECK constraints on `events.kind` enum.
**Risk:** None — new file, NEW tables, no schema collision (prefix `as_*`).

### T1.2 — Migration runner
**File:** `tools/mcp-project-state/lib/migrations.js` (new)
**Tier:** sonnet-low · **Effort:** Small
**Goal:** Export `runMigrations(db, migrationsDir)` that reads `*.sql` from dir, applies in order based on filename `NNN-*.sql`, tracks via `PRAGMA user_version` (each migration bumps user_version). Idempotent — safe to re-run.
**Acceptance:** Reads dir, sorts by NNN prefix, applies SQL with version check, logs progress.
**Risk:** None — standalone module.

### T1.3 — Migration 002: events FTS5
**File:** `tools/mcp-project-state/migrations/002-events-fts.sql` (new)
**Tier:** haiku · **Effort:** Trivial
**Goal:** Create FTS5 virtual table `as_events_fts` over `as_events.payload_json` (kind + payload as searchable). Add triggers to keep FTS in sync with INSERT/UPDATE/DELETE on `as_events`.
**Acceptance:** `CREATE VIRTUAL TABLE IF NOT EXISTS as_events_fts USING fts5(...)` + 3 triggers (after insert/update/delete).
**Risk:** None.

### T1.4 — DAL: agent-state-dal.js
**File:** `tools/mcp-project-state/lib/agent-state-dal.js` (new)
**Tier:** **sonnet-high** · **Effort:** Medium
**Goal:** Export class `AgentStateDAL` operating on `as_*` tables. Methods:
  - `createRun({id, workflow_id, project, phase})` → INSERT with conflict ignore
  - `updateRunPhase(run_id, phase, gate_status)`
  - `createTask({id, run_id, wave, effort, model_tier, goal, branch})`
  - `claimTask(task_id, agent_name)` — **atomic via `BEGIN IMMEDIATE` + `WHERE status='pending'`**
  - `emitEvent({agent_run_id, kind, payload})` — INSERT into `as_events`
  - `recordHeartbeat(agent_run_id)` — UPDATE `as_agent_runs.last_heartbeat_at = now()`
  - `listOrphans(staleMinutes=10)` — SELECT WHERE `last_heartbeat_at < now-N`
  - `searchEvents(query)` — FTS5 MATCH on `as_events_fts`
  - `recordHandoff(src_task, dst_task, content)` — INSERT, version auto-bump
  - `recordWaveExecution(wave_id, task_id, commit_sha, status, logs_path)`
  - `recordWorktree({task_id, branch_name, base_branch})`
**Acceptance:** All methods use prepared statements; `claimTask` is atomic; transactions for multi-statement ops; `db` injected via constructor.
**Risk:** Most complex task — sonnet-high tier justified.

### T1.5 — index.js initDb edit (WAL + busy_timeout)
**File:** `tools/mcp-project-state/index.js` (edit `initDb` function only)
**Tier:** haiku · **Effort:** Trivial
**Goal:** Add after `const db = new Database(dbPath)`:
```js
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
```
Then call `runMigrations(db, path.join(__dirname, 'migrations'))` (depends on T1.2 module).
**Acceptance:** PRAGMAs applied; existing tables creation preserved; migration runner invoked.
**Risk:** Edit shared file — only function `initDb`. Disjoint from T1.4 (different file).

## Model × Effort Matrix

| Task | Effort | Model | Rationale |
|---|---|---|---|
| T1.1 | Small | haiku | Pure DDL, no logic |
| T1.2 | Small | sonnet-low | File I/O + version tracking |
| T1.3 | Trivial | haiku | DDL + 3 triggers |
| T1.4 | Medium | **sonnet-high** | DAL with atomic claim + transactions; high-impact |
| T1.5 | Trivial | haiku | 3 pragma lines + 1 require |

## Risk Flags

- T1.4 only Medium task; bumped to sonnet-high for atomic claim correctness.
- T1.5 modifies shared file but only `initDb` function. T1.5 + T1.4 do NOT collide (different files).

## Halt Conditions

- BLOCKED on any task → halt wave, escalate to G3 with diagnosis.
- Validate-commit-msg.sh rejection → halt, escalate.
- Quality gates failure → halt, escalate.

## Definition of Done

- All 5 commits land on `feature/state-tracking-w1-foundation`.
- WAVE-1-REPORT.md written with task table, commit SHAs, status per task.
- STATUS.md updated to `WAVE-1-COMPLETED → READY-FOR-G4`.
- Halt for G4 (human opens PR).
