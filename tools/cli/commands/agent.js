'use strict';

const { cancelReferenceAgent, resumeReferenceAgent, runReferenceAgent } = require('../lib/reference-agent-runtime');
const { CANDIDATE_PROFILE } = require('../../lib/agentic-activation-rehearsal');
const { runSupervisedBoundKernel } = require('../lib/bound-kernel-supervisor');
const {
  PROFILE_ID: CODEX_DELEGATED_PROFILE,
  cancelDelegatedCodex,
  resumeDelegatedCodex,
  runDelegatedCodex,
} = require('../lib/delegated-codex-runtime');
const {
  PROFILE_ID: CLAUDE_DELEGATED_PROFILE,
  cancelDelegatedClaude,
  resumeDelegatedClaude,
  runDelegatedClaude,
} = require('../lib/delegated-claude-runtime');

const ACTIONS = new Set(['run', 'resume', 'cancel']);
const REFERENCE_PROFILE = 'agent-reference';
const PROFILES = new Set([REFERENCE_PROFILE, CANDIDATE_PROFILE, CODEX_DELEGATED_PROFILE, CLAUDE_DELEGATED_PROFILE]);

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
      `session: ${result.session_id}`,
      `sequence: ${result.current_sequence}`,
      `state: ${result.state}`,
      result.world_state ? `world-state: ${result.world_state}` : null,
      result.output ? `output: ${result.output}` : null,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

async function execute(action, options = {}) {
  if (!ACTIONS.has(action)) throw new Error(`Unsupported agent action: ${action}. Expected one of: ${[...ACTIONS].join(', ')}`);
  const profile = options.profile || REFERENCE_PROFILE;
  if (!PROFILES.has(profile)) throw new Error(`Unsupported agent profile: ${profile}. Expected one of: ${[...PROFILES].join(', ')}`);
  if (profile === CLAUDE_DELEGATED_PROFILE) {
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
    if (options.directory || options.value) throw new Error('--directory and --value are not valid for the delegated Codex profile');
    if (action === 'run' && !options.binding) throw new Error('--binding is required for a new delegated Codex run');
    if (action !== 'run' && options.binding) throw new Error('--binding is only valid for a new delegated Codex run');
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
        ? await runDelegatedCodex(delegatedOptions)
        : action === 'resume'
          ? await resumeDelegatedCodex(delegatedOptions)
          : await cancelDelegatedCodex(delegatedOptions);
    render(result, options.json === true);
    return result;
  }
  if (profile === CANDIDATE_PROFILE) {
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
  description: 'Run, resume, or cancel a temporary HSEOS Agent Kernel profile',
  options: [
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
    ['--json', 'Emit one JSON object'],
  ],
  action: execute,
  execute,
};
