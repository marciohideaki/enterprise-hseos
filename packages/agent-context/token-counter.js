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

module.exports = { ConservativeUtf8TokenCounter, TokenCounterError, deterministicCount, validateTokenCounter };
