'use strict';

const { GovernedExecutionRuntime } = require('./runtime');

const PORT_TOKEN = Symbol('GovernedExecutionPort');
const PORTS = new WeakSet();

class GovernedExecutionPortError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GovernedExecutionPortError';
    this.code = 'EXECUTION_PORT_INVALID';
  }
}

class GovernedExecutionPort {
  #runtime;

  constructor(runtime, token) {
    if (token !== PORT_TOKEN || !(runtime instanceof GovernedExecutionRuntime)) {
      throw new GovernedExecutionPortError('Governed execution ports can be created only from GovernedExecutionRuntime');
    }
    this.#runtime = runtime;
    PORTS.add(this);
    Object.freeze(this);
  }

  execute(request) {
    return this.#runtime.execute(request);
  }

  cancelQueued(request, reason = 'Scheduled execution cancelled') {
    return this.#runtime.cancelQueued(request, reason);
  }
}

Object.freeze(GovernedExecutionPort.prototype);

function createGovernedExecutionPort(runtime) {
  return new GovernedExecutionPort(runtime, PORT_TOKEN);
}

function isGovernedExecutionPort(value) {
  return PORTS.has(value);
}

module.exports = { createGovernedExecutionPort, GovernedExecutionPort, GovernedExecutionPortError, isGovernedExecutionPort };
