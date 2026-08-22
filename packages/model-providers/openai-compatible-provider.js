'use strict';

const { createHash } = require('node:crypto');

const { AgentContractError } = require('../agent-runtime-contracts');
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

const MAX_SSE_BUFFER_BYTES = 1_048_576;
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function normalizeEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new ModelProviderError('base_url must be an absolute URL', 'invalid_request', { cause: error });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ModelProviderError('base_url must be a credential-free HTTP(S) URL', 'invalid_request');
  }
  return url.href.replace(/\/$/, '');
}

function requestBody(input, manifest) {
  return {
    model: input.model,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      ...(message.tool_calls
        ? {
            tool_calls: message.tool_calls.map((call) => ({
              id: call.tool_call_id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.input) },
            })),
          }
        : {}),
    })),
    ...(input.tools.length === 0
      ? {}
      : {
          tools: input.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
          })),
        }),
    max_tokens: input.parameters.max_output_tokens,
    ...(input.parameters.temperature === null ? {} : { temperature: input.parameters.temperature }),
    ...(input.parameters.stop.length === 0 ? {} : { stop: input.parameters.stop }),
    stream: true,
    ...(manifest.capabilities.includes('usage') ? { stream_options: { include_usage: true } } : {}),
  };
}

async function* parseSse(body) {
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
    throw new ModelProviderError('response body is not a stream', 'protocol_error');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(buffer, 'utf8') > MAX_SSE_BUFFER_BYTES) {
      throw new ModelProviderError('SSE frame exceeds the buffer limit', 'protocol_error');
    }
    buffer = buffer.replaceAll('\r\n', '\n');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      if (data === '[DONE]') {
        yield null;
        return;
      }
      try {
        yield JSON.parse(data);
      } catch (error) {
        throw new ModelProviderError('SSE data is not valid JSON', 'protocol_error', { cause: error });
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) throw new ModelProviderError('SSE stream ended with an incomplete frame', 'protocol_error');
  throw new ModelProviderError('SSE stream ended before [DONE]', 'protocol_error');
}

function statusError(status) {
  if (status === 401 || status === 403) return new ModelProviderError('provider rejected authentication', 'unauthorized', { status });
  if (status === 429) return new ModelProviderError('provider rate limit reached', 'rate_limited', { retryable: true, status });
  if (status === 408 || status === 504) return new ModelProviderError('provider request timed out', 'timeout', { retryable: true, status });
  if (RETRYABLE_STATUS.has(status)) {
    return new ModelProviderError('provider is unavailable', 'provider_unavailable', { retryable: true, status });
  }
  return new ModelProviderError('provider rejected the request', 'invalid_request', { status });
}

function responseReference(response, requestId) {
  const opaque = response.headers.get('x-request-id') || requestId;
  const digest = createHash('sha256').update(opaque).digest('hex');
  return `provider-response://sha256/${digest}`;
}

function abortableDelay(milliseconds, signal) {
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

function finishReason(value) {
  if (['stop', 'tool_calls', 'length'].includes(value)) return value;
  throw new ModelProviderError('provider returned an unsupported finish reason', 'protocol_error');
}

class OpenAICompatibleModelProvider {
  #active = new Map();
  #disposed = false;

  constructor({ manifest, base_url, fetch_impl = globalThis.fetch, secret_resolver, max_attempts = 2, retry_delay_ms = 0 }) {
    const providerManifest = validateManifest(manifest);
    const baseUrl = normalizeEndpoint(base_url);
    if (typeof fetch_impl !== 'function') throw new ModelProviderError('fetch implementation is required', 'invalid_request');
    if (
      !Number.isInteger(max_attempts) ||
      max_attempts < 1 ||
      max_attempts > 5 ||
      !Number.isInteger(retry_delay_ms) ||
      retry_delay_ms < 0
    ) {
      throw new ModelProviderError('retry configuration is invalid', 'invalid_request');
    }
    if (providerManifest.secret_refs.length > 0 && typeof secret_resolver !== 'function') {
      throw new ModelProviderError('secret resolver is required by the manifest', 'invalid_request');
    }
    const secretReference = providerManifest.secret_refs.find((reference) => reference.name === 'api-key');
    if (providerManifest.secret_refs.length > 0 && !secretReference) {
      throw new ModelProviderError('manifest must declare the api-key secret reference', 'invalid_request');
    }
    Object.defineProperties(this, {
      providerManifest: { value: providerManifest, enumerable: true },
      baseUrl: { value: baseUrl },
      fetch: { value: fetch_impl },
      secretResolver: { value: secret_resolver },
      secretReference: { value: secretReference },
      maxAttempts: { value: max_attempts },
      retryDelayMs: { value: retry_delay_ms },
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
    if (!this.providerManifest.models.includes(input.model)) throw new ModelProviderError('model is not declared', 'invalid_request');
    validateStreamRequest(this.providerManifest, input);
    if (this.#active.has(input.request_id)) throw new ModelProviderError('request is already active', 'invalid_request');
    if (this.#active.size >= this.providerManifest.limits.max_parallel_requests) {
      throw new ModelProviderError('provider parallel request limit reached', 'rate_limited', { retryable: true });
    }
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
        let emitted = false;
        try {
          for (let attempt = 1; attempt <= provider.maxAttempts; attempt++) {
            try {
              const headers = { accept: 'text/event-stream', 'content-type': 'application/json' };
              if (provider.providerManifest.secret_refs.length > 0) {
                const secret = await abortable(
                  provider.secretResolver(provider.secretReference, { signal: controller.signal }),
                  controller.signal,
                );
                if (typeof secret !== 'string' || secret.length === 0)
                  throw new ModelProviderError('secret resolution failed', 'unauthorized');
                headers.authorization = `Bearer ${secret}`;
              }
              const response = await provider.fetch(`${provider.baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody(input, provider.providerManifest)),
                signal: controller.signal,
              });
              if (!response.ok) throw statusError(response.status);
              const contentType = response.headers.get('content-type') || '';
              if (!contentType.toLowerCase().startsWith('text/event-stream')) {
                throw new ModelProviderError('provider response is not text/event-stream', 'protocol_error');
              }
              const providerResponseRef = responseReference(response, input.request_id);
              const toolIds = new Map();
              let completedReason = null;
              for await (const chunk of parseSse(response.body)) {
                if (chunk === null) {
                  yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence++, 'completed', {
                    finish_reason: completedReason || 'stop',
                    provider_response_ref: providerResponseRef,
                  });
                  return;
                }
                if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
                  throw new ModelProviderError('provider chunk must be an object', 'protocol_error');
                }
                if (chunk.usage !== undefined) {
                  if (!provider.providerManifest.capabilities.includes('usage')) {
                    throw new ModelProviderError('provider emitted undeclared usage', 'protocol_error');
                  }
                  if (!chunk.usage || typeof chunk.usage !== 'object' || Array.isArray(chunk.usage)) {
                    throw new ModelProviderError('provider usage must be an object', 'protocol_error');
                  }
                  if (
                    !Number.isInteger(chunk.usage.prompt_tokens) ||
                    chunk.usage.prompt_tokens < 0 ||
                    !Number.isInteger(chunk.usage.completion_tokens) ||
                    chunk.usage.completion_tokens < 0
                  ) {
                    throw new ModelProviderError('provider usage token counts are invalid', 'protocol_error');
                  }
                  if (
                    chunk.usage.prompt_tokens_details !== null &&
                    chunk.usage.prompt_tokens_details !== undefined &&
                    (typeof chunk.usage.prompt_tokens_details !== 'object' || Array.isArray(chunk.usage.prompt_tokens_details))
                  ) {
                    throw new ModelProviderError('provider usage details are invalid', 'protocol_error');
                  }
                  const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
                  if (!Number.isInteger(cachedTokens) || cachedTokens < 0) {
                    throw new ModelProviderError('provider cached token count is invalid', 'protocol_error');
                  }
                  yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence++, 'usage', {
                    input_tokens: chunk.usage.prompt_tokens,
                    output_tokens: chunk.usage.completion_tokens,
                    cached_tokens: cachedTokens,
                  });
                  emitted = true;
                }
                if (chunk.choices !== undefined && !Array.isArray(chunk.choices)) {
                  throw new ModelProviderError('provider choices must be an array', 'protocol_error');
                }
                if (chunk.choices?.length > 1) {
                  throw new ModelProviderError('provider returned unsupported multiple choices', 'protocol_error');
                }
                for (const choice of chunk.choices || []) {
                  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
                    throw new ModelProviderError('provider choice must be an object', 'protocol_error');
                  }
                  if (choice.index !== undefined && choice.index !== 0) {
                    throw new ModelProviderError('provider choice index is unsupported', 'protocol_error');
                  }
                  const delta = choice.delta === undefined ? {} : choice.delta;
                  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
                    throw new ModelProviderError('provider delta must be an object', 'protocol_error');
                  }
                  if (typeof delta.content === 'string' && delta.content.length > 0) {
                    yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence++, 'content.delta', {
                      text: delta.content,
                    });
                    emitted = true;
                  } else if (delta.content !== null && delta.content !== undefined && typeof delta.content !== 'string') {
                    throw new ModelProviderError('provider content delta must be a string', 'protocol_error');
                  }
                  const reasoning = delta.reasoning_content ?? delta.reasoning;
                  if (reasoning !== null && reasoning !== undefined && typeof reasoning !== 'string') {
                    throw new ModelProviderError('provider reasoning delta must be a string', 'protocol_error');
                  }
                  if (typeof reasoning === 'string' && reasoning.length > 0) {
                    if (!provider.providerManifest.capabilities.includes('reasoning')) {
                      throw new ModelProviderError('provider emitted undeclared reasoning', 'protocol_error');
                    }
                    yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence++, 'reasoning.delta', {
                      text: reasoning,
                    });
                    emitted = true;
                  }
                  if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) {
                    throw new ModelProviderError('provider tool calls must be an array', 'protocol_error');
                  }
                  for (const toolCall of delta.tool_calls || []) {
                    if (!provider.providerManifest.capabilities.includes('tool_calls')) {
                      throw new ModelProviderError('provider emitted undeclared tool calls', 'protocol_error');
                    }
                    if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
                      throw new ModelProviderError('provider tool call must be an object', 'protocol_error');
                    }
                    if (
                      toolCall.function !== null &&
                      toolCall.function !== undefined &&
                      (typeof toolCall.function !== 'object' || Array.isArray(toolCall.function))
                    ) {
                      throw new ModelProviderError('provider tool call function must be an object', 'protocol_error');
                    }
                    if (
                      toolCall.function?.name !== null &&
                      toolCall.function?.name !== undefined &&
                      typeof toolCall.function.name !== 'string'
                    ) {
                      throw new ModelProviderError('provider tool call name must be a string', 'protocol_error');
                    }
                    if (
                      toolCall.function?.arguments !== null &&
                      toolCall.function?.arguments !== undefined &&
                      typeof toolCall.function.arguments !== 'string'
                    ) {
                      throw new ModelProviderError('provider tool arguments must be a string', 'protocol_error');
                    }
                    const index = toolCall.index;
                    if (!Number.isInteger(index) || index < 0) throw new ModelProviderError('tool call index is invalid', 'protocol_error');
                    if (toolCall.id) toolIds.set(index, toolCall.id);
                    const toolCallId = toolIds.get(index);
                    if (!toolCallId) throw new ModelProviderError('tool call delta has no identity', 'protocol_error');
                    yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence++, 'tool_call.delta', {
                      tool_call_id: toolCallId,
                      name: toolCall.function?.name ?? null,
                      arguments_delta: toolCall.function?.arguments ?? '',
                    });
                    emitted = true;
                  }
                  if (choice.finish_reason !== null && choice.finish_reason !== undefined)
                    completedReason = finishReason(choice.finish_reason);
                }
              }
            } catch (error) {
              if (controller.signal.aborted || error?.name === 'AbortError') {
                yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence++, 'completed', {
                  finish_reason: 'cancelled',
                  provider_response_ref: `provider-response://${input.request_id}/cancelled`,
                });
                return;
              }
              const normalized =
                error instanceof ModelProviderError
                  ? error
                  : error instanceof AgentContractError
                    ? new ModelProviderError('provider response violated the normalized contract', 'protocol_error', { cause: error })
                    : new ModelProviderError('provider transport failed', 'provider_unavailable', { retryable: true, cause: error });
              if (!emitted && normalized.retryable === true && attempt < provider.maxAttempts) {
                await abortableDelay(provider.retryDelayMs, controller.signal);
                continue;
              }
              const errorCode = safeErrorCode(normalized.error_code);
              yield streamEvent(provider.providerManifest.provider_id, input.request_id, sequence++, 'failed', {
                error_code: errorCode,
                message: safeErrorMessage(errorCode),
                retryable: normalized.retryable === true,
              });
              return;
            }
          }
        } finally {
          if (provider.#active.get(input.request_id) === reservation) provider.#active.delete(input.request_id);
          if (!controller.signal.aborted) controller.abort('stream closed');
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

module.exports = { MAX_SSE_BUFFER_BYTES, OpenAICompatibleModelProvider, parseSse };
