'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { z } = require('zod');
const { canonicalJson } = require('../../../packages/agent-session-store');
const { ExecutionEventLedger } = require('../../mcp-project-state/lib/execution-event-ledger');
const { parseEngineeringTask } = require('./engineering-task-contract');

const STATES = ['approved', 'failed', 'blocked', 'not_executed'];
const sha = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const artifact = z.object({ path: z.string(), content: z.string().nullable(), sha256: z.string().nullable() }).strict();
const ownerSchema = z
  .object({ pid: z.number().int().positive(), start_ticks: z.string().regex(/^[0-9]+$/), resource_parent: z.string().optional() })
  .strict();
const diagnosisSchema = z
  .object({
    kind: z.literal('diagnosis'),
    review_step_id: z.string(),
    files_sha256: z.string(),
    cause: z.string().trim().min(1).max(2048),
    correction: z.string().trim().min(1).max(2048),
    requirement_ids: z.array(z.string()).min(1),
  })
  .strict();
const eventSchema = z.discriminatedUnion('kind', [
  diagnosisSchema,
  z.object({ kind: z.literal('uncertainty'), question: z.string().min(1).max(2048) }).strict(),
  z.object({ kind: z.literal('execution_started'), owner: ownerSchema.optional() }).strict(),
  z.object({ kind: z.literal('verification_reclaimed'), owner: ownerSchema }).strict(),
  z.object({ kind: z.literal('execution_reclaimed'), owner: ownerSchema }).strict(),
  z
    .object({
      kind: z.literal('reconciliation'),
      report: z.record(z.string(), z.json()),
      decision: z
        .object({
          report_sha256: z.string().regex(/^[a-f0-9]{64}$/),
          decision: z.literal('continue-from-observed-state'),
          answer: z.string().min(1).max(8192),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('cancellation_requested') }).strict(),
  z
    .object({
      kind: z.literal('review'),
      step_id: z.string(),
      approved: z.boolean(),
      reason: z.string(),
      files_sha256: z.string(),
      correction_requested: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('created'),
      contract: z.unknown(),
      contract_sha256: z.string(),
      session_id: z.string(),
      deadline: z.number().int().positive().safe(),
      binding: z.unknown().optional(),
      extensions: z.unknown().optional(),
      responses: z.array(z.object({ name: z.string().min(1).max(160), input: z.record(z.string(), z.json()) }).strict()).max(64),
    })
    .strict(),
  z.object({ kind: z.literal('snapshot'), files: z.array(artifact), files_sha256: z.string() }).strict(),
  z.object({ kind: z.literal('result'), result: z.enum(STATES), reason: z.string(), evidence: z.record(z.string(), z.json()) }).strict(),
]);

function reduce(state, event) {
  if (state.result || (state.version === 0) !== (event.kind === 'created')) throw new Error('Invalid task lifecycle');
  switch (event.kind) {
    case 'created': {
      parseEngineeringTask(event.contract);
      if (event.extensions !== undefined) {
        require('../../lib/execution-plugin-selection').parseExecutionPluginSelection(event.extensions);
        if (require('./engineering-task-extensions').taskContextReservations(event.extensions) > event.contract.limits.max_tool_calls)
          throw new Error('Context selection exceeds the original task tool budget');
      }
      if (event.binding !== undefined) {
        require('./engineering-model').validateEngineeringBinding(event.binding);
        if (event.responses.length > 0) throw new Error('A task cannot combine bound and scripted models');
      }
      if (sha(event.contract) !== event.contract_sha256) throw new Error('Task contract digest mismatch');
      state.created = event;

      break;
    }
    case 'execution_started': {
      if (state.started || state.cancellation) throw new Error('Task execution is already claimed or cancelled');
      state.started = true;
      state.owner = event.owner || null;

      break;
    }
    case 'reconciliation': {
      const { sha256, ...report } = event.report;
      if (
        !state.started ||
        state.cancellation ||
        sha(report) !== sha256 ||
        report.prerequisites_verified !== true ||
        report.task_sequence !== state.version ||
        report.session_id !== state.created.session_id ||
        report.contract_sha256 !== state.created.contract_sha256 ||
        (report.questions?.length > 0 && (!event.decision || event.decision.report_sha256 !== sha256))
      )
        throw new Error('Reconciliation requires verified current state and explicit answers to uncertainty');
      state.reconciliation = { ...event, review_step_id: state.reviews.at(-1)?.step_id || null };
      break;
    }
    case 'execution_reclaimed': {
      if (!state.reconciliation || state.cancellation) throw new Error('Execution recovery requires reconciliation');
      state.owner = event.owner;
      break;
    }
    case 'verification_reclaimed': {
      if (!state.started || state.cancellation) throw new Error('Task cannot reclaim verification');
      state.owner = event.owner;
      break;
    }
    case 'uncertainty': {
      if (state.uncertainty) throw new Error('An unresolved question already exists');
      state.uncertainty = event;
      break;
    }
    case 'diagnosis': {
      const review = state.reviews.at(-1);
      if (
        !review?.correction_requested ||
        review.step_id !== event.review_step_id ||
        (state.reconciliation?.review_step_id === review.step_id ? state.reconciliation.report.files_sha256 : review.files_sha256) !==
          event.files_sha256 ||
        state.diagnoses.some((entry) => entry.review_step_id === event.review_step_id && entry.files_sha256 === event.files_sha256) ||
        new Set(event.requirement_ids).size !== event.requirement_ids.length ||
        event.requirement_ids.some((id) => !state.created.contract.requirements.some((requirement) => requirement.id === id))
      )
        throw new Error('Diagnosis must bind one protected rejection, observed artifacts and original requirements');
      state.diagnoses.push(event);
      break;
    }
    case 'review': {
      if (
        !state.started ||
        state.cancellation ||
        !state.snapshot ||
        event.files_sha256 !== state.snapshot.files_sha256 ||
        (event.approved && event.correction_requested) ||
        (event.correction_requested &&
          state.reviews.filter((review) => review.correction_requested).length >= state.created.contract.max_failed_corrections)
      )
        throw new Error('Invalid protected review or correction budget');
      state.reviews.push(event);
      break;
    }
    case 'cancellation_requested': {
      if (state.cancellation) throw new Error('Task cancellation is already requested');
      state.cancellation = true;

      break;
    }
    case 'snapshot': {
      const contract = state.created.contract;
      if (!state.started || sha(event.files) !== event.files_sha256) throw new Error('Task snapshot digest or lifecycle mismatch');
      if (
        event.files.length !== contract.scope.read.length ||
        new Set(event.files.map((file) => file.path)).size !== event.files.length ||
        event.files.reduce((sum, file) => sum + Buffer.byteLength(file.content || ''), 0) > contract.max_artifact_bytes
      )
        throw new Error('Invalid task snapshot coverage or budget');
      for (const file of event.files) {
        if (
          !contract.scope.read.includes(file.path) ||
          (file.content === null ? file.sha256 !== null : createHash('sha256').update(file.content).digest('hex') !== file.sha256)
        )
          throw new Error('Invalid task artifact snapshot');
      }
      state.snapshot = event;

      break;
    }
    default: {
      if (event.result === 'approved') {
        const proof = event.evidence;
        if (
          !state.started ||
          state.cancellation ||
          !state.snapshot ||
          proof.schema_version !== 1 ||
          proof.approved !== true ||
          proof.contract_sha256 !== state.created.contract_sha256 ||
          proof.session_id !== state.created.session_id ||
          proof.files_sha256 !== state.snapshot.files_sha256 ||
          proof.verifier_sha256 !== state.created.contract.verifier.sha256 ||
          !/^[a-f0-9]{64}$/.test(proof.isolation_digest || '') ||
          proof.workspace_access !== 'read_only' ||
          proof.descendants_terminated !== true
        )
          throw new Error('Approval lacks bound verification evidence');
      }
      state.result = event;
    }
  }
  state.version++;
  return state;
}

class EngineeringTaskState {
  constructor(db, id) {
    this.ledger = new ExecutionEventLedger(db);
    this.id = id;
  }

  read() {
    const rows = this.ledger.readStream('engineering_task', this.id);
    const state = {
      version: 0,
      created: null,
      snapshot: null,
      result: null,
      started: false,
      cancellation: false,
      owner: null,
      reviews: [],
      diagnoses: [],
    };
    let previousId = this.id;
    for (const row of rows) {
      if (
        row.event_type !== 'EngineeringTaskEventRecorded' ||
        row.schema_version !== 1 ||
        row.stream_sequence !== state.version + 1 ||
        row.correlation_id !== this.id ||
        row.causation_id !== previousId
      )
        throw new Error('Invalid engineering task event sequence');
      reduce(state, eventSchema.parse(row.payload));
      previousId = row.event_id;
    }
    return state;
  }

  append(value, expectedVersion) {
    return this.ledger.db.transaction(() => {
      const event = eventSchema.parse(value);
      if (['execution_started', 'execution_reclaimed'].includes(event.kind))
        require('./terminal-budget').assertTerminalsSettled(this.ledger.db, this.id);
      const state = this.read();
      if (state.version !== expectedVersion) throw new Error('Task evidence concurrency conflict');
      // Validate the entire transition before persistence, using the same reducer as recovery.
      reduce(state, event);
      const previous = this.ledger.readStream('engineering_task', this.id).at(-1);
      return this.ledger.append({
        aggregate_type: 'engineering_task',
        aggregate_id: this.id,
        expected_version: expectedVersion,
        events: [
          {
            event_id: randomUUID(),
            event_type: 'EngineeringTaskEventRecorded',
            schema_version: 1,
            occurred_at: new Date().toISOString(),
            correlation_id: this.id,
            causation_id: previous?.event_id || this.id,
            actor: { type: 'hseos', id: 'engineering-supervisor' },
            operation_id: null,
            payload: event,
            evidence_refs: [],
          },
        ],
      });
    })();
  }
}

module.exports = { EngineeringTaskState, engineeringDigest: sha };
