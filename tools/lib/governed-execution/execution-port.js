'use strict';

class GovernedExecutionPortError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GovernedExecutionPortError';
    this.code = 'EXECUTION_PORT_INVALID';
  }
}

function createGovernedExecutionPort(runtime) {
  if (!runtime || typeof runtime.execute !== 'function' || typeof runtime.cancelQueued !== 'function') {
    throw new GovernedExecutionPortError('Governed execution port requires a runtime');
  }
  return Object.freeze({
    execute: (request) => runtime.execute(request),
    cancelQueued: (request, reason = 'Scheduled execution cancelled') => runtime.cancelQueued(request, reason),
  });
}

module.exports = { createGovernedExecutionPort, GovernedExecutionPortError };
