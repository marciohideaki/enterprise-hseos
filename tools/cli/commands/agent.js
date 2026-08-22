'use strict';

const { cancelReferenceAgent, resumeReferenceAgent, runReferenceAgent } = require('../lib/reference-agent-runtime');

const ACTIONS = new Set(['run', 'resume', 'cancel']);

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
  description: 'Run, resume, or cancel the keyless temporary HSEOS reference agent',
  options: [
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
