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
export class ControlClient {
  constructor(options: { url: string; credential: string; fetchImpl?: typeof fetch });
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
  events(
    resourceId: string,
    options?: { after?: number; limit?: number },
  ): Promise<{ resource_id: string; events: Record<string, unknown>[]; next_cursor: number }>;
}
