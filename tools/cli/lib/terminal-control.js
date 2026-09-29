'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { createIsolationPolicy } = require('../../../packages/agent-isolation-attestation');
const { executorOwner, isExecutorOwnerAlive, reapTerminalGroup } = require('../../../packages/agent-isolation-attestation/executor');
const { startIsolatedTerminal } = require('../../../packages/agent-isolation-attestation/terminal-executor');
const { evaluatePermissionLattice } = require('../../../packages/agent-policy-lattice');
const { openExecutionLedgerFileFixture } = require('../../mcp-project-state/lib/execution-ledger-schema');
const { EngineeringTaskState, engineeringDigest } = require('./engineering-task-state');
const { terminalBudget, recordTerminalBudget } = require('./terminal-budget');

const size = z.number().int().min(1).max(500);
const empty = z.object({}).strict();
const inputs = {
  open: z
    .object({
      task_id: z.string().uuid(),
      command_id: z.string().min(1).max(160),
      mode: z.enum(['pty', 'job']),
      rows: size.default(24),
      cols: size.default(80),
    })
    .strict(),
  input: z
    .object({
      data: z
        .string()
        .max(5464)
        .refine((v) => Buffer.from(v, 'base64').toString('base64') === v && Buffer.from(v, 'base64').length <= 4096),
    })
    .strict(),
  resize: z.object({ rows: size, cols: size }).strict(),
  pause: empty,
  continue: empty,
  interrupt: empty,
  eof: empty,
  terminate: empty,
  recover: empty,
  reconcile: z.object({ report_sha256: z.string().regex(/^[a-f0-9]{64}$/), answer: z.string().trim().min(1).max(8192) }).strict(),
};
const schema = z
  .object({
    schema_version: z.literal(1),
    command_id: z.string().uuid(),
    resource_id: z.string().uuid(),
    expected_sequence: z.number().int().nonnegative().safe(),
    action: z.enum(Object.keys(inputs)),
    input: z.record(z.string(), z.json()),
  })
  .strict();
function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

class TerminalControl {
  constructor(control) {
    this.control = control;
    this.active = new Map();
    this.inflight = new Set();
  }
  rows(id) {
    z.string().uuid().parse(id);
    return this.control.ledger.readStream('control_terminal', id);
  }
  append(id, payload) {
    const rows = this.rows(id);
    this.control.ledger.append({
      aggregate_type: 'control_terminal',
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
          actor: { type: 'hseos', id: 'terminal-control' },
          operation_id: null,
          payload: { schema_version: 1, ...payload },
          evidence_refs: [],
        },
      ],
    });
  }
  query(id) {
    const rows = this.rows(id),
      opened = rows.find((r) => r.payload.kind === 'opened')?.payload;
    if (!opened) reject('CONTROL_TERMINAL_NOT_FOUND');
    const pending = rows.filter(
      (r) =>
        r.payload.kind === 'intent' && !rows.some((v) => v.payload.kind === 'receipt' && v.payload.command_id === r.payload.command_id),
    );
    const reconciled = new Set(rows.filter((r) => r.payload.kind === 'reconciled').flatMap((r) => r.payload.command_ids));
    const unresolved = pending.filter((r) => !reconciled.has(r.payload.command_id)).map((r) => r.payload.command_id);
    const endRow = rows.findLast((r) => r.payload.kind === 'recovered') || rows.findLast((r) => r.payload.kind === 'exited');
    const end = endRow?.payload;
    const uncertainEvent = rows.findLast((r) => ['recovered', 'exited'].includes(r.payload.kind) && r.payload.status === 'uncertain');
    const commands = rows.filter((r) => r.payload.kind === 'receipt').map((r) => r.payload);
    const last = commands.findLast((r) => ['pause', 'continue'].includes(r.action))?.action;
    const ownerLost = !end && !isExecutorOwnerAlive(opened.owner);
    const status = end ? end.status : ownerLost ? 'recovery_required' : last === 'pause' ? 'paused' : 'running';
    const report = {
      resource_id: id,
      task_id: opened.task_id,
      mode: opened.mode,
      current_sequence: rows.length,
      status,
      descendants_terminated: Boolean(end?.descendants_terminated),
      uncertain_commands: unresolved,
      outcome_uncertain:
        ownerLost ||
        unresolved.length > 0 ||
        (Boolean(uncertainEvent) &&
          !rows.some((r) => r.payload.kind === 'reconciled' && r.stream_sequence > uncertainEvent.stream_sequence)),
    };
    return { ...report, report_sha256: engineeringDigest(report) };
  }
  events(id, { after = 0, limit = 100 } = {}) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) reject('CONTROL_QUERY_INVALID');
    this.query(id);
    const rows = this.rows(id)
      .filter((r) => r.stream_sequence > after)
      .slice(0, limit);
    return { resource_id: id, events: rows, next_cursor: rows.at(-1)?.stream_sequence || after };
  }
  parent(taskId) {
    require('./job-materialization').assertJobExecutionDenied(this.control.handle.db, taskId);
    if (this.control.kind(taskId) !== 'task') reject('CONTROL_TERMINAL_PARENT_DENIED');
    const directory = this.control.location(taskId);
    const handle = openExecutionLedgerFileFixture(directory);
    try {
      const { task_run_id: id } = JSON.parse(fs.readFileSync(path.join(directory, 'engineering-task.json'), 'utf8'));
      return { handle, id, task: new EngineeringTaskState(handle.db, id), directory };
    } catch (error) {
      handle.close();
      throw error;
    }
  }
  syncBudget(id) {
    const state = this.query(id);
    if (!state.descendants_terminated) return;
    const parent = this.parent(state.task_id);
    try {
      recordTerminalBudget(parent.handle.db, parent.id, { kind: 'settled', terminal_id: id, uncertain: state.outcome_uncertain });
    } finally {
      parent.handle.close();
    }
  }
  async execute(raw) {
    const command = schema.parse(raw),
      input = inputs[command.action].parse(command.input);
    const { resource_id: id, action, command_id: commandId } = command;
    const digest = engineeringDigest(command);
    const claim = this.control.handle.db
      .transaction(() => {
        const rows = this.rows(id);
        const previous = rows.find((r) => r.payload.kind === 'intent' && r.payload.command_id === commandId);
        if (previous) {
          if (previous.payload.digest !== digest) reject('CONTROL_IDEMPOTENCY_CONFLICT');
          const receipt = rows.find((r) => r.payload.kind === 'receipt' && r.payload.command_id === commandId);
          if (!receipt) reject('CONTROL_OUTCOME_UNCERTAIN');
          return { replay: true, result: receipt.payload.result };
        }
        if (rows.length !== command.expected_sequence) reject('CONTROL_SEQUENCE_CONFLICT');
        if (!['terminate', 'recover', 'reconcile'].includes(action) && rows.filter((r) => r.payload.kind === 'intent').length >= 1024)
          reject('CONTROL_TERMINAL_COMMAND_LIMIT');
        let opened;
        let launchOptions;
        if (action === 'open') {
          if (rows.length > 0) reject('CONTROL_SEQUENCE_CONFLICT');
          const parent = this.parent(input.task_id);
          try {
            parent.handle.db.transaction(() => {
              const state = parent.task.read();
              const controls = this.control.rows(input.task_id);
              if (
                state.started ||
                state.result ||
                state.cancellation ||
                state.uncertainty ||
                controls.some((r) => r.payload.kind === 'intent' && ['resume', 'cancel', 'apply'].includes(r.payload.action))
              )
                reject('CONTROL_TERMINAL_PARENT_BUSY');
              const contract = state.created.contract;
              const declared = contract.commands.find((v) => v.id === input.command_id);
              const allowed = Boolean(declared && contract.schema_version === 2);
              if (
                !evaluatePermissionLattice({
                  rules: [
                    {
                      id: 'terminal:declared-command',
                      source: 'project',
                      stage: allowed ? 'allow' : 'deny',
                      decision: allowed ? 'allow' : 'deny',
                    },
                  ],
                }).dispatch_allowed
              )
                reject('CONTROL_TERMINAL_COMMAND_DENIED');
              const remaining = state.created.deadline - Date.now();
              if (
                remaining < 1 ||
                terminalBudget(parent.handle.db, parent.id).count +
                  require('./engineering-task-extensions').taskContextReservations(state.created.extensions) >=
                  contract.limits.max_tool_calls
              )
                reject('CONTROL_TERMINAL_BUDGET_EXHAUSTED');
              const policy = createIsolationPolicy({
                backend: 'bwrap',
                host_workspace: path.join(parent.directory, 'workspace'),
                main_checkout: parent.directory,
                protected_paths: [path.join(parent.directory, 'engineering-task.json')],
              });
              launchOptions = {
                policy,
                command:
                  declared.runtime === 'node'
                    ? ['/usr/bin/node', '--experimental-strip-types', `./${declared.entrypoint}`, ...declared.args]
                    : ['/usr/bin/python3', '-I', '-B', `./${declared.entrypoint}`, ...declared.args],
                host_node: declared.runtime === 'node',
                mode: input.mode,
                rows: input.rows,
                cols: input.cols,
                timeout_ms: Math.min(300_000, remaining),
                max_output_bytes: contract.max_output_bytes,
              };
              opened = { kind: 'opened', task_id: input.task_id, mode: input.mode, owner: executorOwner() };
              // Reserving before control intent is conservative: a crash spends budget without dispatch.
              recordTerminalBudget(parent.handle.db, parent.id, {
                kind: 'reserved',
                terminal_id: id,
                control_directory: this.control.state,
              });
              this.control.handle.db.transaction(() => {
                this.append(id, opened);
                this.append(id, { kind: 'intent', command_id: commandId, action, digest });
              })();
            })();
          } finally {
            parent.handle.close();
          }
        } else {
          const state = this.query(id);
          if (state.outcome_uncertain && !['recover', 'terminate', 'reconcile'].includes(action)) reject('CONTROL_OUTCOME_UNCERTAIN');
          if (action === 'reconcile') {
            if (!state.descendants_terminated || state.report_sha256 !== input.report_sha256) reject('CONTROL_RECONCILIATION_CONFLICT');
          } else if (!['recover', 'terminate'].includes(action)) {
            if (state.descendants_terminated || this.rows(id).some((r) => r.payload.kind === 'stopping') || !this.active.has(id))
              reject('CONTROL_TERMINAL_NOT_ACTIVE');
            if (action === 'resize' && state.mode !== 'pty') reject('CONTROL_TERMINAL_MODE_DENIED');
          }
        }
        if (action !== 'open') this.append(id, { kind: 'intent', command_id: commandId, action, digest });
        return { launchOptions };
      })
      .immediate();
    if (claim.replay) return claim.result;
    const { launchOptions } = claim;
    this.inflight.add(commandId);
    try {
      let effect = {};
      if (action === 'open') {
        const terminal = startIsolatedTerminal({
          ...launchOptions,
          onPrepared: (group) => {
            this.control.handle.db.transaction(() => {
              if (this.rows(id).some((r) => r.payload.kind === 'stopping')) reject('CONTROL_TERMINAL_STOPPING');
              this.append(id, { kind: 'prepared', group });
            })();
          },
          onOutput: (frame) => this.append(id, { kind: 'output', stream: frame.stream, data: frame.data }),
        });
        this.active.set(id, terminal);
        terminal.completion
          .then(
            (result) => this.append(id, { ...result, kind: 'exited' }),
            () => this.append(id, { kind: 'exited', status: 'uncertain', descendants_terminated: false }),
          )
          .then(() => {
            this.active.delete(id);
            this.syncBudget(id);
          })
          .catch(() => {
            this.active.delete(id);
          });
        effect = await terminal.ready;
      } else if (['recover', 'terminate'].includes(action)) {
        this.append(id, { kind: 'stopping' });
        const terminal = this.active.get(id);
        const evidence = this.rows(id);
        const owner = evidence.find((r) => r.payload.kind === 'opened').payload.owner;
        const group = evidence.find((r) => r.payload.kind === 'prepared')?.payload.group;
        if (terminal) await terminal.terminate().catch(() => {});
        if (group) await reapTerminalGroup(owner, group);
        this.append(id, {
          kind: 'recovered',
          status: action === 'terminate' && terminal ? 'terminated' : 'uncertain',
          descendants_terminated: true,
        });
      } else if (action === 'reconcile') {
        // Preserve all uncertain intents; reconciliation records a decision, never a synthetic receipt.
        const pending = this.rows(id).filter(
          (r) =>
            r.payload.kind === 'intent' &&
            r.payload.command_id !== commandId &&
            !this.rows(id).some((v) => v.payload.kind === 'receipt' && v.payload.command_id === r.payload.command_id),
        );
        this.append(id, {
          kind: 'reconciled',
          report_sha256: input.report_sha256,
          answer: input.answer,
          command_ids: pending.map((r) => r.payload.command_id),
        });
      } else effect = await this.active.get(id).command(action, input);
      const result = { resource_id: id, action, effect };
      this.append(id, { kind: 'receipt', command_id: commandId, action, result });
      this.syncBudget(id);
      return result;
    } finally {
      this.inflight.delete(commandId);
    }
  }
  idsForTask(taskId) {
    return this.control.handle.db
      .prepare("SELECT DISTINCT aggregate_id FROM execution_events WHERE aggregate_type='control_terminal'")
      .all()
      .map((r) => r.aggregate_id)
      .filter((id) => this.query(id).task_id === taskId);
  }
  async cancelTask(taskId) {
    const parent = this.parent(taskId);
    try {
      for (const reservation of terminalBudget(parent.handle.db, parent.id).reservations) {
        if (this.rows(reservation.terminal_id).length === 0)
          recordTerminalBudget(parent.handle.db, parent.id, { kind: 'settled', terminal_id: reservation.terminal_id, uncertain: true });
      }
    } finally {
      parent.handle.close();
    }
    for (const id of this.idsForTask(taskId)) {
      const state = this.query(id);
      if (!state.descendants_terminated)
        await this.execute({
          schema_version: 1,
          command_id: randomUUID(),
          resource_id: id,
          expected_sequence: state.current_sequence,
          action: 'terminate',
          input: {},
        });
    }
  }
  async shutdown() {
    for (const [id, terminal] of this.active) {
      await terminal.terminate();
      this.syncBudget(id);
    }
  }
}
module.exports = { TerminalControl };
