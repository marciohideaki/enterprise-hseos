'use strict';

const CANDIDATE_PROFILE = 'agent-openai-compatible-candidate';
const CODEX_DELEGATED_PROFILE = 'agent-codex-delegated-candidate';
const CLAUDE_DELEGATED_PROFILE = 'agent-claude-delegated-candidate';
const DEEPSEEK_ONE_SHOT_PROFILE = 'agent-deepseek-one-shot-candidate';

const { readEngineeringTask } = require('../lib/engineering-task-contract');

const ACTIONS = new Set(['run', 'resume', 'cancel', 'validate-task', 'status', 'evidence', 'reconcile']);
const REFERENCE_PROFILE = 'agent-reference';
const PROFILES = new Set([
  REFERENCE_PROFILE,
  CANDIDATE_PROFILE,
  CODEX_DELEGATED_PROFILE,
  CLAUDE_DELEGATED_PROFILE,
  DEEPSEEK_ONE_SHOT_PROFILE,
]);

function integer(value, label) {
  if (value === undefined) return;
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a safe integer`);
  return parsed;
}

function render(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(
    [
      `profile: ${result.profile}`,
      `operation: ${result.operation}`,
      `status: ${result.status}`,
      result.task_result ? `task-result: ${result.task_result}` : null,
      `session: ${result.session_id}`,
      `sequence: ${result.current_sequence}`,
      `state: ${result.state}`,
      result.world_state ? `world-state: ${result.world_state}` : null,
      result.output ? `output: ${result.output}` : null,
      ...(result.questions || []).map((question) => `Pergunta pendente: ${question}`),
      result.reconciliation ? `reconciliation-sha256: ${result.reconciliation.sha256}` : null,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

async function execute(action, options = {}) {
  if (options.reconciliationDecision && action !== 'resume') throw new Error('Reconciliation decisions apply only to resume');
  if (!ACTIONS.has(action)) throw new Error(`Unsupported agent action: ${action}. Expected one of: ${[...ACTIONS].join(', ')}`);
  if (action === 'validate-task') {
    if (!options.taskContract || Object.keys(options).some((key) => !['taskContract', 'json'].includes(key))) {
      throw new Error('validate-task requires --task-contract and accepts only --json as an additional option.');
    }
    const { contract, sha256 } = readEngineeringTask(options.taskContract);
    const result = {
      schema_version: 1,
      task_id: contract.task_id,
      contract_sha256: sha256,
      status: 'structurally-valid',
      execution_authorized: false,
      verifier_attested: false,
    };
    process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : `Task contract: ${result.status}; execution is not authorized.\n`);
    return result;
  }
  if (options.taskContract && action === 'run') {
    if (Object.keys(options).some((key) => !['taskContract', 'scriptedResponses', 'binding', 'createOnly', 'json'].includes(key))) {
      throw new Error(
        'Engineering runs accept only task contract, one model source (binding or scripted responses), create-only and JSON options.',
      );
    }
    const result = await require('../lib/engineering-task-runtime').runEngineeringTask(options);
    render(result, options.json === true);
    return result;
  }
  if (options.profile === 'disposable-engineering-candidate' && ['status', 'resume', 'cancel', 'evidence', 'reconcile'].includes(action)) {
    if (
      !options.state ||
      Object.keys(options).some((key) => !['profile', 'state', 'expectedSequence', 'reconciliationDecision', 'json'].includes(key))
    ) {
      throw new Error('Engineering status/resume/cancel requires state and accepts expected-sequence and JSON only.');
    }
    const result = await require('../lib/engineering-task-runtime').inspectEngineeringTask({
      state: options.state,
      action,
      expectedSequence: integer(options.expectedSequence, '--expected-sequence'),
      reconciliationDecision: options.reconciliationDecision
        ? require('../lib/engineering-reconciliation').readReconciliationDecision(options.reconciliationDecision)
        : undefined,
    });
    render(result, options.json === true || action === 'evidence');
    return result;
  }
  if (['status', 'evidence'].includes(action)) throw new Error('Status requires the disposable engineering profile.');
  if (options.taskContract || options.scriptedResponses) throw new Error('Engineering inputs require agent run --task-contract.');
  const profile = options.profile || REFERENCE_PROFILE;
  if (!PROFILES.has(profile)) throw new Error(`Unsupported agent profile: ${profile}. Expected one of: ${[...PROFILES].join(', ')}`);
  if (profile === DEEPSEEK_ONE_SHOT_PROFILE) {
    const { runSupervisedDelegatedDeepSeek } = require('../lib/delegated-deepseek-supervisor');
    if (action !== 'run') throw new Error(`The ${DEEPSEEK_ONE_SHOT_PROFILE} profile supports only agent run`);
    if (!options.binding) throw new Error('--binding is required for a delegated DeepSeek one-shot run');
    if (options.createOnly) throw new Error('--create-only is unavailable for the delegated DeepSeek one-shot profile');
    if (options.state || options.value) throw new Error('--state and --value are unavailable for the delegated DeepSeek one-shot profile');
    const result = await runSupervisedDelegatedDeepSeek({
      binding: options.binding,
      environment: options.environment,
      message: options.message,
      projectDir: options.directory,
      sessionId: options.session,
    });
    render(result, options.json === true);
    return result;
  }
  if (profile === CLAUDE_DELEGATED_PROFILE) {
    const { cancelDelegatedClaude, resumeDelegatedClaude, runDelegatedClaude } = require('../lib/delegated-claude-runtime');
    if (options.directory || options.value) throw new Error('--directory and --value are not valid for the delegated Claude profile');
    if (action === 'run' && !options.binding) throw new Error('--binding is required for a new delegated Claude run');
    if (action !== 'run' && options.binding) throw new Error('--binding is only valid for a new delegated Claude run');
    if (action !== 'run' && !options.state) throw new Error(`--state is required for agent ${action}`);
    const delegatedOptions =
      action === 'run'
        ? { binding: options.binding, createOnly: options.createOnly === true, message: options.message, sessionId: options.session }
        : action === 'resume'
          ? {
              expectedSequence: integer(options.expectedSequence, '--expected-sequence'),
              message: options.message,
              state: options.state,
            }
          : { reason: options.reason, state: options.state };
    const result =
      action === 'run'
        ? await runDelegatedClaude(delegatedOptions)
        : action === 'resume'
          ? await resumeDelegatedClaude(delegatedOptions)
          : await cancelDelegatedClaude(delegatedOptions);
    render(result, options.json === true);
    return result;
  }
  if (profile === CODEX_DELEGATED_PROFILE) {
    const { runDelegatedCodex } = require('../lib/delegated-codex-runtime');
    if (action !== 'run') throw new Error(`The ${CODEX_DELEGATED_PROFILE} profile supports only agent run`);
    if (options.directory || options.value) throw new Error('--directory and --value are not valid for the delegated Codex profile');
    if (!options.binding) throw new Error('--binding is required for a new delegated Codex run');
    if (options.createOnly) throw new Error('--create-only is unavailable for the delegated Codex run-only profile');
    if (options.state) throw new Error('--state is unavailable for the delegated Codex run-only profile');
    const result = await runDelegatedCodex({ binding: options.binding, message: options.message, sessionId: options.session });
    render(result, options.json === true);
    return result;
  }
  if (profile === CANDIDATE_PROFILE) {
    const { runSupervisedBoundKernel } = require('../lib/bound-kernel-supervisor');
    if (action === 'run' && !options.binding) throw new Error('--binding is required for the OpenAI-compatible candidate');
    if (action !== 'run' && options.binding) throw new Error('--binding is only valid for a new candidate run');
    if (action !== 'run' && !options.state) throw new Error(`--state is required for agent ${action}`);
    const supervisedOptions =
      action === 'run'
        ? {
            bindingPath: options.binding,
            createOnly: options.createOnly === true,
            message: options.message,
            projectDir: options.directory,
            sessionId: options.session,
            value: options.value,
          }
        : action === 'resume'
          ? {
              expectedSequence: integer(options.expectedSequence, '--expected-sequence'),
              message: options.message,
              projectDir: options.directory,
              state: options.state,
            }
          : { projectDir: options.directory, reason: options.reason, state: options.state };
    const result = await runSupervisedBoundKernel(action, supervisedOptions);
    render(result, options.json === true);
    return result;
  }
  if (options.binding || options.directory) throw new Error('--binding and --directory are only valid for the candidate profile');
  const { cancelReferenceAgent, resumeReferenceAgent, runReferenceAgent } = require('../lib/reference-agent-runtime');
  let result;
  if (action === 'run') {
    if (options.state) throw new Error('--state is only valid for agent resume or agent cancel');
    result = await runReferenceAgent({
      createOnly: options.createOnly === true,
      message: options.message,
      sessionId: options.session,
      value: options.value,
    });
  } else if (action === 'resume') {
    if (!options.state) throw new Error('--state is required for agent resume');
    result = await resumeReferenceAgent({
      expectedSequence: integer(options.expectedSequence, '--expected-sequence'),
      message: options.message,
      state: options.state,
    });
  } else {
    if (!options.state) throw new Error('--state is required for agent cancel');
    result = await cancelReferenceAgent({ reason: options.reason, state: options.state });
  }
  render(result, options.json === true);
  return result;
}

module.exports = {
  command: 'agent <action>',
  description: 'Agent actions: run, resume, cancel, validate-task, status, evidence, reconcile',
  options: [
    ['--task-contract <path>', 'Versioned disposable engineering contract for validation or candidate execution'],
    ['--scripted-responses <path>', 'Bounded keyless model responses for deterministic engineering fixtures'],
    ['--profile <id>', `Agent profile (default: ${REFERENCE_PROFILE})`],
    ['--binding <path>', 'Immutable provider binding for a new OpenAI-compatible candidate run'],
    ['--directory <path>', 'Project directory containing the required sandbox configuration'],
    ['--state <path>', 'Temporary state directory returned by agent run'],
    ['--session <id>', 'Session id for a new reference run'],
    ['--message <text>', 'User message for run or resume'],
    ['--value <text>', 'Deterministic external state value for a new run'],
    ['--create-only', 'Create a resumable session without starting a turn'],
    ['--expected-sequence <number>', 'Required optimistic sequence for resume'],
    ['--reason <text>', 'Cancellation reason'],
    ['--reconciliation-decision <path>', 'Explicit answers bound to the current reconciliation report'],
    ['--json', 'Emit one JSON object'],
  ],
  async action(action, options) {
    const result = await execute(action, options);
    if (
      result.task_result === 'blocked' ||
      (result.task_result &&
        !['approved'].includes(result.task_result) &&
        action !== 'cancel' &&
        !['status', 'evidence', 'reconcile'].includes(action) &&
        !options.createOnly) ||
      result.status === 'failed' ||
      (result.status === 'cancelled' && action !== 'cancel')
    ) {
      process.exitCode = 1;
    }
    return result;
  },
  execute,
};
