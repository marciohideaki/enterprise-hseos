export interface CampaignCommand extends Omit<BaseControlCommand, 'action'> {
  action: 'create' | 'run' | 'cancel' | 'reconcile';
}
export interface CampaignStatus {
  resource_id: string;
  current_sequence: number;
  max_requests: number;
  max_cost_microusd: number;
  deadline: number;
  requests: number;
  committed_microusd: number;
  cancelled: boolean;
  unresolved_commands: string[];
  live_commands: string[];
  bindings: string[];
  report_sha256: string;
}
export interface CampaignEvidence {
  schema_version: 1;
  resource_id: string;
  command_id: string;
  task_id: string;
  binding_id: string;
  binding_sha256: string;
  receipt_sha256: string;
  evidence_sha256: string;
  bytes: number;
  text: string;
}
export interface CampaignResponsesSource {
  /** campaign://<campaign_id>/<dispatch command_id> */
  ref: `campaign://${string}/${string}`;
  binding_sha256: string;
}
export type JobAction = 'create' | 'retry' | 'cancel' | 'reconcile' | 'resume';
export interface JobCommand {
  schema_version: 1;
  command_id: string;
  resource_id: string;
  expected_sequence: number;
  action: JobAction;
  input: Record<string, unknown>;
}
export interface JobStatus {
  schema_version: 1;
  resource_id: string;
  current_sequence: number;
  status: string;
  [key: string]: unknown;
}
export type TerminalAction =
  | 'open'
  | 'input'
  | 'resize'
  | 'pause'
  | 'continue'
  | 'interrupt'
  | 'eof'
  | 'terminate'
  | 'recover'
  | 'reconcile';
export interface TerminalCommand extends Omit<BaseControlCommand, 'action'> {
  action: TerminalAction;
}
export interface TerminalStatus {
  resource_id: string;
  task_id: string;
  current_sequence: number;
  mode: 'pty' | 'job';
  status: string;
  descendants_terminated: boolean;
  uncertain_commands: string[];
  outcome_uncertain: boolean;
  report_sha256: string;
}
export type ControlAction = 'create' | 'create_workflow' | 'resume' | 'cancel' | 'reconcile' | 'apply';
export interface BaseControlCommand {
  schema_version: 1;
  command_id: string;
  resource_id: string;
  expected_sequence: number;
  action: ControlAction;
  input: Record<string, unknown>;
}
export interface TaskCreateInput {
  contract: Record<string, unknown>;
  /** Exactly one model source: responses, responses_from, binding_id or plugin_model. */
  responses?: { name: string; input: Record<string, unknown> }[];
  responses_from?: CampaignResponsesSource;
  binding_id?: string;
  plugin_model?: { selection_id: string; campaign_id: string };
  extension_ids?: string[];
}
export interface TaskCreateCommand extends Omit<BaseControlCommand, 'action' | 'input'> {
  action: 'create';
  input: TaskCreateInput;
}
export type ControlCommand = TaskCreateCommand | (Omit<BaseControlCommand, 'action'> & { action: Exclude<ControlAction, 'create'> });
export interface TaskStatus {
  resource_id: string;
  task_run_id: string;
  current_sequence: number;
  task_result: 'approved' | 'failed' | 'blocked' | 'not_executed';
  session_id: string;
  questions: string[];
  [key: string]: unknown;
}
export interface WorkflowStatus {
  resource_id: string;
  workflow_id: string;
  session_id: string;
  current_sequence: number;
  status: string;
  tasks: Record<string, unknown>[];
  questions: string[];
  [key: string]: unknown;
}
/** Authority and provenance of one context source, as recorded by `context.assembled` v2. */
export interface ContextSourceProvenance {
  source_ref: string;
  authority: string | null;
  origin: string | null;
  digest: string | null;
  trust: string | null;
}
export interface ContextProvenance {
  schema_version: 1;
  /** `v1` means no source declared authority; history is read, never rewritten. */
  context_contract: 'v1' | 'v2';
  /** Lineage of the last assembled context, present for v1 sessions too. */
  source_refs: string[];
  sources: ContextSourceProvenance[];
}
/** A signal without a persisted source is null and listed in `unknown_signals`. */
export interface ExecutorSignals {
  schema_version: 1;
  init: null;
  rate_limit: null;
  pids_peak: number | null;
  memory_peak_bytes: number | null;
  unknown_signals: string[];
}
export interface ControlProvenance {
  resource_id: string;
  context_provenance: ContextProvenance;
  executor_signals: ExecutorSignals | null;
}
export type ControlQueryView = 'status' | 'evidence' | 'review' | 'session';

/** Curated cause attached to CONTROL_REQUEST_REJECTED; never contains host paths or raw error text. */
export interface ControlErrorDetail {
  code: string;
  message?: string;
  path?: string;
  field?: string;
}
export interface ControlError extends Error {
  code?: string;
  detail?: ControlErrorDetail;
}

export class ControlClient {
  constructor(options: { url: string; credential: string; fetchImpl?: typeof fetch });
  bindingInspect(bindingId: string): Promise<Record<string, unknown>>;
  campaign(command: CampaignCommand): Promise<Record<string, unknown>>;
  job(command: JobCommand): Promise<JobStatus>;
  jobQuery(resourceId: string): Promise<JobStatus>;
  jobEvents(
    resourceId: string,
    options?: { after?: number; limit?: number },
  ): Promise<{ resource_id: string; events: Record<string, unknown>[]; next_cursor: number }>;
  campaignQuery(resourceId: string): Promise<CampaignStatus>;
  campaignEvents(
    resourceId: string,
    options?: { after?: number; limit?: number },
  ): Promise<{ resource_id: string; events: Record<string, unknown>[]; next_cursor: number }>;
  campaignEvidence(resourceId: string, commandId: string): Promise<CampaignEvidence>;
  terminal(command: TerminalCommand): Promise<Record<string, unknown>>;
  terminalQuery(resourceId: string): Promise<TerminalStatus>;
  terminalEvents(
    resourceId: string,
    options?: { after?: number; limit?: number },
  ): Promise<{ resource_id: string; events: Record<string, unknown>[]; next_cursor: number }>;
  prepare(contract: Record<string, unknown>): Promise<Record<string, unknown>>;
  execute(command: ControlCommand): Promise<Record<string, unknown>>;
  query(resourceId: string, view?: 'status'): Promise<TaskStatus | WorkflowStatus>;
  query(resourceId: string, view: 'evidence' | 'review' | 'session'): Promise<Record<string, unknown>>;
  query(resourceId: string, view: ControlQueryView): Promise<TaskStatus | WorkflowStatus | Record<string, unknown>>;
  provenance(resourceId: string): Promise<ControlProvenance>;
  events(
    resourceId: string,
    options?: { after?: number; limit?: number },
  ): Promise<{ resource_id: string; events: Record<string, unknown>[]; next_cursor: number }>;
}
