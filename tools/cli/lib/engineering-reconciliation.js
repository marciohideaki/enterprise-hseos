'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { engineeringDigest } = require('./engineering-task-state');
const { isExecutorOwnerAlive, reapExecutorOwner } = require('../../../packages/agent-isolation-attestation/executor');
const { verifyEngineeringTask } = require('./engineering-project-verifier');
const { accountSessionTokens } = require('../../../packages/agent-context/token-counter');

const hash = (value) => createHash('sha256').update(value).digest('hex');

async function inspectReconciliation(task, assembly, attest) {
  const state = task.read();
  const session = assembly.sessionStore.replay(state.created.session_id);
  const questions = [];
  const unresolved = [];
  let files = null;
  let verification = null;
  let prerequisites = true;
  const ask = (code, question) => {
    unresolved.push(code);
    questions.push(question);
  };
  let ownerAlive = true;
  try {
    ownerAlive = !state.owner || isExecutorOwnerAlive(state.owner);
  } catch {
    ownerAlive = true;
  }
  if (ownerAlive) {
    prerequisites = false;
    ask(
      'owner-not-quiescent',
      'O executor anterior ainda está ativo ou sua identidade não pôde ser comprovada. Deseja aguardar ou cancelar?',
    );
  } else {
    try {
      await reapExecutorOwner(state.owner);
      await attest(assembly.policy, state.created.deadline);
      files = assembly.tools.snapshot();
      verification = await verifyEngineeringTask({
        contract: state.created.contract,
        policy: assembly.policy,
        deadline: state.created.deadline,
      });
      if (engineeringDigest(files) !== engineeringDigest(assembly.tools.snapshot()))
        throw new Error('Workspace changed during verification');
    } catch {
      prerequisites = false;
      ask(
        'inspection-incomplete',
        'Não foi possível comprovar isolamento, prazo e estabilidade dos arquivos. Qual mudança no ambiente deve ser investigada antes de continuar?',
      );
    }
  }
  if (state.cancellation || session.cancellation_request || (session.terminal_event && session.status !== 'completed') || state.result) {
    prerequisites = false;
    ask(
      'terminal-or-cancelled',
      'Esta execução já foi encerrada ou cancelada. Deseja inspecionar a evidência e definir uma nova tarefa? O histórico não será reaberto.',
    );
  }
  const expected = new Map(state.created.contract.scope.read.map((name) => [name, null]));
  for (const file of state.created.contract.initial_files) expected.set(file.path, file.sha256);
  const baseline = state.reconciliation?.report;
  if (baseline) for (const file of baseline.files) expected.set(file.path, file.sha256);
  const observed = new Map((files || []).map((file) => [file.path, file]));
  const settlements = [];
  let reserved = 0;
  let uncertainEstimate = 0;
  const partialSteps = [];
  for (const turnId of session.turn_order) {
    const turn = session.turns[turnId];
    for (const step of turn.model_steps) {
      if (!step.model_events.some((event) => ['completed', 'failed'].includes(event.event_type))) {
        partialSteps.push({ turn_id: turnId, step_id: step.step_id });
        uncertainEstimate += Buffer.byteLength(JSON.stringify(step.request)) + step.request.parameters.max_output_tokens;
        ask(
          `model:${step.step_id}`,
          'A resposta do provider foi interrompida. Você autoriza abandonar essa tentativa e continuar a partir do estado observado, debitando conservadoramente seu orçamento?',
        );
        if (step.model_events.some((event) => event.event_type === 'usage'))
          reserved += Buffer.byteLength(JSON.stringify(step.request)) + step.request.parameters.max_output_tokens;
      }
    }
    for (const execution of Object.values(turn.tool_executions)) {
      const pending = !execution.outcome || execution.outcome.status === 'uncertain';
      if (execution.name === 'engineering.write') {
        const post = hash(execution.input.content);
        if (
          !pending &&
          execution.outcome.status === 'succeeded' &&
          (!baseline || execution.completed_event_sequence > baseline.session_sequence)
        )
          expected.set(execution.input.path, post);
        if (pending) {
          const file = observed.get(execution.input.path);
          const applied = file?.sha256 === post;
          const unchanged = file?.sha256 === execution.input.expected_sha256;
          if (!applied && !unchanged)
            ask(
              `write:${execution.invocation_id}`,
              `O arquivo ${execution.input.path} difere tanto do estado anterior quanto da escrita pretendida. Você reconhece e autoriza usar o estado observado como base para continuar?`,
            );
          if (applied) expected.set(execution.input.path, post);
          settlements.push({ execution, status: applied ? 'succeeded' : 'failed', result: file || null, turn_id: turnId });
        }
      } else if (execution.name === 'engineering.patch') {
        if (
          !pending &&
          execution.outcome.status === 'succeeded' &&
          (!baseline || execution.completed_event_sequence > baseline.session_sequence)
        ) {
          const receipt = execution.outcome.result;
          if (receipt?.path !== execution.input.path || typeof receipt.content !== 'string' || hash(receipt.content) !== receipt.sha256)
            throw new Error('Patch receipt does not match its artifact');
          expected.set(receipt.path, receipt.sha256);
        }
        if (pending) {
          const file = observed.get(execution.input.path);
          ask(
            `patch:${execution.invocation_id}`,
            `O recibo do patch no arquivo ${execution.input.path} não foi confirmado. Você autoriza continuar a partir do estado observado sem repetir o patch?`,
          );
          settlements.push({ execution, status: 'failed', result: file || null, turn_id: turnId });
        }
      } else if (pending) {
        if (execution.name !== 'engineering.read')
          ask(
            `command:${execution.invocation_id}`,
            `O resultado da operação ${execution.name} não foi confirmado. Você autoriza registrar a interrupção sem repetir essa operação e continuar a partir dos arquivos verificados?`,
          );
        settlements.push({
          execution,
          status: execution.name === 'engineering.read' ? 'succeeded' : 'failed',
          result: execution.name === 'engineering.read' ? observed.get(execution.input.path) || null : null,
          turn_id: turnId,
        });
      }
    }
  }
  for (const file of files || [])
    if (file.sha256 !== expected.get(file.path) && !questions.some((question) => question.includes(`arquivo ${file.path} `)))
      ask(
        `artifact:${file.path}`,
        `O arquivo ${file.path} mudou em relação aos efeitos registrados. Você reconhece essa alteração e autoriza continuar com o estado observado?`,
      );
  const accounting = accountSessionTokens(session);
  const projectedTotal = accounting.total_tokens + uncertainEstimate;
  if (projectedTotal >= state.created.contract.limits.max_tokens) {
    prerequisites = false;
    ask(
      'budget-exhausted',
      'O orçamento original não comporta continuidade após contabilizar a tentativa interrompida. Deseja encerrar e definir uma nova tarefa?',
    );
  }
  const report = {
    schema_version: 1,
    task_run_id: task.id,
    task_sequence: state.version,
    contract_sha256: state.created.contract_sha256,
    session_id: session.session_id,
    session_sequence: session.current_sequence,
    files,
    files_sha256: files ? engineeringDigest(files) : null,
    verification,
    deadline: state.created.deadline,
    token_accounting: accounting,
    uncertain_usage_estimate_tokens: uncertainEstimate,
    projected_total_tokens: projectedTotal,
    additional_reserved_tokens: reserved,
    prerequisites_verified: prerequisites,
    questions,
    unresolved,
    pending_operations: settlements.map(({ execution, status }) => ({
      invocation_id: execution.invocation_id,
      name: execution.name,
      resolved_status: status,
    })),
    interrupted_model_steps: partialSteps,
  };
  return { report: { ...report, sha256: engineeringDigest(report) }, settlements, session, reserved };
}

function applyReconciliation(task, assembly, inspected, decision) {
  const { report, settlements, session, reserved } = inspected;
  if (!report.prerequisites_verified) throw new Error('Reconciliation prerequisites remain unverified');
  if (
    report.questions.length > 0 &&
    (!decision ||
      decision.report_sha256 !== report.sha256 ||
      decision.decision !== 'continue-from-observed-state' ||
      typeof decision.answer !== 'string' ||
      !decision.answer.trim())
  )
    throw new Error('Explicit answers bound to the current reconciliation report are required');
  if (decision && decision.report_sha256 !== report.sha256) throw new Error('Reconciliation decision is stale');
  if (
    task.read().version !== report.task_sequence ||
    engineeringDigest(assembly.tools.snapshot()) !== report.files_sha256 ||
    assembly.sessionStore.replay(session.session_id).current_sequence !== report.session_sequence
  )
    throw new Error('State changed after reconciliation');
  const append = (event_type, payload) => {
    const current = assembly.sessionStore.replay(session.session_id);
    assembly.sessionStore.append({
      session_id: session.session_id,
      expected_version: current.current_sequence,
      events: [
        {
          schema_version: 1,
          event_id: `event:${randomUUID()}`,
          session_id: session.session_id,
          sequence: current.current_sequence + 1,
          occurred_at: new Date().toISOString(),
          event_type,
          payload,
        },
      ],
    });
  };
  task.append({ kind: 'reconciliation', report, decision: decision || null }, task.read().version);
  if (session.status === 'completed') return null;
  for (const { execution, status, turn_id: turnId } of settlements) {
    const outcome = {
      schema_version: 1,
      invocation_id: execution.invocation_id,
      session_id: session.session_id,
      turn_id: turnId,
      tool_call_id: execution.tool_call_id,
      name: execution.name,
      status: 'failed',
      operation_id: null,
      result: null,
      error: {
        code: status === 'succeeded' ? 'RECONCILED_EFFECT_CONFIRMED' : 'RECONCILED_INTERRUPTION',
        message:
          'Original execution receipt was lost. No operation was replayed. Use the independently observed state supplied in the reconciliation input.',
        retryable: false,
      },
      evidence_refs: [`reconciliation://${report.sha256}`],
      warnings: ['Outcome reconstructed from independently inspected current state; not a provider completion receipt.'],
      replayed: false,
    };
    append(execution.outcome ? 'tool.execution.reconciled' : 'tool.execution.completed', {
      turn_id: turnId,
      step_id: execution.step_id,
      outcome,
    });
  }
  for (const partial of report.interrupted_model_steps) {
    const step = assembly.sessionStore.replay(session.session_id).turns[partial.turn_id].model_steps_by_id[partial.step_id];
    append('model.streamed', {
      ...partial,
      provider_id: step.request.provider_id,
      event: {
        schema_version: 1,
        provider_id: step.request.provider_id,
        request_id: step.request.request_id,
        event_type: 'failed',
        sequence: step.model_events.length,
        payload: {
          error_code: 'protocol_error',
          message: 'Interrupted request abandoned after explicit reconciliation; never replayed.',
          retryable: false,
        },
      },
    });
  }
  append('session.reconciled', { report_sha256: report.sha256, reserved_tokens: reserved });
  return {
    role: 'user',
    content: JSON.stringify({
      source: 'verified-reconciliation',
      report_sha256: report.sha256,
      instruction:
        'Continue the original task from the independently inspected current state. Previous uncertain operations were settled without replay. Diagnose remaining work before acting. Preserve all original instructions, acceptance criteria and budgets. Ask the user if any new uncertainty remains.',
      files: report.files,
      files_sha256: report.files_sha256,
      verification: report.verification,
      answer: decision?.answer || null,
    }),
  };
}

function readReconciliationDecision(filename, multiple = false) {
  const fs = require('node:fs');
  const { z } = require('zod');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16_384) throw new Error('Invalid reconciliation decision file');
    const bytes = Buffer.alloc(16_385);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== stat.size) throw new Error('Reconciliation decision changed');
    const decision = z
      .object({
        report_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        decision: z.literal('continue-from-observed-state'),
        answer: z.string().trim().min(1).max(8192),
      })
      .strict();
    return (multiple ? z.record(z.string(), decision) : decision).parse(JSON.parse(bytes.subarray(0, count).toString('utf8')));
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { inspectReconciliation, applyReconciliation, readReconciliationDecision };
