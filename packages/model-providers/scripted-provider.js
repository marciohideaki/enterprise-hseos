'use strict';

const {
  ModelProviderError,
  ack,
  discovery,
  safeErrorCode,
  safeErrorMessage,
  streamEvent,
  validateInput,
  validateManifest,
  validateStreamRequest,
} = require('./common');

const EVENT_CAPABILITIES = Object.freeze({
  'reasoning.delta': 'reasoning',
  'tool_call.delta': 'tool_calls',
  usage: 'usage',
});

function wait(milliseconds, signal) {
  if (!milliseconds || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function abortable(value, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

class ScriptedModelProvider {
  #active = new Map();
  #disposed = false;

  constructor({ manifest, routes }) {
    const providerManifest = validateManifest(manifest);
    if (!Array.isArray(routes) || routes.length < 2) {
      throw new ModelProviderError('scripted provider requires at least two routes', 'invalid_request');
    }
    for (const route of routes) {
      if (!route || typeof route.match !== 'function' || (!Array.isArray(route.events) && typeof route.events !== 'function')) {
        throw new ModelProviderError('each scripted route requires match and events', 'invalid_request');
      }
    }
    const normalizedRoutes = Object.freeze(
      routes.map((route) =>
        Object.freeze({
          match: route.match,
          events: Array.isArray(route.events)
            ? Object.freeze(
                route.events.map((event) => Object.freeze({ ...event, payload: event.payload && Object.freeze({ ...event.payload }) })),
              )
            : route.events,
        }),
      ),
    );
    Object.defineProperties(this, {
      providerManifest: { value: providerManifest, enumerable: true },
      routes: { value: normalizedRoutes },
    });
  }

  manifest(input) {
    validateInput(this.providerManifest.provider_id, 'manifest', input);
    return this.providerManifest;
  }

  discover(input) {
    validateInput(this.providerManifest.provider_id, 'discover', input);
    return discovery(this.providerManifest);
  }

  stream(inputValue) {
    const input = validateInput(this.providerManifest.provider_id, 'stream', inputValue);
    if (this.#disposed) throw new ModelProviderError('provider is disposed', 'provider_unavailable');
    if (!this.providerManifest.models.includes(input.model)) {
      throw new ModelProviderError('model is not declared by this provider', 'invalid_request');
    }
    validateStreamRequest(this.providerManifest, input);
    if (this.#active.has(input.request_id)) throw new ModelProviderError('request is already active', 'invalid_request');
    if (this.#active.size >= this.providerManifest.limits.max_parallel_requests) {
      throw new ModelProviderError('provider parallel request limit reached', 'rate_limited', { retryable: true });
    }
    const route = this.routes.find((candidate) => candidate.match(input));
    if (!route) throw new ModelProviderError('no scripted route matched the request', 'invalid_request');
    const controller = new AbortController();
    const reservation = { controller, started: false };
    this.#active.set(input.request_id, reservation);
    const provider = this;
    let started = false;
    return {
      async *[Symbol.asyncIterator]() {
        if (started) throw new ModelProviderError('model stream is single-use', 'invalid_request');
        started = true;
        reservation.started = true;
        let sequence = 0;
        let terminal = false;
        try {
          const definitions = await abortable(typeof route.events === 'function' ? route.events(input) : route.events, controller.signal);
          for (const definition of definitions) {
            await wait(definition.delay_ms || 0, controller.signal);
            if (controller.signal.aborted) {
              yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence, 'completed', {
                finish_reason: 'cancelled',
                provider_response_ref: `scripted://${input.request_id}/cancelled`,
              });
              terminal = true;
              break;
            }
            if (!definition || typeof definition.event_type !== 'string') {
              throw new ModelProviderError('scripted event is malformed', 'protocol_error');
            }
            const requiredCapability = EVENT_CAPABILITIES[definition.event_type];
            if (requiredCapability && !provider.providerManifest.capabilities.includes(requiredCapability)) {
              throw new ModelProviderError('scripted event exceeds declared capabilities', 'protocol_error');
            }
            yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence, definition.event_type, definition.payload);
            terminal = ['completed', 'failed'].includes(definition.event_type);
            sequence++;
            if (terminal) break;
          }
          if (!terminal) throw new ModelProviderError('script ended without a terminal event', 'protocol_error');
        } catch (error) {
          if (controller.signal.aborted) {
            yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence, 'completed', {
              finish_reason: 'cancelled',
              provider_response_ref: `scripted://${input.request_id}/cancelled`,
            });
          } else {
            const normalized =
              error instanceof ModelProviderError
                ? error
                : new ModelProviderError('scripted route violated the normalized contract', 'protocol_error', { cause: error });
            const errorCode = safeErrorCode(normalized.error_code);
            yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence, 'failed', {
              error_code: errorCode,
              message: safeErrorMessage(errorCode),
              retryable: normalized.retryable === true,
            });
          }
        } finally {
          if (provider.#active.get(input.request_id) === reservation) provider.#active.delete(input.request_id);
        }
      },
    };
  }

  cancel(inputValue) {
    const input = validateInput(this.providerManifest.provider_id, 'cancel', inputValue);
    if (!this.providerManifest.capabilities.includes('cancellation')) {
      throw new ModelProviderError('cancellation is not declared by this provider', 'capability_unavailable');
    }
    const reservation = this.#active.get(input.request_id);
    if (reservation) {
      reservation.controller.abort(input.reason);
      if (!reservation.started) this.#active.delete(input.request_id);
    }
    return ack(this.providerManifest.provider_id, input.request_id, Boolean(reservation));
  }

  dispose(inputValue) {
    const input = validateInput(this.providerManifest.provider_id, 'dispose', inputValue);
    for (const reservation of this.#active.values()) reservation.controller.abort('provider disposed');
    this.#active.clear();
    this.#disposed = true;
    return ack(this.providerManifest.provider_id, input.request_id);
  }
}

module.exports = { ScriptedModelProvider };
