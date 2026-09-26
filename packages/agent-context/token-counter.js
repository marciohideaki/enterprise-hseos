'use strict';

const { IdentifierSchema, parseContract } = require('../agent-runtime-contracts');

class TokenCounterError extends Error {
  constructor(message, code = 'AGENT_CONTEXT_COUNTER_INVALID', details = {}) {
    super(message);
    this.name = 'TokenCounterError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

class ConservativeUtf8TokenCounter {
  constructor() {
    Object.defineProperty(this, 'counter_id', {
      value: parseContract(IdentifierSchema, 'token-counter:utf8-byte-upper-bound', 'token counter id'),
      enumerable: true,
    });
    Object.freeze(this);
  }

  count(canonicalText) {
    if (typeof canonicalText !== 'string') throw new TokenCounterError('token counter input must be canonical text');
    return Buffer.byteLength(canonicalText, 'utf8');
  }
}

function validateTokenCounter(counter) {
  if (!counter || typeof counter !== 'object' || typeof counter.count !== 'function') {
    throw new TokenCounterError('token counter must expose count(canonicalText)');
  }
  const counterId = parseContract(IdentifierSchema, counter.counter_id, 'token counter id');
  return Object.freeze({ count: counter.count.bind(counter), counter_id: counterId });
}

function deterministicCount(counter, canonicalText) {
  let first;
  let second;
  try {
    first = counter.count(canonicalText);
    second = counter.count(canonicalText);
  } catch (error) {
    throw new TokenCounterError('token counter failed', 'AGENT_CONTEXT_COUNTER_FAILED', { cause: error });
  }
  if (!Number.isSafeInteger(first) || first < 0 || second !== first) {
    throw new TokenCounterError('token counter must return one repeatable non-negative safe integer');
  }
  return first;
}

function accountSessionTokens(state, { excluded_turn_id } = {}) {
  const { canonicalJson } = require('../agent-session-store');
  let reportedInput = 0;
  let reportedOutput = 0;
  let estimated = state.reconciliation_reserved_tokens || 0;
  const counter = new ConservativeUtf8TokenCounter();
  for (const [id, turn] of Object.entries(state.turns || {})) {
    if (id === excluded_turn_id) continue;
    if (turn.model_steps?.length > 0) {
      for (const step of turn.model_steps) {
        const usage = step.model_events.filter((event) => event.event_type === 'usage');
        if (usage.length > 0) {
          for (const event of usage) {
            reportedInput += event.payload.input_tokens;
            reportedOutput += event.payload.output_tokens;
          }
        } else if (step.model_events.some((event) => ['completed', 'failed'].includes(event.event_type))) {
          estimated += counter.count(canonicalJson(step.request)) + step.request.parameters.max_output_tokens;
        }
      }
    } else if (turn.budget) {
      const usage = turn.model_events.filter((event) => event.event_type === 'usage');
      if (usage.length > 0) {
        for (const event of usage) {
          reportedInput += event.payload.input_tokens;
          reportedOutput += event.payload.output_tokens;
        }
      } else estimated += turn.budget.input_tokens + turn.budget.reserved_output_tokens;
    }
  }
  const total = reportedInput + reportedOutput + estimated;
  if (![reportedInput, reportedOutput, estimated, total].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new TokenCounterError('Session token usage exceeds safe accounting bounds');
  return Object.freeze({
    reported_input_tokens: reportedInput,
    reported_output_tokens: reportedOutput,
    conservative_estimate_tokens: estimated,
    total_tokens: total,
    estimate_counter: counter.counter_id,
  });
}

module.exports = { accountSessionTokens, ConservativeUtf8TokenCounter, TokenCounterError, deterministicCount, validateTokenCounter };
