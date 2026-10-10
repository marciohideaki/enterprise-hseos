'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { deepFreeze, IdentifierSchema } = require('../../../packages/agent-runtime-contracts');
const { canonicalize } = require('../../../packages/managed-governance-contracts/canonical-json');
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
      responses_from: z
        .object({
          ref: z.string().regex(/^campaign:\/\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/),
          binding_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .optional(),
      binding_id: z.string().min(1).max(160).optional(),
      plugin_model: z.object({ selection_id: IdentifierSchema, campaign_id: z.string().uuid() }).strict().optional(),
      extension_ids: z
        .array(IdentifierSchema)
        .max(128)
        .refine((ids) => new Set(ids).size === ids.length)
        .optional(),
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

function parseCreationInput(action, value) {
  if (!['create', 'create_workflow'].includes(action)) throw new ControlError('CONTROL_COMMAND_UNKNOWN');
  const input = inputs[action].parse(value);
  if (action === 'create') {
    const contract = parseEngineeringTask(input.contract);
    if (contract.schema_version !== 2) throw new ControlError('CONTROL_WORKSPACE_DENIED');
    if ([input.responses, input.responses_from, input.binding_id, input.plugin_model].filter(Boolean).length > 1)
      throw new ControlError('CONTROL_MODEL_CONFLICT');
    if (!input.responses && !input.responses_from && !input.binding_id && !input.plugin_model)
      throw new ControlError('CONTROL_MODEL_REQUIRED');
    return { ...input, contract };
  }
  const { definition } = parseEngineeringWorkflow(input.definition);
  for (const task of definition.tasks) {
    if (task.contract.schema_version !== 2) throw new ControlError('CONTROL_WORKSPACE_DENIED');
    if (task.binding) throw new ControlError('CONTROL_BINDING_UNKNOWN');
  }
  return { definition };
}

class ControlError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

class EngineeringControl {
  constructor({ state, workspaces = [], bindings = {}, providerBindings = {}, providerAuthorizations = {}, extensionCatalog = {} } = {}) {
    this.handle = state ? openExecutionLedgerFileFixture(path.resolve(state)) : createExecutionLedgerFileFixture();
    try {
      this.ledger = new ExecutionEventLedger(this.handle.db);
      this.workspaces = workspaces.map((root) => fs.realpathSync(root));
      this.bindings = Object.freeze({ ...bindings });
      this.extensionCatalog = deepFreeze(JSON.parse(canonicalize(extensionCatalog)));
      this.active = new Set();
      this.jobs = new (require('./job-control').JobControl)(this);
      this.terminals = new (require('./terminal-control').TerminalControl)(this);
      this.providerCampaigns = new (require('./provider-campaign-control').ProviderCampaignControl)(this, providerBindings, {
        authorizations: providerAuthorizations,
      });
    } catch (error) {
      this.handle.close();
      throw error;
    }
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
    if (
      this.active.size > 0 ||
      this.jobs.dispatcher.active > 0 ||
      this.terminals.active.size > 0 ||
      this.terminals.inflight.size > 0 ||
      this.providerCampaigns.drains.size > 0
    )
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
    const jobView = require('./job-materialization').resolveJobView(this, id);
    if (jobView) {
      if (action === 'review') throw new ControlError('CONTROL_VIEW_UNAVAILABLE');
      const { RelationalSessionEventStore } = require('../../../packages/agent-session-store');
      const store = new RelationalSessionEventStore({ ledger: this.ledger });
      const value = jobView.manifest
        ? require('./engineering-workflow-runtime').readEngineeringWorkflowView(jobView.handle, jobView.manifest, store)
        : require('./engineering-task-runtime').readEngineeringTaskView(jobView.handle, id, action === 'evidence');
      if (action === 'session') {
        const session = store.replay(value.session_id);
        return {
          resource_id: id,
          session_id: session.session_id,
          status: session.status,
          current_sequence: session.current_sequence,
          terminal_event: session.terminal_event,
          cancellation_request: session.cancellation_request,
          children: session.children,
        };
      }
      const { state: _state, ...publicValue } = value;
      return { ...publicValue, resource_id: id };
    }
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
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new ControlError('CONTROL_QUERY_INVALID');
    const jobView = require('./job-materialization').resolveJobView(this, id);
    if (jobView) {
      const plan = jobView.state.materialization.plan;
      const tasks = jobView.manifest ? plan.tasks : plan.tasks.filter((entry) => entry.task_run_id === id);
      const aggregates = new Set([
        id,
        ...tasks.flatMap((entry) => [entry.task_run_id, entry.created.session_id]),
        ...(jobView.manifest ? [plan.manifest.parent_session_id] : []),
      ]);
      // A shared control ledger contains unrelated resources; never return those rows.
      const batch = this.ledger.readGlobal({ after_position: after, limit });
      const events = batch.filter((row) => aggregates.has(row.aggregate_id));
      return { resource_id: id, events, next_cursor: batch.at(-1)?.position || after };
    }
    const handle = openExecutionLedgerFileFixture(this.location(id));
    try {
      const events = new ExecutionEventLedger(handle.db).readGlobal({ after_position: after, limit });
      return { resource_id: id, events, next_cursor: events.at(-1)?.position || after };
    } finally {
      handle.close();
    }
  }
  async admitCreation(action, rawInput, resourceId, deadline) {
    const input = parseCreationInput(action, rawInput);
    if (action === 'create_workflow') {
      const { definition } = input;
      for (const task of definition.tasks) {
        if (!this.workspaces.includes(task.contract.workspace.root)) throw new ControlError('CONTROL_WORKSPACE_DENIED');
      }
      return { input: { definition } };
    } else if (action === 'create') {
      const { contract } = input;
      if (!this.workspaces.includes(contract.workspace.root)) throw new ControlError('CONTROL_WORKSPACE_DENIED');
      if (input.binding_id && !Object.hasOwn(this.bindings, input.binding_id)) throw new ControlError('CONTROL_BINDING_UNKNOWN');
      const binding = input.binding_id
        ? require('./engineering-model').validateEngineeringBinding(
            require('../../lib/agent-provider-binding').readProviderBinding(this.bindings[input.binding_id]).binding,
          )
        : undefined;
      let selection, pluginModel;
      if (input.extension_ids?.length || input.plugin_model) {
        selection = require('../../lib/execution-plugin-selection').pinExecutionPluginSelection(this.extensionCatalog, [
          ...(input.extension_ids || []),
          ...(input.plugin_model ? [input.plugin_model.selection_id] : []),
        ]).selection;
        const { createTaskExtensions, taskContextReservations } = require('./engineering-task-extensions');
        if (taskContextReservations(selection) > contract.limits.max_tool_calls)
          throw new ControlError('CONTROL_EXTENSION_BUDGET_EXHAUSTED');
        await createTaskExtensions({
          selection,
          catalog: this.extensionCatalog,
          deadline: deadline ?? Date.now() + contract.limits.max_duration_ms,
          modelSelectionId: input.plugin_model?.selection_id,
        }).close();
        if (input.plugin_model) {
          const model = require('./engineering-plugin-model').prepareTaskPluginModel({
            reference: input.plugin_model,
            selection,
            catalog: this.extensionCatalog,
            campaigns: this.providerCampaigns,
            deadline: deadline ?? Date.now() + contract.limits.max_duration_ms,
            resourceId,
          });
          pluginModel = model.pin;
          await model.close();
        }
      }
      return {
        input: { ...input, contract },
        ...(selection ? { selection } : {}),
        ...(pluginModel ? { plugin_model: pluginModel } : {}),
        ...(binding ? { binding, binding_sha256: engineeringDigest(binding) } : {}),
      };
    }
    throw new ControlError('CONTROL_COMMAND_UNKNOWN');
  }
  async execute(raw) {
    const command = commandSchema.parse(raw);
    require('./job-materialization').assertJobExecutionDenied(this.handle.db, command.resource_id);
    const input = inputs[command.action].parse(command.input);
    const digest = engineeringDigest(command);
    let rows = this.rows(command.resource_id);
    let sourced;
    const previous = rows.find((row) => row.payload.kind === 'intent' && row.payload.command_id === command.command_id);
    if (previous) {
      if (previous.payload.digest !== digest) throw new ControlError('CONTROL_IDEMPOTENCY_CONFLICT');
      const done = rows.find((row) => row.payload.kind === 'done' && row.payload.command_id === command.command_id);
      if (!done) throw new ControlError('CONTROL_OUTCOME_UNCERTAIN');
      return done.payload.result;
    }
    if (command.action === 'create_workflow' || command.action === 'create') {
      if (rows.length > 0 || command.expected_sequence !== 0) throw new ControlError('CONTROL_SEQUENCE_CONFLICT');
      if (this.jobs.rows(command.resource_id).length > 0) throw new ControlError('JOB_RESOURCE_CONFLICT');
      await this.admitCreation(command.action, input, command.resource_id);
      if (command.action === 'create' && input.responses_from) {
        const { contract } = parseCreationInput('create', input);
        sourced = this.providerCampaigns.resolveResponses(input.responses_from, { task_id: contract.task_id });
        this.providerCampaigns.claimEvidence(sourced.source.command_id, command.resource_id, contract.task_id, engineeringDigest(contract));
      }
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
      if (['create', 'create_workflow'].includes(command.action) && this.jobs.rows(command.resource_id).length > 0)
        throw new ControlError('JOB_RESOURCE_CONFLICT');
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
          if (input.responses || sourced) {
            responsesFile = path.join(this.state, `${command.command_id}-responses.json`);
            fs.writeFileSync(responsesFile, JSON.stringify(input.responses || sourced.responses), { mode: 0o600, flag: 'wx' });
          }
          const created = await runEngineeringTask({
            taskContract: contractFile,
            scriptedResponses: responsesFile,
            responseSource: sourced?.source,
            binding: input.binding_id ? this.bindings[input.binding_id] : undefined,
            createOnly: true,
            extensionCatalog: this.extensionCatalog,
            extensionIds: input.extension_ids,
            pluginModel: input.plugin_model,
            campaigns: this.providerCampaigns,
            resourceId: command.resource_id,
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
            extensionCatalog: this.extensionCatalog,
            campaigns: this.providerCampaigns,
            resourceId: command.resource_id,
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

module.exports = { EngineeringControl, ControlError, parseCreationInput };
