'use strict';

const { assertPortShape, deepFreeze } = require('../agent-runtime-contracts');
const { isRelationalSessionEventStore } = require('../agent-session-store');

class AgentExecutionSupervisorError extends Error {
  constructor(message, code = 'AGENT_EXECUTION_SUPERVISOR_INVALID', details = {}) {
    super(message);
    this.name = 'AgentExecutionSupervisorError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentExecutionSupervisorError(`${field} must be a non-empty string`);
  }
}

function assertExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentExecutionSupervisorError('supervisor input must be an object');
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new AgentExecutionSupervisorError('supervisor input has unknown or missing fields');
  }
}

function withDeadline(promise, remainingMs) {
  if (remainingMs <= 0) {
    return Promise.reject(new AgentExecutionSupervisorError('root cancellation exceeded its settlement deadline', 'AGENT_EXECUTION_SETTLEMENT_TIMEOUT'));
  }
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new AgentExecutionSupervisorError('root cancellation exceeded its settlement deadline', 'AGENT_EXECUTION_SETTLEMENT_TIMEOUT')),
        remainingMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

class AgentExecutionSupervisor {
  #agentRuntime;
  #agentTasks = new Map();
  #clock;
  #defaultSettlementMs;
  #store;
  #workflowEngines;
  #workflowTasks = new Map();

  constructor({ agent_runtime, session_store, workflow_engines, max_settlement_ms = 5000, clock = Date }) {
    assertPortShape('AgentRuntime', agent_runtime);
    if (!isRelationalSessionEventStore(session_store)) {
      throw new AgentExecutionSupervisorError('supervisor requires the nominal relational session store');
    }
    if (!(workflow_engines instanceof Map) || workflow_engines.size === 0) {
      throw new AgentExecutionSupervisorError('workflow_engines must be a non-empty Map');
    }
    for (const [engineId, engine] of workflow_engines) {
      requireText(engineId, 'engine_id');
      assertPortShape('WorkflowEngine', engine);
    }
    if (!Number.isInteger(max_settlement_ms) || max_settlement_ms < 1 || max_settlement_ms > 60_000) {
      throw new AgentExecutionSupervisorError('max_settlement_ms must be an integer between 1 and 60000');
    }
    if (!clock || typeof clock.now !== 'function') throw new AgentExecutionSupervisorError('clock.now must be callable');
    this.#agentRuntime = agent_runtime;
    this.#store = session_store;
    this.#workflowEngines = new Map(workflow_engines);
    this.#defaultSettlementMs = max_settlement_ms;
    this.#clock = clock;
  }

  send(input) {
    requireText(input?.session_id, 'session_id');
    if (this.#agentTasks.has(input.session_id)) {
      throw new AgentExecutionSupervisorError('root session already has active agent work', 'AGENT_EXECUTION_ALREADY_ACTIVE');
    }
    const task = Promise.resolve().then(() => this.#agentRuntime.send(input));
    this.#agentTasks.set(input.session_id, task);
    task.finally(() => {
      if (this.#agentTasks.get(input.session_id) === task) this.#agentTasks.delete(input.session_id);
    }).catch(() => {});
    return task;
  }

  runWorkflow(engineId, input) {
    requireText(engineId, 'engine_id');
    const engine = this.#workflowEngines.get(engineId);
    if (!engine) throw new AgentExecutionSupervisorError('workflow engine is not registered', 'AGENT_EXECUTION_ENGINE_NOT_FOUND');
    requireText(input?.workflow?.workflow_id, 'workflow_id');
    requireText(input?.parent_session_id, 'parent_session_id');
    const key = `${engineId}\0${input.workflow.workflow_id}`;
    if (this.#workflowTasks.has(key)) {
      throw new AgentExecutionSupervisorError('workflow is already supervised', 'AGENT_EXECUTION_ALREADY_ACTIVE');
    }
    const task = Promise.resolve().then(() => engine.run(input));
    const tracked = Object.freeze({ engineId, input, key, task });
    this.#workflowTasks.set(key, tracked);
    task.finally(() => {
      if (this.#workflowTasks.get(key) === tracked) this.#workflowTasks.delete(key);
    }).catch(() => {});
    return task;
  }

  #descendants(rootSessionId) {
    const found = [];
    const pending = [...this.#store.replay(rootSessionId).children];
    while (pending.length) {
      const sessionId = pending.shift();
      found.push(sessionId);
      pending.push(...this.#store.replay(sessionId).children);
    }
    return found;
  }

  async cancelRoot(value) {
    assertExactKeys(value, ['schema_version', 'request_id', 'root_session_id', 'reason', 'deadline_ms']);
    if (value.schema_version !== 1) throw new AgentExecutionSupervisorError('unsupported schema_version');
    requireText(value.request_id, 'request_id');
    requireText(value.root_session_id, 'root_session_id');
    requireText(value.reason, 'reason');
    const deadlineMs = value.deadline_ms === null ? this.#defaultSettlementMs : value.deadline_ms;
    if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > this.#defaultSettlementMs) {
      throw new AgentExecutionSupervisorError('deadline_ms exceeds the configured settlement ceiling');
    }
    const startedAt = Number(this.#clock.now());
    if (!Number.isFinite(startedAt)) throw new AgentExecutionSupervisorError('clock.now must return a finite numeric instant');
    const remaining = () => {
      const now = Number(this.#clock.now());
      if (!Number.isFinite(now) || now < startedAt) {
        throw new AgentExecutionSupervisorError('clock.now changed incompatibly during root cancellation');
      }
      return deadlineMs - (now - startedAt);
    };
    const workflows = [...this.#workflowTasks.values()].filter(
      (tracked) => tracked.input.parent_session_id === value.root_session_id,
    );
    const workflowCancellations = workflows.map((tracked) => {
      const engine = this.#workflowEngines.get(tracked.engineId);
      return Promise.resolve().then(() => engine.cancel({
        schema_version: 1,
        engine_id: tracked.engineId,
        request_id: `${value.request_id}:${tracked.input.workflow.workflow_id}`,
        parent_session_id: value.root_session_id,
        workflow_id: tracked.input.workflow.workflow_id,
        reason: value.reason,
      }));
    });
    const agentTask = this.#agentTasks.get(value.root_session_id) || null;
    const rootCancellation = Promise.resolve().then(() => this.#agentRuntime.cancel({
      schema_version: 1,
      command: 'cancel',
      session_id: value.root_session_id,
      reason: value.reason,
      cascade: true,
    }));
    const pending = [
      ...workflowCancellations,
      ...workflows.map((tracked) => tracked.task),
      rootCancellation,
      ...(agentTask ? [agentTask] : []),
    ];
    const settlements = await withDeadline(Promise.allSettled(pending), remaining());
    const workflowResults = settlements
      .slice(workflowCancellations.length, workflowCancellations.length + workflows.length)
      .filter((settlement) => settlement.status === 'fulfilled')
      .map((settlement) => settlement.value);
    const rootCancellationSettlement = settlements[workflowCancellations.length + workflows.length];
    const cancellation = rootCancellationSettlement.status === 'fulfilled' ? rootCancellationSettlement.value : null;
    const root = this.#store.replay(value.root_session_id);
    const descendantIds = this.#descendants(value.root_session_id);
    const unsettled = descendantIds.filter((sessionId) => !this.#store.replay(sessionId).terminal_event);
    if (!root.terminal_event || unsettled.length) {
      throw new AgentExecutionSupervisorError('root cancellation left unsettled work', 'AGENT_EXECUTION_ORPHANED_WORK', {
        root_terminal: Boolean(root.terminal_event),
        unsettled_session_ids: unsettled,
      });
    }
    if (root.terminal_event.event_type !== 'session.cancelled') {
      throw new AgentExecutionSupervisorError('durable root terminal does not correlate to cancellation', 'AGENT_EXECUTION_TERMINAL_CONFLICT', {
        terminal_event_type: root.terminal_event.event_type,
        cancellation_accepted: cancellation?.accepted === true,
      });
    }
    const rejected = settlements.filter((settlement) => settlement.status === 'rejected');
    if (rejected.length || workflowResults.some((result) => !['cancelled', 'completed', 'failed'].includes(result.status))) {
      throw new AgentExecutionSupervisorError('root work settled with cancellation failures', 'AGENT_EXECUTION_CANCELLATION_FAILED', {
        rejected_count: rejected.length,
        rejection_codes: rejected.map((settlement) => settlement.reason?.code || 'unknown'),
      });
    }
    return deepFreeze({
      schema_version: 1,
      request_id: value.request_id,
      root_session_id: value.root_session_id,
      status: 'cancelled',
      root_terminal_ref: `session-event://${root.terminal_event.event_id}`,
      workflow_ids: workflowResults.map((result) => result.workflow_id).sort(),
      descendant_session_ids: descendantIds.sort(),
      cancellation,
    });
  }
}

Object.freeze(AgentExecutionSupervisor.prototype);

module.exports = { AgentExecutionSupervisor, AgentExecutionSupervisorError };
