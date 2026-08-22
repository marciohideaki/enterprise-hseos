'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  IdentifierSchema,
  ReferenceSchema,
  SemverSchema,
  TimestampSchema,
  strictObject,
  uniqueEnumArray,
  z,
} = require('./common');
const { AgentMessageSchema, AgentSessionSpecSchema } = require('./agent-contracts');

const UniqueIdsSchema = z.array(IdentifierSchema).min(1).max(256).superRefine((values, context) => {
  if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: 'identifiers must be unique' });
});

const SubagentProviderManifestSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  provider_version: SemverSchema,
  capabilities: uniqueEnumArray(z.enum(['spawn', 'join', 'cancel']), 3),
  max_parallel_children: z.number().int().positive().max(256),
});

const SubagentSpawnInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  request_id: IdentifierSchema,
  parent_session_id: IdentifierSchema,
  parent_sequence: z.number().int().positive(),
  child_spec: AgentSessionSpecSchema,
  turn_id: IdentifierSchema,
  message: AgentMessageSchema,
  occurred_at: TimestampSchema,
}).superRefine((input, context) => {
  if (input.child_spec.parent_session_id !== input.parent_session_id) {
    context.addIssue({ code: 'custom', path: ['child_spec', 'parent_session_id'], message: 'child spec must name the parent' });
  }
  if (input.message.role !== 'user') context.addIssue({ code: 'custom', path: ['message', 'role'], message: 'child input must be user-authored' });
});

const SubagentSpawnResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  request_id: IdentifierSchema,
  parent_session_id: IdentifierSchema,
  child_session_id: IdentifierSchema,
  accepted: z.boolean(),
  terminal: z.boolean(),
  event_refs: z.array(ReferenceSchema).min(1),
});

const SubagentJoinInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  request_id: IdentifierSchema,
  parent_session_id: IdentifierSchema,
  child_session_ids: UniqueIdsSchema,
  timeout_ms: z.number().int().positive().max(3_600_000),
});

const SubagentCancelInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  request_id: IdentifierSchema,
  parent_session_id: IdentifierSchema,
  child_session_ids: UniqueIdsSchema,
  reason: z.string().min(1).max(2048),
});

const ChildTerminalSchema = strictObject({
  child_session_id: IdentifierSchema,
  status: z.enum(['completed', 'failed', 'cancelled']),
  outcome_ref: ReferenceSchema,
});

const SubagentSettleResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  provider_id: IdentifierSchema,
  request_id: IdentifierSchema,
  parent_session_id: IdentifierSchema,
  all_terminal: z.literal(true),
  children: z.array(ChildTerminalSchema).min(1).max(256),
  evidence_refs: z.array(ReferenceSchema),
});

const SubagentDisposeInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  request_id: IdentifierSchema,
  provider_id: IdentifierSchema,
  reason: z.string().min(1).max(2048),
});

const WorkflowStepSchema = strictObject({
  step_id: IdentifierSchema,
  child_spec: AgentSessionSpecSchema,
  turn_id: IdentifierSchema,
  message: AgentMessageSchema,
}).superRefine((step, context) => {
  if (step.message.role !== 'user') context.addIssue({ code: 'custom', path: ['message', 'role'], message: 'workflow step input must be user-authored' });
});

const WorkflowPhaseSchema = strictObject({
  phase_id: IdentifierSchema,
  mode: z.enum(['parallel', 'pipeline']),
  steps: z.array(WorkflowStepSchema).min(1).max(256),
}).superRefine((phase, context) => {
  const ids = phase.steps.map((step) => step.step_id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['steps'], message: 'phase step ids must be unique' });
});

const WorkflowDefinitionSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  workflow_id: IdentifierSchema,
  subagent_provider_id: IdentifierSchema,
  max_parallelism: z.number().int().positive().max(256),
  join_timeout_ms: z.number().int().positive().max(3_600_000),
  phases: z.array(WorkflowPhaseSchema).min(1).max(128),
}).superRefine((workflow, context) => {
  const phaseIds = workflow.phases.map((phase) => phase.phase_id);
  const stepIds = workflow.phases.flatMap((phase) => phase.steps.map((step) => step.step_id));
  const childIds = workflow.phases.flatMap((phase) => phase.steps.map((step) => step.child_spec.session_id));
  if (new Set(phaseIds).size !== phaseIds.length) context.addIssue({ code: 'custom', path: ['phases'], message: 'phase ids must be unique' });
  if (new Set(stepIds).size !== stepIds.length) context.addIssue({ code: 'custom', path: ['phases'], message: 'workflow step ids must be globally unique' });
  if (new Set(childIds).size !== childIds.length) context.addIssue({ code: 'custom', path: ['phases'], message: 'workflow child session ids must be unique' });
  if (stepIds.length > 4096) context.addIssue({ code: 'custom', path: ['phases'], message: 'workflow exceeds the global step bound' });
});

const WorkflowRunInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  engine_id: IdentifierSchema,
  request_id: IdentifierSchema,
  parent_session_id: IdentifierSchema,
  workflow: WorkflowDefinitionSchema,
  occurred_at: TimestampSchema,
  resume_from_ref: ReferenceSchema.optional(),
});

const WorkflowCancelInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  engine_id: IdentifierSchema,
  request_id: IdentifierSchema,
  parent_session_id: IdentifierSchema,
  workflow_id: IdentifierSchema,
  reason: z.string().min(1).max(2048),
});

const WorkflowDisposeInputSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  engine_id: IdentifierSchema,
  request_id: IdentifierSchema,
  reason: z.string().min(1).max(2048),
});

const WorkflowPhaseResultSchema = strictObject({
  phase_id: IdentifierSchema,
  mode: z.enum(['parallel', 'pipeline']),
  child_session_ids: UniqueIdsSchema,
  checkpoint_ref: ReferenceSchema,
});

const WorkflowResultSchema = strictObject({
  schema_version: z.literal(CONTRACT_SCHEMA_VERSION),
  engine_id: IdentifierSchema,
  request_id: IdentifierSchema,
  parent_session_id: IdentifierSchema,
  workflow_id: IdentifierSchema,
  status: z.enum(['completed', 'cancelled', 'failed']),
  phases: z.array(WorkflowPhaseResultSchema).max(128),
  children: z.array(ChildTerminalSchema).max(256),
  evidence_refs: z.array(ReferenceSchema),
}).superRefine((result, context) => {
  const childIds = result.children.map((child) => child.child_session_id);
  if (new Set(childIds).size !== childIds.length) context.addIssue({ code: 'custom', path: ['children'], message: 'workflow child results must be unique' });
  if (result.status === 'completed') {
    const phaseIds = result.phases.flatMap((phase) => phase.child_session_ids);
    if (JSON.stringify(phaseIds) !== JSON.stringify(childIds)) {
      context.addIssue({ code: 'custom', message: 'completed workflow phases and child results must have exact ordered identity' });
    }
  }
});

module.exports = {
  ChildTerminalSchema,
  SubagentCancelInputSchema,
  SubagentDisposeInputSchema,
  SubagentJoinInputSchema,
  SubagentProviderManifestSchema,
  SubagentSettleResultSchema,
  SubagentSpawnInputSchema,
  SubagentSpawnResultSchema,
  WorkflowCancelInputSchema,
  WorkflowDefinitionSchema,
  WorkflowDisposeInputSchema,
  WorkflowPhaseResultSchema,
  WorkflowPhaseSchema,
  WorkflowResultSchema,
  WorkflowRunInputSchema,
  WorkflowStepSchema,
};
