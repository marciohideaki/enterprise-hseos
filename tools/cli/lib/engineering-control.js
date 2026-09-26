'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
const { createExecutionLedgerFileFixture, openExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');
const { engineeringDigest } = require('./engineering-task-state');
const { runEngineeringTask, inspectEngineeringTask } = require('./engineering-task-runtime');
const { parseEngineeringTask } = require('./engineering-task-contract');
const { runEngineeringWorkflow, inspectEngineeringWorkflow, parseEngineeringWorkflow } = require('./engineering-workflow-runtime');
const { reviewProjectResult, applyProjectResult } = require('./engineering-workspace');

const commandSchema = z
  .object({
    schema_version: z.literal(1),
    command_id: z.string().uuid(),
    resource_id: z.string().uuid(),
    expected_sequence: z.number().int().nonnegative().safe(),
    action: z.enum(['create', 'create_workflow', 'resume', 'cancel', 'reconcile', 'apply']),
    input: z.record(z.string(), z.json()),
  })
  .strict();
const reconciliationSchema = z
  .object({
    report_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.literal('continue-from-observed-state'),
    answer: z.string().min(1).max(8192),
  })
  .strict();
const inputs = {
  create_workflow: z.object({ definition: z.unknown() }).strict(),
  create: z
    .object({
      contract: z.unknown(),
      responses: z
        .array(z.object({ name: z.string().min(1).max(160), input: z.record(z.string(), z.json()) }).strict())
        .max(64)
        .optional(),
      binding_id: z.string().min(1).max(160).optional(),
    })
    .strict(),
  resume: z
    .object({
      reconciliation_decision: reconciliationSchema.optional(),
      reconciliation_decisions: z.record(z.string().min(1).max(160), reconciliationSchema).optional(),
    })
    .strict(),
  cancel: z.object({}).strict(),
  reconcile: z.object({}).strict(),
  apply: z.object({ review_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
};

class ControlError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

class EngineeringControl {
  constructor({ state, workspaces = [], bindings = {} } = {}) {
    this.handle = state ? openExecutionLedgerFileFixture(path.resolve(state)) : createExecutionLedgerFileFixture();
    this.ledger = new ExecutionEventLedger(this.handle.db);
    this.workspaces = workspaces.map((root) => fs.realpathSync(root));
    this.bindings = Object.freeze({ ...bindings });
    this.active = new Set();
    this.terminals = new (require('./terminal-control').TerminalControl)(this);
  }
  prepare(value) {
    if (!value || value.schema_version !== 2 || !this.workspaces.includes(value.workspace?.root))
      throw new ControlError('CONTROL_WORKSPACE_DENIED');
    return require('./engineering-workspace').prepareProjectTask(value);
  }
  get state() {
    return this.handle.directory;
  }
  close() {
    if (this.active.size > 0 || this.terminals.active.size > 0 || this.terminals.inflight.size > 0)
      throw new ControlError('CONTROL_EXECUTION_ACTIVE');
    this.handle.close();
  }
  rows(id) {
    z.string().uuid().parse(id);
    return this.ledger.readStream('control_task', id);
  }
  append(id, payload) {
    const rows = this.rows(id);
    return this.ledger.append({
      aggregate_type: 'control_task',
      aggregate_id: id,
      expected_version: rows.length,
      events: [
        {
          event_id: randomUUID(),
          event_type: 'ControlCommandRecorded',
          schema_version: 1,
          occurred_at: new Date().toISOString(),
          correlation_id: id,
          causation_id: rows.at(-1)?.event_id || id,
          actor: { type: 'hseos', id: 'local-control' },
          operation_id: null,
          payload,
          evidence_refs: [],
        },
      ],
    });
  }
  kind(id) {
    return this.rows(id).find((row) => row.payload.kind === 'registered')?.payload.resource_kind || 'task';
  }
  location(id) {
    const row = this.rows(id).find((row) => row.payload.kind === 'registered');
    if (!row) throw new ControlError('CONTROL_TASK_NOT_FOUND');
    return row.payload.state_directory;
  }
  async query(id, action = 'status') {
    if (!['status', 'evidence', 'review', 'session'].includes(action)) throw new ControlError('CONTROL_QUERY_UNKNOWN');
    const workflow = this.kind(id) === 'workflow';
    if (workflow && action === 'review') throw new ControlError('CONTROL_VIEW_UNAVAILABLE');
    const value = await (workflow ? inspectEngineeringWorkflow : inspectEngineeringTask)({
      state: this.location(id),
      action: action === 'review' ? 'evidence' : action === 'session' ? 'status' : action,
    });
    if (action === 'session') {
      const handle = openExecutionLedgerFileFixture(this.location(id));
      try {
        const { RelationalSessionEventStore } = require('../../../packages/agent-session-store');
        const session = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) }).replay(value.session_id);
        return {
          resource_id: id,
          session_id: session.session_id,
          status: session.status,
          current_sequence: session.current_sequence,
          terminal_event: session.terminal_event,
          cancellation_request: session.cancellation_request,
          children: session.children,
        };
      } finally {
        handle.close();
      }
    }
    if (action === 'review') return { resource_id: id, ...reviewProjectResult(value) };
    const { state: _state, ...publicValue } = value;
    return { ...publicValue, resource_id: id };
  }
  events(id, { after = 0, limit = 100 } = {}) {
    const handle = openExecutionLedgerFileFixture(this.location(id));
    try {
      const events = new ExecutionEventLedger(handle.db).readGlobal({ after_position: after, limit });
      return { resource_id: id, events, next_cursor: events.at(-1)?.position || after };
    } finally {
      handle.close();
    }
  }
  async execute(raw) {
    const command = commandSchema.parse(raw);
    const input = inputs[command.action].parse(command.input);
    const digest = engineeringDigest(command);
    let rows = this.rows(command.resource_id);
    const previous = rows.find((row) => row.payload.kind === 'intent' && row.payload.command_id === command.command_id);
    if (previous) {
      if (previous.payload.digest !== digest) throw new ControlError('CONTROL_IDEMPOTENCY_CONFLICT');
      const done = rows.find((row) => row.payload.kind === 'done' && row.payload.command_id === command.command_id);
      if (!done) throw new ControlError('CONTROL_OUTCOME_UNCERTAIN');
      return done.payload.result;
    }
    if (command.action === 'create_workflow') {
      if (rows.length > 0 || command.expected_sequence !== 0) throw new ControlError('CONTROL_SEQUENCE_CONFLICT');
      const { definition } = parseEngineeringWorkflow(input.definition);
      for (const task of definition.tasks) {
        if (task.contract.schema_version !== 2 || !this.workspaces.includes(task.contract.workspace.root))
          throw new ControlError('CONTROL_WORKSPACE_DENIED');
        if (task.binding) throw new ControlError('CONTROL_BINDING_UNKNOWN');
      }
    } else if (command.action === 'create') {
      if (rows.length > 0 || command.expected_sequence !== 0) throw new ControlError('CONTROL_SEQUENCE_CONFLICT');
      const contract = parseEngineeringTask(input.contract);
      if (contract.schema_version !== 2 || !this.workspaces.includes(contract.workspace.root))
        throw new ControlError('CONTROL_WORKSPACE_DENIED');
      if (input.responses && input.binding_id) throw new ControlError('CONTROL_MODEL_CONFLICT');
      if (input.binding_id && !Object.hasOwn(this.bindings, input.binding_id)) throw new ControlError('CONTROL_BINDING_UNKNOWN');
      if (!input.responses && !input.binding_id) throw new ControlError('CONTROL_MODEL_REQUIRED');
    } else {
      const workflow = this.kind(command.resource_id) === 'workflow';
      if ((workflow && input.reconciliation_decision) || (!workflow && input.reconciliation_decisions))
        throw new ControlError('CONTROL_RECONCILIATION_KIND');
      const status = await this.query(command.resource_id);
      if (status.current_sequence !== command.expected_sequence) throw new ControlError('CONTROL_SEQUENCE_CONFLICT');
      rows = this.rows(command.resource_id);
      const pending = rows.filter(
        (row) =>
          row.payload.kind === 'intent' &&
          !rows.some((other) => other.payload.kind === 'done' && other.payload.command_id === row.payload.command_id),
      );
      if (
        pending.length > 0 &&
        !['cancel', 'reconcile'].includes(command.action) &&
        !input.reconciliation_decision &&
        !input.reconciliation_decisions
      )
        throw new ControlError('CONTROL_OUTCOME_UNCERTAIN');
    }
    // Claim before any effect; another client cannot silently repeat an intent.
    this.handle.db.transaction(() => {
      if (this.rows(command.resource_id).length !== rows.length) throw new ControlError('CONTROL_SEQUENCE_CONFLICT');
      this.append(command.resource_id, { kind: 'intent', command_id: command.command_id, digest, action: command.action });
    })();
    this.active.add(command.command_id);
    try {
      let result;
      switch (command.action) {
        case 'create_workflow': {
          const created = await runEngineeringWorkflow({ definition: input.definition, createOnly: true });
          this.append(command.resource_id, { kind: 'registered', resource_kind: 'workflow', state_directory: created.state });
          result = await this.query(command.resource_id);

          break;
        }
        case 'create': {
          const contractFile = path.join(this.state, `${command.command_id}-task.json`);
          fs.writeFileSync(contractFile, JSON.stringify(input.contract), { mode: 0o600, flag: 'wx' });
          let responsesFile;
          if (input.responses) {
            responsesFile = path.join(this.state, `${command.command_id}-responses.json`);
            fs.writeFileSync(responsesFile, JSON.stringify(input.responses), { mode: 0o600, flag: 'wx' });
          }
          const created = await runEngineeringTask({
            taskContract: contractFile,
            scriptedResponses: responsesFile,
            binding: input.binding_id ? this.bindings[input.binding_id] : undefined,
            createOnly: true,
          });
          this.append(command.resource_id, { kind: 'registered', resource_kind: 'task', state_directory: created.state });
          result = await this.query(command.resource_id);

          break;
        }
        case 'apply': {
          const parent = this.terminals.parent(command.resource_id);
          try {
            require('./terminal-budget').assertTerminalsSettled(parent.handle.db, parent.id);
          } finally {
            parent.handle.close();
          }
          if (this.kind(command.resource_id) !== 'task') throw new ControlError('CONTROL_VIEW_UNAVAILABLE');
          const evidence = await inspectEngineeringTask({ state: this.location(command.resource_id), action: 'evidence' });
          result = { resource_id: command.resource_id, ...applyProjectResult(evidence, input.review_sha256) };

          break;
        }
        default: {
          if (command.action === 'cancel' && this.kind(command.resource_id) === 'task')
            await this.terminals.cancelTask(command.resource_id);
          const value = await (this.kind(command.resource_id) === 'workflow' ? inspectEngineeringWorkflow : inspectEngineeringTask)({
            state: this.location(command.resource_id),
            action: command.action,
            expectedSequence: command.expected_sequence,
            reconciliationDecision: input.reconciliation_decision,
            reconciliationDecisions: input.reconciliation_decisions,
          });
          const { state: _state, ...publicValue } = value;
          result = { ...publicValue, resource_id: command.resource_id };
        }
      }
      this.append(command.resource_id, { kind: 'done', command_id: command.command_id, result });
      return result;
    } finally {
      this.active.delete(command.command_id);
    }
  }
}

module.exports = { EngineeringControl, ControlError };
