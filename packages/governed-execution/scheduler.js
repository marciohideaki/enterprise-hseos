'use strict';

const { randomUUID } = require('node:crypto');

const { assertCanonicalEnvelope, failureEnvelope } = require('./canonical-envelope');
const { isGovernedExecutionPort } = require('./execution-port');
const { deterministicOperationId } = require('./operation-id');

const SCHEDULER_BINDINGS = new WeakMap();

class ExecutionSchedulerError extends Error {
  constructor(message, code, retryable = false) {
    super(message);
    this.name = 'ExecutionSchedulerError';
    this.code = code;
    this.retryable = retryable;
  }
}

function operationIdFor(request) {
  if (
    request &&
    typeof request.tool === 'string' &&
    request.tool.length > 0 &&
    typeof request.idempotency_key === 'string' &&
    request.idempotency_key.length > 0
  ) {
    return deterministicOperationId(request.tool, request.idempotency_key);
  }
  return null;
}

function rejectedHandle(request, error) {
  return Object.freeze({
    id: randomUUID(),
    cancel() {},
    promise: Promise.resolve(failureEnvelope(error, operationIdFor(request))),
  });
}

function composeSignals(externalSignal, internalSignal) {
  if (!externalSignal) return { dispose() {}, signal: internalSignal };
  const controller = new AbortController();
  const listeners = [];
  const forwardAbort = (source) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  for (const source of [externalSignal, internalSignal]) {
    if (source.aborted) {
      forwardAbort(source);
      break;
    }
    const listener = () => forwardAbort(source);
    source.addEventListener('abort', listener, { once: true });
    listeners.push([source, listener]);
  }
  return {
    dispose() {
      for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
    },
    signal: controller.signal,
  };
}

class GovernedExecutionScheduler {
  #contracts;
  #executionPort;

  constructor({ contracts, port, maxConcurrency = 4, maxQueue = 1024 }) {
    if (!contracts || typeof contracts.resolve !== 'function') {
      throw new ExecutionSchedulerError('Scheduler requires a contract resolver', 'EXECUTION_SCHEDULER_INVALID');
    }
    if (!port || typeof port.execute !== 'function' || typeof port.cancelQueued !== 'function') {
      throw new ExecutionSchedulerError(
        'Scheduler requires execute and cancelQueued operations on the governed port',
        'EXECUTION_SCHEDULER_INVALID',
      );
    }
    for (const [field, value] of Object.entries({ maxConcurrency, maxQueue })) {
      if (!Number.isInteger(value) || value < 1) {
        throw new ExecutionSchedulerError(`${field} must be a positive integer`, 'EXECUTION_SCHEDULER_INVALID');
      }
    }
    this.#contracts = contracts;
    this.#executionPort = port;
    SCHEDULER_BINDINGS.set(this, Object.freeze({ contracts, port }));
    this.maxConcurrency = maxConcurrency;
    this.maxQueue = maxQueue;
    this.queue = [];
    this.activeItems = new Set();
    this.cancellationBarriers = 0;
    this.exclusiveRunning = false;
    this.accepting = true;
    this.drainWaiters = [];
    this.metrics = { cancellation_refused: 0, cancelled: 0, completed: 0, failed: 0, rejected: 0, started: 0 };
  }

  get contracts() {
    return this.#contracts;
  }

  get executionPort() {
    return this.#executionPort;
  }

  enqueue(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.tool !== 'string') {
      this.metrics.rejected += 1;
      return rejectedHandle(request, new ExecutionSchedulerError('Scheduler request must identify a tool', 'EXECUTION_REQUEST_INVALID'));
    }
    if (!this.accepting) {
      this.metrics.rejected += 1;
      return rejectedHandle(request, new ExecutionSchedulerError('Scheduler is closed', 'EXECUTION_SCHEDULER_CLOSED'));
    }
    if (
      request.signal !== undefined &&
      (!request.signal ||
        typeof request.signal.aborted !== 'boolean' ||
        typeof request.signal.addEventListener !== 'function' ||
        typeof request.signal.removeEventListener !== 'function')
    ) {
      this.metrics.rejected += 1;
      return rejectedHandle(
        request,
        new ExecutionSchedulerError('Scheduler signal must implement the AbortSignal contract', 'EXECUTION_REQUEST_INVALID'),
      );
    }
    if (this.queue.length >= this.maxQueue) {
      this.metrics.rejected += 1;
      return rejectedHandle(
        request,
        new ExecutionSchedulerError('Scheduler queue capacity is exhausted', 'EXECUTION_SCHEDULER_CAPACITY', true),
      );
    }

    let exclusive = true;
    let cancellable = true;
    try {
      const contract = this.#contracts.resolve(request.tool);
      exclusive = contract.exclusive === true;
      cancellable = contract.cancellation_policy !== 'non_cancellable';
    } catch {
      // Unknown contracts are treated as barriers and delegated to the port,
      // which returns the canonical governed resolution failure.
    }
    const controller = new AbortController();
    const composed = composeSignals(request.signal, controller.signal);
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    const item = {
      id: randomUUID(),
      request: { ...request, signal: composed.signal },
      exclusive,
      cancellable,
      controller,
      disposeSignal: composed.dispose,
      resolve: resolvePromise,
      cancelled: false,
      settled: false,
      state: 'queued',
    };
    const cancelFromSignal = () => {
      if (item.state !== 'queued') return;
      if (!item.cancellable) {
        this.metrics.cancellation_refused += 1;
        return;
      }
      this._cancelQueued(item, item.request.signal.reason || 'Scheduled execution cancelled');
    };
    item.disposeQueuedAbort = () => item.request.signal.removeEventListener('abort', cancelFromSignal);
    item.request.signal.addEventListener('abort', cancelFromSignal, { once: true });
    const handle = Object.freeze({
      id: item.id,
      cancel: (reason = 'Scheduled execution cancelled') => {
        if (item.cancelled || item.settled || item.controller.signal.aborted) return false;
        if (!item.cancellable) {
          this.metrics.cancellation_refused += 1;
          return false;
        }
        if (item.state === 'queued') return this._cancelQueued(item, reason);
        item.cancelled = true;
        this.metrics.cancelled += 1;
        item.controller.abort(new Error(String(reason)));
        return true;
      },
      promise,
    });
    this.queue.push(item);
    if (item.request.signal.aborted) cancelFromSignal();
    if (item.state === 'queued') this._pump();
    return handle;
  }

  execute(request) {
    return this.enqueue(request).promise;
  }

  _pump() {
    if (this.exclusiveRunning || this.cancellationBarriers > 0) return;
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (next.exclusive) {
        if (this.activeItems.size > 0) return;
        this.queue.shift();
        this._start(next);
        return;
      }
      if (this.activeItems.size >= this.maxConcurrency) return;
      this.queue.shift();
      this._start(next);
    }
    this._resolveDrain();
  }

  _start(item) {
    item.state = 'running';
    this.activeItems.add(item);
    if (item.exclusive) this.exclusiveRunning = true;
    this.metrics.started += 1;
    void Promise.resolve()
      .then(async () => {
        try {
          const result = await this.#executionPort.execute(item.request);
          assertCanonicalEnvelope(result);
          if (result.ok) this.metrics.completed += 1;
          else this.metrics.failed += 1;
          return result;
        } catch (error) {
          this.metrics.failed += 1;
          return failureEnvelope(error, operationIdFor(item.request));
        }
      })
      .then((result) => item.resolve(result))
      .finally(() => {
        item.settled = true;
        item.state = 'settled';
        item.disposeQueuedAbort();
        item.disposeSignal();
        this.activeItems.delete(item);
        if (item.exclusive) this.exclusiveRunning = false;
        this._pump();
      });
  }

  async close({ cancelQueued = false, cancelRunning = false } = {}) {
    this.accepting = false;
    if (cancelQueued) {
      const queuedItems = [...this.queue];
      for (const item of queuedItems) {
        if (!item.cancelled) {
          if (!item.cancellable) {
            this.metrics.cancellation_refused += 1;
            continue;
          }
          this._cancelQueued(item, 'Scheduler closed before execution', false);
        }
      }
      this._pump();
    }
    if (cancelRunning) {
      for (const item of this.activeItems) {
        if (!item.cancelled) {
          if (!item.cancellable) {
            this.metrics.cancellation_refused += 1;
            continue;
          }
          item.cancelled = true;
          this.metrics.cancelled += 1;
          item.controller.abort(new Error('Scheduler closed during execution'));
        }
      }
    }
    await this.drain();
  }

  _cancelQueued(item, reason, pump = true) {
    const index = this.queue.indexOf(item);
    if (index === -1 || item.state !== 'queued') return false;
    this.queue.splice(index, 1);
    item.cancelled = true;
    item.state = 'cancelling';
    this.metrics.cancelled += 1;
    item.controller.abort(new Error(String(reason)));
    item.disposeQueuedAbort();
    item.disposeSignal();
    this.activeItems.add(item);
    this.cancellationBarriers += 1;
    void Promise.resolve()
      .then(async () => {
        const outcome = await this.#executionPort.cancelQueued(item.request, reason);
        assertCanonicalEnvelope(outcome);
        if (outcome.ok || outcome.error.code !== 'EXECUTION_CANCELLED') {
          throw new ExecutionSchedulerError('Governed port did not persist queued cancellation', 'EXECUTION_CANCELLATION_INVALID');
        }
        return outcome;
      })
      .then((outcome) => item.resolve(outcome))
      .catch((error) => {
        this.metrics.failed += 1;
        item.resolve(failureEnvelope(error, operationIdFor(item.request)));
        this._halt(error);
      })
      .finally(() => {
        item.settled = true;
        item.state = 'settled';
        this.activeItems.delete(item);
        this.cancellationBarriers -= 1;
        if (this.accepting) this._pump();
        else this._resolveDrain();
      });
    if (pump) this._pump();
    return true;
  }

  _halt(cause) {
    this.accepting = false;
    const queuedItems = [...this.queue];
    this.queue.length = 0;
    for (const item of queuedItems) {
      item.settled = true;
      item.state = 'settled';
      item.disposeQueuedAbort();
      item.disposeSignal();
      this.metrics.rejected += 1;
      item.resolve(
        failureEnvelope(
          new ExecutionSchedulerError(
            `Scheduler halted after durable cancellation failure: ${cause.code || cause.message}`,
            'EXECUTION_SCHEDULER_HALTED',
          ),
          operationIdFor(item.request),
        ),
      );
    }
  }

  drain() {
    if (this.queue.length === 0 && this.activeItems.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  _resolveDrain() {
    if (this.queue.length > 0 || this.activeItems.size > 0) return;
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }

  snapshot() {
    return Object.freeze({
      accepting: this.accepting,
      active: this.activeItems.size,
      exclusive_running: this.exclusiveRunning || this.cancellationBarriers > 0,
      max_concurrency: this.maxConcurrency,
      max_queue: this.maxQueue,
      queued: this.queue.length,
      totals: Object.freeze({ ...this.metrics }),
    });
  }
}

function isGovernedExecutionScheduler(value, contracts) {
  const binding = SCHEDULER_BINDINGS.get(value);
  const prototype = GovernedExecutionScheduler.prototype;
  const methods = ['enqueue', '_pump', '_start', '_cancelQueued', '_halt'];
  return Boolean(
    binding &&
    binding.contracts === contracts &&
    isGovernedExecutionPort(binding.port) &&
    Object.getPrototypeOf(value) === prototype &&
    methods.every((method) => value[method] === prototype[method]),
  );
}

module.exports = { ExecutionSchedulerError, GovernedExecutionScheduler, isGovernedExecutionScheduler };
