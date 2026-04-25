/**
 * AgentStateDAL — Data access layer for HSEOS agent state tracking.
 * Operates exclusively on `as_*` tables created by migrations 001/002.
 * DB is injected via constructor — this module does NOT require better-sqlite3 directly.
 * @module agent-state-dal
 */

class AgentStateDAL {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;

    this._stmts = {
      createRun: db.prepare(
        `INSERT OR IGNORE INTO as_runs (id, workflow_id, project, phase) VALUES (?, ?, ?, ?)`
      ),
      updateRunPhase: db.prepare(
        `UPDATE as_runs SET phase = ? WHERE id = ?`
      ),
      updateRunPhaseAndGate: db.prepare(
        `UPDATE as_runs SET phase = ?, gate_status = ? WHERE id = ?`
      ),
      completeRun: db.prepare(
        `UPDATE as_runs SET ended_at = datetime('now'), status = ? WHERE id = ?`
      ),
      createTask: db.prepare(
        `INSERT INTO as_tasks (id, run_id, wave, effort, model_tier, goal, branch, worktree_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      getTaskForClaim: db.prepare(
        `SELECT id, run_id, status FROM as_tasks WHERE id = ?`
      ),
      setTaskInProgress: db.prepare(
        `UPDATE as_tasks SET status = 'IN_PROGRESS', updated_at = datetime('now') WHERE id = ? AND status = 'PENDING_EXECUTION'`
      ),
      createAgentRun: db.prepare(
        `INSERT INTO as_agent_runs (agent_name, task_id, run_id) VALUES (?, ?, ?)`
      ),
      insertEvent: db.prepare(
        `INSERT INTO as_events (agent_run_id, kind, payload_json) VALUES (?, ?, ?)`
      ),
      getLastInsertRowid: db.prepare(`SELECT last_insert_rowid() AS rowid`),
      updateHeartbeatAgentRun: db.prepare(
        `UPDATE as_agent_runs SET last_heartbeat_at = datetime('now') WHERE id = ?`
      ),
      completeAgentRun: db.prepare(
        `UPDATE as_agent_runs
         SET ended_at = datetime('now'), status = ?, exit_reason = ?, tokens_in = ?, tokens_out = ?, cost_usd = ?
         WHERE id = ?`
      ),
      listOrphansBase: null, // built dynamically (staleMinutes inline)
      listRuns: db.prepare(
        `SELECT * FROM as_runs ORDER BY started_at DESC LIMIT ?`
      ),
      listRunsStatus: db.prepare(
        `SELECT * FROM as_runs WHERE status = ? ORDER BY started_at DESC LIMIT ?`
      ),
      listRunsProject: db.prepare(
        `SELECT * FROM as_runs WHERE project = ? ORDER BY started_at DESC LIMIT ?`
      ),
      listRunsStatusProject: db.prepare(
        `SELECT * FROM as_runs WHERE status = ? AND project = ? ORDER BY started_at DESC LIMIT ?`
      ),
      getRun: db.prepare(`SELECT * FROM as_runs WHERE id = ?`),
      taskStatusCounts: db.prepare(
        `SELECT status, COUNT(*) AS cnt FROM as_tasks WHERE run_id = ? GROUP BY status`
      ),
      agentRunStatusCounts: db.prepare(
        `SELECT status, COUNT(*) AS cnt FROM as_agent_runs WHERE run_id = ? GROUP BY status`
      ),
      maxHandoffVersion: db.prepare(
        `SELECT COALESCE(MAX(version), 0) AS max_v FROM as_handoffs WHERE src_task = ? AND dst_task = ?`
      ),
      insertHandoff: db.prepare(
        `INSERT INTO as_handoffs (src_task, dst_task, content, version) VALUES (?, ?, ?, ?)`
      ),
      recordWaveExec: db.prepare(
        `INSERT OR REPLACE INTO as_wave_executions (wave_id, task_id, commit_sha, status, logs_path)
         VALUES (?, ?, ?, ?, ?)`
      ),
      recordWorktree: db.prepare(
        `INSERT OR REPLACE INTO as_worktree_state (task_id, branch_name, base_branch)
         VALUES (?, ?, ?)`
      ),
      removeWorktree: db.prepare(
        `UPDATE as_worktree_state SET removed_at = datetime('now') WHERE task_id = ?`
      ),

      // === Session tracking (migration 003) ===
      createSession: db.prepare(
        `INSERT INTO as_sessions (id, parent_id, host) VALUES (?, ?, ?)`
      ),
      heartbeatSession: db.prepare(
        `UPDATE as_sessions SET last_seen_at = datetime('now') WHERE id = ?`
      ),
      endSession: db.prepare(
        `UPDATE as_sessions SET ended_at = datetime('now'), status = ? WHERE id = ?`
      ),
      attachRunToSession: db.prepare(
        `UPDATE as_runs SET session_id = ?, repo_url = ?, base_branch = ? WHERE id = ?`
      ),
      listSessionRunsStmt: db.prepare(
        `SELECT * FROM as_runs WHERE session_id = ? ORDER BY started_at DESC`
      ),
      claimWorktree: db.prepare(
        `INSERT INTO as_worktree_state (task_id, branch_name, base_branch, claimed_by_session, claimed_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      ),
      releaseWorktreeStmt: db.prepare(
        `UPDATE as_worktree_state SET removed_at = datetime('now')
         WHERE task_id = ? AND claimed_by_session = ? AND removed_at IS NULL`
      ),
    };

    // Transactions cached for multi-statement operations
    this._tx = {
      claimTask: db.transaction((task_id, agent_name) => {
        const task = this._stmts.getTaskForClaim.get(task_id);
        if (!task || task.status !== 'PENDING_EXECUTION') {
          return { claimed: false };
        }
        const updateInfo = this._stmts.setTaskInProgress.run(task_id);
        if (updateInfo.changes === 0) {
          // Race condition — another agent claimed it between the read and write
          return { claimed: false };
        }
        this._stmts.createAgentRun.run(agent_name, task_id, task.run_id);
        const agent_run_id = this.db.prepare(`SELECT last_insert_rowid() AS rowid`).get().rowid;
        return { claimed: true, agent_run_id };
      }),

      recordHeartbeat: db.transaction((agent_run_id) => {
        this._stmts.updateHeartbeatAgentRun.run(agent_run_id);
        this._stmts.insertEvent.run(agent_run_id, 'heartbeat', null);
        const ts = db.prepare(`SELECT datetime('now') AS ts`).get().ts;
        return { ts };
      }),

      completeAgentRun: db.transaction((agent_run_id, { status, exit_reason, tokens_in, tokens_out, cost_usd }) => {
        const info = this._stmts.completeAgentRun.run(status, exit_reason, tokens_in, tokens_out, cost_usd, agent_run_id);
        const eventKind = status === 'aborted' ? 'abort' : 'complete';
        this._stmts.insertEvent.run(agent_run_id, eventKind, null);
        return { changes: info.changes };
      }),

      recordHandoff: db.transaction(({ src_task, dst_task, content }) => {
        // Bump version: SELECT MAX(version) + 1, defaulting to 1 if no prior handoff exists
        const { max_v } = this._stmts.maxHandoffVersion.get(src_task, dst_task);
        const version = max_v + 1;
        this._stmts.insertHandoff.run(src_task, dst_task, content, version);
        const id = this.db.prepare(`SELECT last_insert_rowid() AS rowid`).get().rowid;
        return { id, version };
      }),
    };
  }

  /**
   * Create a new workflow run (idempotent — INSERT OR IGNORE).
   * @param {{ id: string, workflow_id: string, project: string, phase?: string }} opts
   * @returns {{ id: string }}
   */
  createRun({ id, workflow_id, project, phase = 'intake' }) {
    this._stmts.createRun.run(id, workflow_id, project, phase);
    return { id };
  }

  /**
   * Update the phase (and optionally gate_status) of a run.
   * @param {string} run_id
   * @param {string} phase
   * @param {string|null} gate_status
   * @returns {{ changes: number }}
   */
  updateRunPhase(run_id, phase, gate_status = null) {
    let info;
    if (gate_status !== null) {
      info = this._stmts.updateRunPhaseAndGate.run(phase, gate_status, run_id);
    } else {
      info = this._stmts.updateRunPhase.run(phase, run_id);
    }
    return { changes: info.changes };
  }

  /**
   * Mark a run as completed (or aborted/orphaned).
   * @param {string} run_id
   * @param {string} status
   * @returns {{ changes: number }}
   */
  completeRun(run_id, status = 'completed') {
    const info = this._stmts.completeRun.run(status, run_id);
    return { changes: info.changes };
  }

  /**
   * Create a new task within a run.
   * @param {{ id: string, run_id: string, wave: number, effort?: string, model_tier?: string, goal?: string, branch?: string, worktree_path?: string }} opts
   * @returns {{ id: string }}
   */
  createTask({ id, run_id, wave, effort = null, model_tier = null, goal = null, branch = null, worktree_path = null }) {
    this._stmts.createTask.run(id, run_id, wave, effort, model_tier, goal, branch, worktree_path);
    return { id };
  }

  /**
   * Atomically claim a task for an agent.
   * Transitions task from PENDING_EXECUTION → IN_PROGRESS, creates an agent_run record.
   * @param {string} task_id
   * @param {string} agent_name
   * @returns {{ claimed: boolean, agent_run_id?: number }}
   */
  claimTask(task_id, agent_name) {
    return this._tx.claimTask(task_id, agent_name);
  }

  /**
   * Emit an event for an agent run.
   * @param {{ agent_run_id: number, kind: string, payload?: object|null }} opts
   * @returns {{ id: number, ts: string }}
   */
  emitEvent({ agent_run_id, kind, payload = null }) {
    const payload_json = payload !== null ? JSON.stringify(payload) : null;
    this._stmts.insertEvent.run(agent_run_id, kind, payload_json);
    const { rowid } = this.db.prepare(`SELECT last_insert_rowid() AS rowid`).get();
    const { ts } = this.db.prepare(`SELECT datetime('now') AS ts`).get();
    return { id: rowid, ts };
  }

  /**
   * Record a heartbeat for an agent run (updates timestamp + emits heartbeat event).
   * @param {number} agent_run_id
   * @returns {{ ts: string }}
   */
  recordHeartbeat(agent_run_id) {
    return this._tx.recordHeartbeat(agent_run_id);
  }

  /**
   * Mark an agent run as completed or aborted, recording final metrics.
   * @param {number} agent_run_id
   * @param {{ status?: string, exit_reason?: string|null, tokens_in?: number|null, tokens_out?: number|null, cost_usd?: number|null }} opts
   * @returns {{ changes: number }}
   */
  completeAgentRun(agent_run_id, { status = 'completed', exit_reason = null, tokens_in = null, tokens_out = null, cost_usd = null } = {}) {
    return this._tx.completeAgentRun(agent_run_id, { status, exit_reason, tokens_in, tokens_out, cost_usd });
  }

  /**
   * List agent runs that have gone stale (no heartbeat within staleMinutes).
   * NOTE: staleMinutes is inlined into the SQL because SQLite does not support
   * parameter substitution inside datetime modifier strings.
   * @param {number} staleMinutes
   * @returns {object[]}
   */
  listOrphans(staleMinutes = 10) {
    // Build statement dynamically — staleMinutes inlined (integer, safe from injection)
    const minutes = parseInt(staleMinutes, 10);
    return this.db.prepare(
      `SELECT * FROM as_agent_runs
       WHERE status = 'running'
         AND last_heartbeat_at < datetime('now', '-${minutes} minutes')`
    ).all();
  }

  /**
   * List runs with optional status/project filters.
   * @param {{ status?: string|null, project?: string|null, limit?: number }} opts
   * @returns {object[]}
   */
  listRuns({ status = null, project = null, limit = 50 } = {}) {
    if (status && project) {
      return this._stmts.listRunsStatusProject.all(status, project, limit);
    } else if (status) {
      return this._stmts.listRunsStatus.all(status, limit);
    } else if (project) {
      return this._stmts.listRunsProject.all(project, limit);
    }
    return this._stmts.listRuns.all(limit);
  }

  /**
   * Describe a run with aggregated task and agent_run status counts.
   * @param {string} run_id
   * @returns {{ run: object|null, task_status_counts: object, agent_run_status_counts: object }}
   */
  describeRun(run_id) {
    const run = this._stmts.getRun.get(run_id) || null;
    const taskRows = this._stmts.taskStatusCounts.all(run_id);
    const agentRows = this._stmts.agentRunStatusCounts.all(run_id);
    const task_status_counts = Object.fromEntries(taskRows.map(r => [r.status, r.cnt]));
    const agent_run_status_counts = Object.fromEntries(agentRows.map(r => [r.status, r.cnt]));
    return { run, task_status_counts, agent_run_status_counts };
  }

  /**
   * Full-text search across events using the FTS5 virtual table.
   * @param {string} query - FTS5 query string
   * @param {{ limit?: number }} opts
   * @returns {{ id: number, agent_run_id: number, ts: string, kind: string, payload_json: string|null }[]}
   */
  searchEvents(query, { limit = 50 } = {}) {
    return this.db.prepare(
      `SELECT e.id, e.agent_run_id, e.ts, e.kind, e.payload_json
       FROM as_events_fts fts
       JOIN as_events e ON e.id = fts.rowid
       WHERE as_events_fts MATCH ?
       LIMIT ?`
    ).all(query, limit);
  }

  /**
   * Record a handoff between tasks, auto-bumping the version for the same src→dst pair.
   * @param {{ src_task: string, dst_task: string, content: string }} opts
   * @returns {{ id: number, version: number }}
   */
  recordHandoff({ src_task, dst_task, content }) {
    return this._tx.recordHandoff({ src_task, dst_task, content });
  }

  /**
   * Record (or replace) a wave execution result.
   * @param {{ wave_id: string, task_id: string, commit_sha?: string, status: string, logs_path?: string|null }} opts
   * @returns {{ wave_id: string, task_id: string }}
   */
  recordWaveExecution({ wave_id, task_id, commit_sha = null, status, logs_path = null }) {
    this._stmts.recordWaveExec.run(wave_id, task_id, commit_sha, status, logs_path);
    return { wave_id, task_id };
  }

  /**
   * Record (or replace) a worktree association for a task.
   * @param {{ task_id: string, branch_name: string, base_branch: string }} opts
   * @returns {{ task_id: string }}
   */
  recordWorktree({ task_id, branch_name, base_branch }) {
    this._stmts.recordWorktree.run(task_id, branch_name, base_branch);
    return { task_id };
  }

  /**
   * Mark a worktree as removed.
   * @param {string} task_id
   * @returns {{ changes: number }}
   */
  removeWorktree(task_id) {
    const info = this._stmts.removeWorktree.run(task_id);
    return { changes: info.changes };
  }

  // === Session tracking (migration 003) ===

  /**
   * Register a new session (Claude window or subagent dispatch).
   * @param {{ id: string, parent_id?: string|null, host?: string|null }} opts
   * @returns {{ id: string }}
   */
  createSession({ id, parent_id = null, host = null }) {
    this._stmts.createSession.run(id, parent_id, host);
    return { id };
  }

  /**
   * Update last_seen_at for a session — call periodically while active.
   * @param {string} session_id
   */
  heartbeatSession(session_id) {
    this._stmts.heartbeatSession.run(session_id);
    return { ts: new Date().toISOString() };
  }

  /**
   * Close a session.
   * @param {string} session_id
   * @param {'completed'|'killed'|'orphaned'} [status='completed']
   */
  endSession(session_id, status = 'completed') {
    const info = this._stmts.endSession.run(status, session_id);
    return { changes: info.changes };
  }

  /**
   * Find sessions whose last_seen_at is older than `staleMinutes`.
   * @param {number} [staleMinutes=15]
   * @returns {Array<object>}
   */
  listOrphanSessions(staleMinutes = 15) {
    const stale = parseInt(staleMinutes, 10) || 15;
    const sql = `SELECT * FROM as_sessions
                 WHERE status = 'active'
                   AND last_seen_at IS NOT NULL
                   AND last_seen_at < datetime('now', '-${stale} minutes')`;
    return this.db.prepare(sql).all();
  }

  /**
   * Attach a run to a session for resume + cross-session indexing.
   * @param {{ run_id: string, session_id: string, repo_url?: string|null, base_branch?: string|null }} opts
   */
  attachRunToSession({ run_id, session_id, repo_url = null, base_branch = null }) {
    const info = this._stmts.attachRunToSession.run(session_id, repo_url, base_branch, run_id);
    return { changes: info.changes };
  }

  /**
   * List all runs owned by a session — primary read for `/dev-squad resume`.
   * @param {string} session_id
   * @returns {Array<object>}
   */
  listSessionRuns(session_id) {
    return this._stmts.listSessionRunsStmt.all(session_id);
  }

  /**
   * Atomically claim a worktree for a branch on behalf of a session.
   * Throws on UNIQUE constraint violation — caller decides retry/escalate/release.
   * @param {{ task_id: string, branch_name: string, base_branch: string, session_id: string }} opts
   * @returns {{ task_id: string, claimed: true }}
   * @throws {Error} If branch is already claimed by another active worktree.
   */
  claimWorktree({ task_id, branch_name, base_branch, session_id }) {
    this._stmts.claimWorktree.run(task_id, branch_name, base_branch, session_id);
    return { task_id, claimed: true };
  }

  /**
   * Release a session's claim on a worktree.
   * @param {string} task_id
   * @param {string} session_id
   */
  releaseWorktree(task_id, session_id) {
    const info = this._stmts.releaseWorktreeStmt.run(task_id, session_id);
    return { changes: info.changes };
  }
}

module.exports = { AgentStateDAL };
