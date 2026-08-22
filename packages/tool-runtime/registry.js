'use strict';

const { ToolDefinitionSchema, deepFreeze, parseContract } = require('../agent-runtime-contracts');

class ToolRuntimeRegistryError extends Error {
  constructor(message, code = 'TOOL_RUNTIME_REGISTRY_INVALID', details = {}) {
    super(message);
    this.name = 'ToolRuntimeRegistryError';
    this.code = code;
    this.details = details;
  }
}

function governanceRef(name) {
  return `governance://tool/${name}`;
}

class ToolRuntimeRegistry {
  #contracts;
  #definitions;
  #sealed;

  constructor({ contracts }) {
    if (!contracts || typeof contracts.resolve !== 'function') {
      throw new ToolRuntimeRegistryError('registry requires the governed execution contract resolver');
    }
    this.#contracts = contracts;
    this.#definitions = new Map();
    this.#sealed = false;
  }

  get contracts() {
    return this.#contracts;
  }

  get sealed() {
    return this.#sealed;
  }

  register(value) {
    if (this.#sealed) {
      throw new ToolRuntimeRegistryError('tool registry is sealed', 'TOOL_RUNTIME_REGISTRY_SEALED');
    }
    const definition = parseContract(ToolDefinitionSchema, value, 'tool definition');
    if (this.#definitions.has(definition.name)) {
      throw new ToolRuntimeRegistryError('tool is already registered', 'TOOL_RUNTIME_DUPLICATE', {
        name: definition.name,
      });
    }
    let contract;
    try {
      contract = this.#contracts.resolve(definition.name);
    } catch (error) {
      throw new ToolRuntimeRegistryError('tool has no governed execution contract', 'TOOL_RUNTIME_CONTRACT_NOT_FOUND', {
        name: definition.name,
        cause_code: error?.code || 'unknown',
      });
    }
    if (definition.governance_ref !== governanceRef(contract.name)) {
      throw new ToolRuntimeRegistryError(
        'tool governance reference does not identify its execution contract',
        'TOOL_RUNTIME_GOVERNANCE_MISMATCH',
        {
          name: definition.name,
          expected: governanceRef(contract.name),
        },
      );
    }
    this.#definitions.set(definition.name, definition);
    return definition;
  }

  resolve(name) {
    const definition = this.#definitions.get(name);
    if (!definition) {
      throw new ToolRuntimeRegistryError('tool is not model-visible', 'TOOL_RUNTIME_TOOL_NOT_FOUND', { name });
    }
    const contract = this.#contracts.resolve(name);
    return Object.freeze({ contract, definition });
  }

  list() {
    return deepFreeze(
      [...this.#definitions.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
    );
  }

  seal() {
    this.#sealed = true;
    return this;
  }
}

Object.freeze(ToolRuntimeRegistry.prototype);

module.exports = { governanceRef, ToolRuntimeRegistry, ToolRuntimeRegistryError };
