export interface CampaignCommand extends Omit<ControlCommand, 'action'> {
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
export interface TerminalCommand extends Omit<ControlCommand, 'action'> {
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
export interface ControlCommand {
  schema_version: 1;
  command_id: string;
  resource_id: string;
  expected_sequence: number;
  action: ControlAction;
  input: Record<string, unknown>;
}
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
export type ControlQueryView = 'status' | 'evidence' | 'review' | 'session';

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
  events(
    resourceId: string,
    options?: { after?: number; limit?: number },
  ): Promise<{ resource_id: string; events: Record<string, unknown>[]; next_cursor: number }>;
}
