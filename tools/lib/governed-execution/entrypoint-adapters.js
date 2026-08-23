'use strict';

const { randomUUID } = require('node:crypto');

const { assertCanonicalEnvelope, failureEnvelope } = require('./canonical-envelope');
const { deterministicOperationId } = require('./runtime');

const ENTRYPOINT_SURFACES = Object.freeze(['cli', 'hook', 'project_state', 'swarm']);

class EntrypointAdapterError extends Error {
  constructor(message, code = 'EXECUTION_ADAPTER_INVALID') {
    super(message);
    this.name = 'EntrypointAdapterError';
    this.code = code;
  }
}

class GovernedEntrypointAdapter {
  constructor({ surface, scheduler, resolveActor, resolveResourceScope }) {
    if (!ENTRYPOINT_SURFACES.includes(surface)) {
      throw new EntrypointAdapterError(`Unsupported execution surface: ${surface}`);
    }
    if (!scheduler || typeof scheduler.execute !== 'function') {
      throw new EntrypointAdapterError(`${surface} adapter requires the governed scheduler`);
    }
    if (typeof resolveActor !== 'function' || typeof resolveResourceScope !== 'function') {
      throw new EntrypointAdapterError(`${surface} adapter requires actor and resource-scope resolvers`);
    }
    this.surface = surface;
    this.scheduler = scheduler;
    this.resolveActor = resolveActor;
    this.resolveResourceScope = resolveResourceScope;
  }

  async invoke({
    tool,
    input = {},
    context = {},
    idempotencyKey = randomUUID(),
    correlationId = null,
    causationId = null,
    approvalContext = null,
    signal,
  }) {
    let operationId = null;
    try {
      if (typeof tool !== 'string' || tool.length === 0) {
        throw new EntrypointAdapterError('Entrypoint invocation requires a tool', 'EXECUTION_REQUEST_INVALID');
      }
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
        throw new EntrypointAdapterError('Entrypoint idempotency key must be a non-empty string', 'EXECUTION_REQUEST_INVALID');
      }
      operationId = deterministicOperationId(tool, idempotencyKey);
      const resolutionContext = Object.freeze({ context, input, surface: this.surface, tool });
      const actor = await this.resolveActor(resolutionContext);
      const resourceScope = await this.resolveResourceScope(resolutionContext);
      const request = {
        tool,
        input,
        actor,
        resource_scope: resourceScope,
        idempotency_key: idempotencyKey,
        correlation_id: correlationId || `${this.surface}:${operationId}`,
        causation_id: causationId || `${this.surface}-request:${operationId}`,
        ...(approvalContext ? { approval_context: approvalContext } : {}),
        ...(signal ? { signal } : {}),
      };
      const outcome = await this.scheduler.execute(request);
      return assertCanonicalEnvelope(outcome);
    } catch (error) {
      return failureEnvelope(
        error instanceof Error
          ? error
          : new EntrypointAdapterError('Entrypoint adapter failed', 'EXECUTION_ADAPTER_FAILED'),
        operationId,
      );
    }
  }
}

function createEntrypointAdapters({ scheduler, resolvers = {} }) {
  const adapters = {};
  for (const surface of ENTRYPOINT_SURFACES) {
    const resolver = resolvers[surface] || resolvers.default;
    if (!resolver) throw new EntrypointAdapterError(`Missing resolver configuration for ${surface}`);
    adapters[surface] = Object.freeze(
      new GovernedEntrypointAdapter({
        surface,
        scheduler,
        resolveActor: resolver.resolveActor,
        resolveResourceScope: resolver.resolveResourceScope,
      }),
    );
  }
  return Object.freeze(adapters);
}

module.exports = {
  createEntrypointAdapters,
  ENTRYPOINT_SURFACES,
  EntrypointAdapterError,
  GovernedEntrypointAdapter,
};
