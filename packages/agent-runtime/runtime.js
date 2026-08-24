'use strict';

const { createHash } = require('node:crypto');

const {
  CONTRACT_SCHEMA_VERSION,
  MAX_MODEL_EVENTS_PER_STEP,
  MAX_MODEL_STREAM_BYTES_PER_STEP,
  MODEL_TERMINAL_RESERVE_BYTES,
  ModelRequestSchema,
  deepFreeze,
  parseContract,
  validatePortInput,
  validatePortResult,
} = require('../agent-runtime-contracts');
const { ContextAssembler } = require('../agent-context');
const { assembledToolCalls, canonicalJson, isRelationalSessionEventStore } = require('../agent-session-store');
const { ModelProviderRegistrySnapshot } = require('../model-providers');
const { ToolRuntime } = require('../tool-runtime');
const { CompactionRuntimeError } = require('../agent-compaction');
const { AgentContextProfileSchema } = require('./schemas');

const RUNTIME_CAPS = deepFreeze({
  max_turns: 1024,
  max_tokens: 1_000_000_000,
  max_duration_ms: 604_800_000,
  max_tool_calls: 1024,
});
const STREAM_CAPS = deepFreeze({
  max_events_per_step: MAX_MODEL_EVENTS_PER_STEP,
  max_bytes_per_step: MAX_MODEL_STREAM_BYTES_PER_STEP,
});

class AgentRuntimeError extends Error {
  constructor(message, code = 'AGENT_RUNTIME_INVALID', details = {}) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function stableId(kind, ...parts) {
  const digest = createHash('sha256')
    .update(parts.map((part) => canonicalJson(part)).join('\0'))
    .digest('hex');
  return `${kind}:${digest.slice(0, 40)}`;
}

function equal(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function eventRef(eventId) {
  return `session-event://${eventId}`;
}

function normalizedFailure(error) {
  const allowed = new Set([
    'invalid_request',
    'unauthorized',
    'policy_denied',
    'capability_unavailable',
    'rate_limited',
    'timeout',
    'cancelled',
    'provider_unavailable',
    'protocol_error',
    'budget_exceeded',
    'tool_failed',
    'internal_error',
  ]);
  const candidate = error?.error_code || error?.code;
  return {
    error_code: allowed.has(candidate) ? candidate : 'internal_error',
    message: allowed.has(candidate) && typeof error?.message === 'string' ? error.message.slice(0, 4096) : 'agent runtime failed',
    retryable: error?.retryable === true,
  };
}

function tokenUsage(state) {
  let total = 0;
  for (const turn of Object.values(state.turns)) {
    for (const step of turn.model_steps) {
      const usage = step.model_events.filter((event) => event.event_type === 'usage');
      if (usage.length > 0) {
        total += usage.reduce((sum, event) => sum + event.payload.input_tokens + event.payload.output_tokens, 0);
      } else if (step.model_events.some((event) => ['completed', 'failed'].includes(event.event_type))) {
        total += Buffer.byteLength(canonicalJson(step.request), 'utf8') + step.request.parameters.max_output_tokens;
      }
      if (!Number.isSafeInteger(total)) throw new AgentRuntimeError('session token usage exceeds safe bounds');
    }
  }
  return total;
}

function assertRuntimeCaps(spec) {
  for (const [name, cap] of Object.entries(RUNTIME_CAPS)) {
    if (spec.limits[name] > cap) {
      throw new AgentRuntimeError(`${name} exceeds the headless runtime safety cap`, 'AGENT_RUNTIME_LIMIT_INVALID', {
        limit: name,
        requested: spec.limits[name],
        cap,
      });
    }
  }
}

class AgentRuntime {
  #active = new Map();
  #clock;
  #compactionRuntime;
  #contextAssembler;
  #contextProfileResolver;
  #providers;
  #store;
  #streamCaps;
  #tools;

  constructor({
    session_store,
    model_provider_snapshot,
    tool_runtime,
    context_profile_resolver,
    compaction_runtime = null,
    clock = Date,
    stream_limits = {},
  }) {
    if (!isRelationalSessionEventStore(session_store)) {
      throw new AgentRuntimeError('AgentRuntime requires a nominal RelationalSessionEventStore');
    }
    if (!(model_provider_snapshot instanceof ModelProviderRegistrySnapshot)) {
      throw new AgentRuntimeError('AgentRuntime requires one immutable model provider snapshot');
    }
    if (!(tool_runtime instanceof ToolRuntime)) {
      throw new AgentRuntimeError('AgentRuntime requires a nominal governed ToolRuntime');
    }
    if (typeof context_profile_resolver !== 'function') {
      throw new AgentRuntimeError('a context profile resolver is required');
    }
    if (!clock || typeof clock.now !== 'function') throw new AgentRuntimeError('clock.now is required');
    if (
      !stream_limits ||
      typeof stream_limits !== 'object' ||
      Array.isArray(stream_limits) ||
      Object.keys(stream_limits).some((key) => !Object.hasOwn(STREAM_CAPS, key))
    ) {
      throw new AgentRuntimeError('stream_limits contains an unknown field');
    }
    const resolvedStreamCaps = { ...STREAM_CAPS, ...stream_limits };
    for (const [name, value] of Object.entries(resolvedStreamCaps)) {
      if (!Number.isSafeInteger(value) || value < 2 || value > STREAM_CAPS[name]) {
        throw new AgentRuntimeError(`${name} must be a positive tightening of the runtime stream cap`);
      }
    }
    if (resolvedStreamCaps.max_bytes_per_step < MODEL_TERMINAL_RESERVE_BYTES * 2) {
      throw new AgentRuntimeError('max_bytes_per_step must preserve bounded room for content and a terminal event');
    }
    this.#store = session_store;
    this.#providers = model_provider_snapshot;
    this.#tools = tool_runtime;
    this.#compactionRuntime = compaction_runtime;
    this.#contextProfileResolver = context_profile_resolver;
    this.#clock = clock;
    this.#streamCaps = deepFreeze(resolvedStreamCaps);
    this.#contextAssembler = new ContextAssembler({
      session_store,
      model_provider_snapshot,
      compaction_runtime,
    });
  }

  #nowMs() {
    const value = this.#clock.now();
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new AgentRuntimeError('clock returned an invalid time');
    return value;
  }

  #timestamp() {
    return new Date(this.#nowMs()).toISOString();
  }

  #append(sessionId, eventType, payload, identityParts, active = null) {
    const state = this.#store.replay(sessionId);
    const event = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      event_id: stableId('event', sessionId, eventType, ...identityParts),
      session_id: sessionId,
      sequence: state.current_sequence + 1,
      occurred_at: this.#timestamp(),
      event_type: eventType,
      payload,
    };
    const receipt = this.#store.append({ session_id: sessionId, expected_version: state.current_sequence, events: [event] });
    if (receipt.current_version !== event.sequence || receipt.events.length !== 1 || !equal(receipt.events[0], event)) {
      throw new AgentRuntimeError('session store returned an invalid append receipt', 'AGENT_RUNTIME_APPEND_RECEIPT_INVALID');
    }
    if (active) active.eventIds.push(event.event_id);
    return receipt.events[0];
  }

  #operationResult(method, input, accepted, terminal, eventIds) {
    return validatePortResult(
      'AgentRuntime',
      method,
      {
        schema_version: CONTRACT_SCHEMA_VERSION,
        session_id: method === 'create' ? input.spec.session_id : input.session_id,
        accepted,
        terminal,
        event_refs: [...new Set(eventIds)].map(eventRef),
      },
      input,
    );
  }

  #profile(spec) {
    let value;
    try {
      value = this.#contextProfileResolver(deepFreeze(structuredClone(spec)));
    } catch {
      throw new AgentRuntimeError('context profile resolution failed', 'AGENT_RUNTIME_CONTEXT_PROFILE_FAILED');
    }
    return parseContract(AgentContextProfileSchema, value, 'agent context profile');
  }

  async create(value) {
    const input = validatePortInput('AgentRuntime', 'create', value);
    const { spec } = input;
    if (spec.execution.mode !== 'kernel') {
      throw new AgentRuntimeError('headless AgentRuntime requires kernel execution ownership', 'AGENT_RUNTIME_EXECUTION_OWNER_INVALID');
    }
    assertRuntimeCaps(spec);
    const contextProfile = this.#profile(spec);
    if (contextProfile.overflow_policy === 'compact') {
      if (!this.#compactionRuntime) {
        throw new AgentRuntimeError('compact context profile requires a compaction runtime', 'AGENT_RUNTIME_COMPACTION_UNAVAILABLE');
      }
      this.#compactionRuntime.resolve(contextProfile.compaction_provider_id, 'history_summary');
      this.#compactionRuntime.resolve(contextProfile.compaction_provider_id, 'tool_result_prune');
    }
    this.#providers.resolve(spec.execution.model_provider_id, spec.execution.model);
    this.#tools.list({ schema_version: CONTRACT_SCHEMA_VERSION, session_id: spec.session_id });
    const existing = this.#store.readSession(spec.session_id);
    if (existing.length > 0) {
      const state = this.#store.replay(spec.session_id);
      if (!equal(state.spec, spec)) throw new AgentRuntimeError('session identifier already has a different specification');
      return this.#operationResult('create', input, false, Boolean(state.terminal_event), [existing[0].event_id]);
    }
    const event = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      event_id: stableId('event', spec.session_id, 'session.created'),
      session_id: spec.session_id,
      sequence: 1,
      occurred_at: this.#timestamp(),
      event_type: 'session.created',
      payload: { spec },
    };
    const receipt = this.#store.append({ session_id: spec.session_id, expected_version: 0, events: [event] });
    if (receipt.current_version !== 1 || receipt.events.length !== 1 || !equal(receipt.events[0], event)) {
      throw new AgentRuntimeError('session creation receipt is invalid', 'AGENT_RUNTIME_APPEND_RECEIPT_INVALID');
    }
    return this.#operationResult('create', input, true, false, [event.event_id]);
  }

  #requestCancellation(sessionId, reason, cascade, source, active = null) {
    const state = this.#store.replay(sessionId);
    if (state.terminal_event || state.cancellation_request) return state.cancellation_request;
    return this.#append(sessionId, 'session.cancellation.requested', { reason, cascade, source }, [source], active);
  }

  #cancelActiveWork(active, reason) {
    let accepted = false;
    if (active.request) {
      const { provider, providerId, requestId } = active.request;
      const result = provider.cancel({
        schema_version: CONTRACT_SCHEMA_VERSION,
        request_id: requestId,
        provider_id: providerId,
        reason,
      });
      accepted = result.accepted === true || accepted;
    }
    if (active.tool) {
      const result = this.#tools.cancel({
        schema_version: CONTRACT_SCHEMA_VERSION,
        invocation_id: active.tool.invocation_id,
        session_id: active.sessionId,
        turn_id: active.tool.turn_id,
        tool_call_id: active.tool.tool_call_id,
        reason,
      });
      accepted = result.accepted === true || accepted;
    }
    return accepted;
  }

  #armDeadline(active, state) {
    const createdAt = Date.parse(this.#store.readSession(state.session_id)[0].occurred_at);
    const deadlineAt = createdAt + state.spec.limits.max_duration_ms;
    const remaining = deadlineAt - this.#nowMs();
    const expire = () => {
      if (this.#store.replay(active.sessionId).terminal_event) return;
      try {
        this.#requestCancellation(active.sessionId, 'agent session duration limit exceeded', true, 'deadline', active);
        active.deadline = true;
        this.#cancelActiveWork(active, 'agent session duration limit exceeded');
      } catch (error) {
        active.controlError = error;
        this.#cancelActiveWork(active, 'agent runtime control failure');
      }
    };
    if (remaining <= 0) {
      expire();
      return null;
    }
    return setTimeout(expire, remaining);
  }

  #settleCancellation(state, active) {
    if (state.terminal_event) return state;
    const cancellation = state.cancellation_request;
    if (!cancellation) return state;
    for (const turn of Object.values(state.turns)) {
      for (const step of turn.model_steps) {
        if (step.model_events.some((event) => ['completed', 'failed'].includes(event.event_type))) continue;
        this.#append(
          state.session_id,
          'model.streamed',
          {
            turn_id: turn.turn_id,
            step_id: step.step_id,
            provider_id: step.request.provider_id,
            event: {
              schema_version: CONTRACT_SCHEMA_VERSION,
              provider_id: step.request.provider_id,
              request_id: step.request.request_id,
              event_type: 'completed',
              sequence: step.model_events.length,
              payload: {
                finish_reason: 'cancelled',
                provider_response_ref: `runtime-cancelled://${step.request.request_id}`,
              },
            },
          },
          [step.step_id, 'recovery-cancelled'],
          active,
        );
      }
      if (
        turn.model_steps.length === 0 &&
        turn.model_events.length > 0 &&
        !turn.model_events.some((event) => ['completed', 'failed'].includes(event.event_type))
      ) {
        this.#append(
          state.session_id,
          'model.streamed',
          {
            turn_id: turn.turn_id,
            provider_id: turn.request.provider_id,
            event: {
              schema_version: CONTRACT_SCHEMA_VERSION,
              provider_id: turn.request.provider_id,
              request_id: turn.request.request_id,
              event_type: 'completed',
              sequence: turn.model_events.length,
              payload: {
                finish_reason: 'cancelled',
                provider_response_ref: `runtime-cancelled://${turn.request.request_id}`,
              },
            },
          },
          [turn.turn_id, 'legacy-recovery-cancelled'],
          active,
        );
      }
    }
    state = this.#store.replay(state.session_id);
    let uncertainTool = false;
    for (const execution of Object.values(state.tool_invocations)) {
      if (execution.outcome) continue;
      uncertainTool = true;
      this.#append(
        state.session_id,
        'tool.execution.completed',
        {
          turn_id: execution.turn_id,
          step_id: execution.step_id,
          outcome: {
            schema_version: CONTRACT_SCHEMA_VERSION,
            invocation_id: execution.invocation_id,
            session_id: state.session_id,
            turn_id: execution.turn_id,
            tool_call_id: execution.tool_call_id,
            name: execution.name,
            status: 'uncertain',
            operation_id: null,
            result: null,
            error: {
              code: 'EXECUTION_OUTCOME_IN_DOUBT',
              message: 'interrupted governed tool execution has no reconstructed terminal outcome',
              retryable: false,
            },
            evidence_refs: [],
            warnings: [],
            replayed: false,
          },
        },
        [execution.step_id, execution.tool_call_id, 'recovery-uncertain'],
        active,
      );
    }
    state = this.#store.replay(state.session_id);
    if (uncertainTool) {
      this.#append(
        state.session_id,
        'session.failed',
        { error_code: 'tool_failed', message: 'interrupted governed tool outcome is in doubt', retryable: false },
        ['cancel-tool-uncertain'],
        active,
      );
      return this.#store.replay(state.session_id);
    }
    if (cancellation.source === 'deadline') {
      this.#append(
        state.session_id,
        'session.failed',
        { error_code: 'timeout', message: cancellation.reason, retryable: false },
        ['deadline-terminal'],
        active,
      );
    } else {
      this.#append(
        state.session_id,
        'session.cancelled',
        { reason: cancellation.reason, cascade: cancellation.cascade },
        ['cancel-terminal'],
        active,
      );
    }
    return this.#store.replay(state.session_id);
  }

  #fail(state, failure, active, identity = 'failure') {
    if (state.terminal_event) return state;
    this.#append(state.session_id, 'session.failed', normalizedFailure(failure), [identity], active);
    return this.#store.replay(state.session_id);
  }

  #complete(state, outcomeRef, active) {
    if (state.terminal_event) return state;
    this.#append(state.session_id, 'session.completed', { outcome_ref: outcomeRef }, ['completed'], active);
    return this.#store.replay(state.session_id);
  }

  #assemble(state, turn, active) {
    const profile = this.#profile(state.spec);
    const tools = this.#tools.list({ schema_version: CONTRACT_SCHEMA_VERSION, session_id: state.session_id }).tools;
    const requestId = stableId('request', state.session_id, turn.turn_id, 0);
    const eventId = stableId('event', state.session_id, 'context.assembled', turn.turn_id);
    const compactionFields =
      profile.overflow_policy === 'compact'
        ? {
            compaction_id: stableId('compaction', state.session_id, turn.turn_id),
            compaction_event_id: stableId('event', state.session_id, 'compaction.completed', turn.turn_id),
            compaction_provider_id: profile.compaction_provider_id,
          }
        : {};
    const assembled = this.#contextAssembler.assembleAndRecord({
      schema_version: CONTRACT_SCHEMA_VERSION,
      request_id: requestId,
      turn_id: turn.turn_id,
      event_id: eventId,
      ...compactionFields,
      occurred_at: this.#timestamp(),
      expected_version: state.current_sequence,
      session: state.spec,
      instructions: profile.instructions,
      runtime_context: profile.runtime_context,
      references: profile.references,
      memory: profile.memory,
      current_turn: { source_ref: eventRef(turn.input_event_id), message: turn.input },
      tools,
      parameters: profile.parameters,
      overflow_policy: profile.overflow_policy,
    });
    if (assembled.compaction_event) active.eventIds.push(assembled.compaction_event.event_id);
    active.eventIds.push(assembled.event.event_id);
    return this.#store.replay(state.session_id);
  }

  #startStep(state, turn, request, sourceEventIds, active) {
    const index = turn.model_steps.length;
    const stepId = stableId('step', state.session_id, turn.turn_id, index);
    const projected = tokenUsage(state) + Buffer.byteLength(canonicalJson(request), 'utf8') + request.parameters.max_output_tokens;
    if (projected > state.spec.limits.max_tokens) {
      return this.#fail(
        state,
        { code: 'budget_exceeded', message: 'session token budget cannot reserve another model step' },
        active,
        'token-budget',
      );
    }
    this.#append(
      state.session_id,
      'model.request.started',
      { turn_id: turn.turn_id, step_id: stepId, request, source_event_ids: sourceEventIds },
      [turn.turn_id, stepId],
      active,
    );
    return this.#store.replay(state.session_id);
  }

  #recordModelFailure(state, turn, step, error, active, identity) {
    const failure = normalizedFailure(error);
    const current = this.#store.replay(state.session_id);
    const currentStep = current.turns[turn.turn_id].model_steps_by_id[step.step_id];
    if (!currentStep.model_events.some((event) => ['completed', 'failed'].includes(event.event_type))) {
      this.#append(
        state.session_id,
        'model.streamed',
        {
          turn_id: turn.turn_id,
          step_id: step.step_id,
          provider_id: step.request.provider_id,
          event: {
            schema_version: CONTRACT_SCHEMA_VERSION,
            provider_id: step.request.provider_id,
            request_id: step.request.request_id,
            event_type: 'failed',
            sequence: currentStep.model_events.length,
            payload: failure,
          },
        },
        [step.step_id, 'runtime-failed'],
        active,
      );
    }
    return this.#fail(this.#store.replay(state.session_id), failure, active, identity);
  }

  #recordModelCancellation(state, turn, step, active) {
    const current = this.#store.replay(state.session_id);
    const currentStep = current.turns[turn.turn_id].model_steps_by_id[step.step_id];
    if (!currentStep.model_events.some((event) => ['completed', 'failed'].includes(event.event_type))) {
      this.#append(
        state.session_id,
        'model.streamed',
        {
          turn_id: turn.turn_id,
          step_id: step.step_id,
          provider_id: step.request.provider_id,
          event: {
            schema_version: CONTRACT_SCHEMA_VERSION,
            provider_id: step.request.provider_id,
            request_id: step.request.request_id,
            event_type: 'completed',
            sequence: currentStep.model_events.length,
            payload: {
              finish_reason: 'cancelled',
              provider_response_ref: `runtime-cancelled://${step.request.request_id}`,
            },
          },
        },
        [step.step_id, 'runtime-cancelled'],
        active,
      );
    }
    return this.#settleCancellation(this.#store.replay(state.session_id), active);
  }

  async #streamStep(state, turn, step, active) {
    const entry = this.#providers.resolve(state.spec.execution.model_provider_id, state.spec.execution.model);
    let stream;
    try {
      stream = validatePortResult('ModelProvider', 'stream', entry.provider.stream(step.request), step.request);
    } catch (error) {
      return this.#recordModelFailure(state, turn, step, error, active, `provider-start:${step.step_id}`);
    }
    active.request = {
      provider: entry.provider,
      providerId: step.request.provider_id,
      requestId: step.request.request_id,
    };
    try {
      let terminal = false;
      for await (const modelEvent of stream) {
        if (active.controlError) throw active.controlError;
        const currentStep = this.#store.replay(state.session_id).turns[turn.turn_id].model_steps_by_id[step.step_id];
        const eventBytes = Buffer.byteLength(canonicalJson(modelEvent), 'utf8') + (currentStep.model_events.length === 0 ? 0 : 1);
        const nextBytes = currentStep.model_stream_bytes + eventBytes;
        const isTerminal = ['completed', 'failed'].includes(modelEvent.event_type);
        if (
          currentStep.model_events.length >= this.#streamCaps.max_events_per_step ||
          (!isTerminal && currentStep.model_events.length >= this.#streamCaps.max_events_per_step - 1) ||
          nextBytes > this.#streamCaps.max_bytes_per_step ||
          (!isTerminal && nextBytes > this.#streamCaps.max_bytes_per_step - MODEL_TERMINAL_RESERVE_BYTES)
        ) {
          throw new AgentRuntimeError('model stream exceeded its configured cumulative bound', 'AGENT_RUNTIME_MODEL_STREAM_LIMIT');
        }
        this.#append(
          state.session_id,
          'model.streamed',
          { turn_id: turn.turn_id, step_id: step.step_id, provider_id: step.request.provider_id, event: modelEvent },
          [step.step_id, modelEvent.sequence],
          active,
        );
        terminal = ['completed', 'failed'].includes(modelEvent.event_type);
        if (terminal) break;
      }
      state = this.#store.replay(state.session_id);
      if (!terminal) {
        return this.#recordModelFailure(
          state,
          turn,
          step,
          { code: 'protocol_error', message: 'model stream ended without a terminal event' },
          active,
          'provider-eof',
        );
      }
      return state;
    } catch (error) {
      state = this.#store.replay(state.session_id);
      if (state.cancellation_request) return this.#recordModelCancellation(state, turn, step, active);
      return this.#recordModelFailure(state, turn, step, error, active, `provider-stream:${step.step_id}`);
    } finally {
      active.request = null;
    }
  }

  #toolInput(state, turn, step, call) {
    return {
      schema_version: CONTRACT_SCHEMA_VERSION,
      invocation_id: stableId('invocation', state.session_id, turn.turn_id, call.tool_call_id),
      session_id: state.session_id,
      turn_id: turn.turn_id,
      tool_call_id: call.tool_call_id,
      name: call.name,
      input: call.input,
      actor: { type: 'agent', id: state.spec.agent_id },
      resource_scope: {
        session_id: state.session_id,
        authority_ref: state.spec.authority_ref,
        policy_ref: state.spec.policy_ref,
      },
      idempotency_key: stableId('idempotency', state.session_id, turn.turn_id, call.tool_call_id),
      correlation_id: this.#store.traceContext(state.session_id).trace_id,
      causation_id: step.request_event_id,
      approval_context: null,
    };
  }

  async #executeTools(state, turn, step, active) {
    const calls = assembledToolCalls(step.model_events);
    if (calls.length === 0) return this.#fail(state, { code: 'protocol_error', message: 'tool_calls finish contained no calls' }, active);
    for (const call of calls) {
      state = this.#store.replay(state.session_id);
      if (state.cancellation_request) return this.#settleCancellation(state, active);
      turn = state.turns[turn.turn_id];
      step = turn.model_steps_by_id[step.step_id];
      let execution = turn.tool_executions[call.tool_call_id];
      const toolInput = this.#toolInput(state, turn, step, call);
      if (!execution) {
        if (Object.keys(state.tool_invocations).length >= state.spec.limits.max_tool_calls) {
          return this.#fail(state, { code: 'budget_exceeded', message: 'session tool-call limit exhausted' }, active, 'tool-budget');
        }
        this.#append(
          state.session_id,
          'tool.execution.started',
          {
            turn_id: turn.turn_id,
            step_id: step.step_id,
            invocation_id: toolInput.invocation_id,
            tool_call_id: call.tool_call_id,
            name: call.name,
            input: call.input,
            idempotency_key: toolInput.idempotency_key,
          },
          [step.step_id, call.tool_call_id, 'started'],
          active,
        );
        state = this.#store.replay(state.session_id);
        execution = state.turns[turn.turn_id].tool_executions[call.tool_call_id];
      }
      if (
        execution.invocation_id !== toolInput.invocation_id ||
        execution.idempotency_key !== toolInput.idempotency_key ||
        execution.name !== toolInput.name ||
        !equal(execution.input, toolInput.input)
      ) {
        return this.#fail(state, { code: 'protocol_error', message: 'durable tool intent differs from runtime derivation' }, active);
      }
      if (!execution.outcome) {
        active.tool = { invocation_id: toolInput.invocation_id, turn_id: turn.turn_id, tool_call_id: call.tool_call_id };
        let outcome;
        try {
          outcome = await this.#tools.execute(toolInput);
        } catch (error) {
          active.tool = null;
          const uncertain = {
            schema_version: CONTRACT_SCHEMA_VERSION,
            invocation_id: toolInput.invocation_id,
            session_id: state.session_id,
            turn_id: turn.turn_id,
            tool_call_id: call.tool_call_id,
            name: call.name,
            status: 'uncertain',
            operation_id: null,
            result: null,
            error: {
              code: 'EXECUTION_OUTCOME_IN_DOUBT',
              message: 'governed tool boundary did not return a canonical outcome',
              retryable: false,
            },
            evidence_refs: [],
            warnings: [],
            replayed: false,
          };
          this.#append(
            state.session_id,
            'tool.execution.completed',
            { turn_id: turn.turn_id, step_id: step.step_id, outcome: uncertain },
            [step.step_id, call.tool_call_id, 'uncertain'],
            active,
          );
          return this.#fail(
            this.#store.replay(state.session_id),
            { code: 'tool_failed', message: 'governed tool outcome is in doubt', retryable: false, cause: error },
            active,
            `tool:${call.tool_call_id}`,
          );
        }
        active.tool = null;
        this.#append(
          state.session_id,
          'tool.execution.completed',
          { turn_id: turn.turn_id, step_id: step.step_id, outcome },
          [step.step_id, call.tool_call_id, 'completed'],
          active,
        );
        if (outcome.operation_id) {
          this.#append(
            state.session_id,
            'tool.operation_linked',
            { turn_id: turn.turn_id, tool_call_id: call.tool_call_id, operation_id: outcome.operation_id },
            [call.tool_call_id, outcome.operation_id],
            active,
          );
        }
      }
    }
    state = this.#store.replay(state.session_id);
    if (state.cancellation_request) return this.#settleCancellation(state, active);
    turn = state.turns[turn.turn_id];
    step = turn.model_steps_by_id[step.step_id];
    const content = step.model_events
      .filter((event) => event.event_type === 'content.delta')
      .map((event) => event.payload.text)
      .join('');
    const assistant = { role: 'assistant', content, tool_calls: calls };
    const toolMessages = calls.map((call) => {
      const outcome = turn.tool_executions[call.tool_call_id].outcome;
      return {
        role: 'tool',
        name: call.name,
        tool_call_id: call.tool_call_id,
        content: canonicalJson({
          status: outcome.status,
          result: outcome.result,
          error: outcome.error,
          evidence_refs: outcome.evidence_refs,
          warnings: outcome.warnings,
        }),
      };
    });
    const requestId = stableId('request', state.session_id, turn.turn_id, turn.model_steps.length);
    const fullMessages = [...step.request.messages, assistant, ...toolMessages];
    const providerManifest = this.#providers.resolve(step.request.provider_id, step.request.model).manifest;
    const inputLimit = providerManifest.limits.context_tokens - step.request.parameters.max_output_tokens;
    const fullInputTokens = Buffer.byteLength(
      canonicalJson({ messages: fullMessages, tools: step.request.tools, parameters: step.request.parameters }),
      'utf8',
    );
    let continuationMessages = fullMessages;
    let sourceEventIds = [step.terminal_event_id, ...calls.map((call) => turn.tool_executions[call.tool_call_id].completed_event_id)];
    const profile = this.#profile(state.spec);
    if (profile.overflow_policy === 'compact') {
      if (!this.#compactionRuntime) {
        return this.#fail(state, { code: 'budget_exceeded', message: 'tool continuation requires unavailable compaction' }, active);
      }
      const pressure = this.#compactionRuntime.assess({
        schema_version: CONTRACT_SCHEMA_VERSION,
        provider_id: profile.compaction_provider_id,
        session_id: state.session_id,
        turn_id: turn.turn_id,
        trigger: 'tool_result_pressure',
        input_tokens: fullInputTokens,
        input_limit_tokens: inputLimit,
      });
      if (pressure.should_compact) {
        const completedIds = calls.map((call) => turn.tool_executions[call.tool_call_id].completed_event_id);
        let record = turn.tool_compactions.find((candidate) => equal(candidate.source_event_ids, completedIds));
        if (!record) {
          const compactionId = stableId('compaction', state.session_id, turn.turn_id, step.step_id, 'tools');
          const eventSequence = new Map(this.#store.readSession(state.session_id).map((event) => [event.event_id, event.sequence]));
          try {
            record = this.#compactionRuntime.compact(
              {
                schema_version: CONTRACT_SCHEMA_VERSION,
                provider_id: profile.compaction_provider_id,
                compaction_id: compactionId,
                session_id: state.session_id,
                turn_id: turn.turn_id,
                trigger: 'tool_result_pressure',
                strategy: 'tool_result_prune',
                target_tokens: Math.max(1, inputLimit - (fullInputTokens - Buffer.byteLength(canonicalJson(toolMessages), 'utf8'))),
                sources: calls.map((call, index) => ({
                  source_event_id: completedIds[index],
                  source_ref: eventRef(completedIds[index]),
                  sequence: eventSequence.get(completedIds[index]),
                  message: toolMessages[index],
                })),
              },
              [],
              (result) => {
                const candidateMessages = [...step.request.messages, assistant, ...result.replacement_messages];
                const candidateTokens = Buffer.byteLength(
                  canonicalJson({ messages: candidateMessages, tools: step.request.tools, parameters: step.request.parameters }),
                  'utf8',
                );
                return candidateTokens <= inputLimit;
              },
            );
          } catch (error) {
            if (
              fullInputTokens <= inputLimit &&
              error instanceof CompactionRuntimeError &&
              ['COMPACTION_PROVIDER_FAILED', 'COMPACTION_REPLACEMENT_REJECTED'].includes(error.code)
            ) {
              record = null;
            } else {
              return this.#fail(state, { code: 'budget_exceeded', message: 'tool result compaction failed' }, active);
            }
          }
          if (record) {
            const compactionEvent = this.#append(
              state.session_id,
              'compaction.completed',
              record,
              [turn.turn_id, step.step_id, 'tool-results'],
              active,
            );
            record = { ...record, event_id: compactionEvent.event_id };
          }
        }
        if (record) {
          continuationMessages = [...step.request.messages, assistant, ...record.replacement_messages];
          sourceEventIds = [step.terminal_event_id, record.event_id];
        }
      }
    }
    if (
      Buffer.byteLength(
        canonicalJson({ messages: continuationMessages, tools: step.request.tools, parameters: step.request.parameters }),
        'utf8',
      ) > inputLimit
    ) {
      return this.#fail(state, { code: 'budget_exceeded', message: 'tool continuation exceeds provider context' }, active);
    }
    const request = parseContract(
      ModelRequestSchema,
      { ...step.request, request_id: requestId, messages: continuationMessages },
      'tool continuation model request',
    );
    return this.#startStep(state, turn, request, sourceEventIds, active);
  }

  async #drive(active) {
    let state = this.#store.replay(active.sessionId);
    const timer = this.#armDeadline(active, state);
    try {
      for (let iteration = 0; iteration < RUNTIME_CAPS.max_tool_calls * 4 + 16; iteration++) {
        state = this.#store.replay(active.sessionId);
        if (active.controlError) throw active.controlError;
        if (state.terminal_event) return state;
        if (state.cancellation_request && !active.request && !active.tool) return this.#settleCancellation(state, active);
        const turnId = state.turn_order.at(-1);
        if (!turnId) return state;
        let turn = state.turns[turnId];
        if (!turn.request) {
          state = this.#assemble(state, turn, active);
          turn = state.turns[turnId];
        }
        if (turn.model_steps.length === 0) {
          if (turn.model_events.length > 0) {
            const legacyTerminal = turn.model_events.find((event) => ['completed', 'failed'].includes(event.event_type));
            if (!legacyTerminal) {
              this.#append(
                state.session_id,
                'model.streamed',
                {
                  turn_id: turn.turn_id,
                  provider_id: turn.request.provider_id,
                  event: {
                    schema_version: CONTRACT_SCHEMA_VERSION,
                    provider_id: turn.request.provider_id,
                    request_id: turn.request.request_id,
                    event_type: 'failed',
                    sequence: turn.model_events.length,
                    payload: {
                      error_code: 'protocol_error',
                      message: 'partial legacy model stream cannot be safely resumed',
                      retryable: false,
                    },
                  },
                },
                [turn.turn_id, 'legacy-partial-terminal'],
                active,
              );
              state = this.#store.replay(state.session_id);
              return this.#fail(
                state,
                { code: 'protocol_error', message: 'partial legacy model stream cannot be safely resumed' },
                active,
                'legacy-partial',
              );
            }
            if (legacyTerminal.event_type === 'failed') {
              return this.#fail(state, legacyTerminal.payload, active, 'legacy-model-failed');
            }
            if (legacyTerminal.payload.finish_reason === 'stop') {
              return this.#complete(state, legacyTerminal.payload.provider_response_ref, active);
            }
            if (legacyTerminal.payload.finish_reason === 'length') {
              return this.#fail(state, { code: 'budget_exceeded', message: 'legacy model output limit reached' }, active, 'legacy-length');
            }
            if (legacyTerminal.payload.finish_reason === 'cancelled') {
              return this.#fail(state, { code: 'cancelled', message: 'legacy model request was cancelled' }, active, 'legacy-cancelled');
            }
            return this.#fail(
              state,
              { code: 'protocol_error', message: 'legacy tool-call stream cannot be continued without durable step lineage' },
              active,
              'legacy-tool-calls',
            );
          }
          state = this.#startStep(state, turn, turn.request, [turn.request_event_id], active);
          if (state.terminal_event) return state;
          turn = state.turns[turnId];
        }
        let step = turn.model_steps.at(-1);
        const terminal = step.model_events.find((event) => ['completed', 'failed'].includes(event.event_type));
        if (!terminal) {
          if (step.model_events.length > 0) {
            return this.#recordModelFailure(
              state,
              turn,
              step,
              { code: 'protocol_error', message: 'partial model stream cannot be safely resumed' },
              active,
              `partial:${step.step_id}`,
            );
          }
          state = await this.#streamStep(state, turn, step, active);
          continue;
        }
        if (terminal.event_type === 'failed') return this.#fail(state, terminal.payload, active, `model-failed:${step.step_id}`);
        if (terminal.payload.finish_reason === 'cancelled') {
          if (!state.cancellation_request) {
            this.#requestCancellation(state.session_id, 'model provider cancelled the request', true, 'user', active);
            state = this.#store.replay(state.session_id);
          }
          return this.#settleCancellation(state, active);
        }
        if (terminal.payload.finish_reason === 'length') {
          return this.#fail(state, { code: 'budget_exceeded', message: 'model output limit reached' }, active, `length:${step.step_id}`);
        }
        if (tokenUsage(state) > state.spec.limits.max_tokens) {
          return this.#fail(state, { code: 'budget_exceeded', message: 'session token budget exhausted' }, active, 'token-budget');
        }
        if (terminal.payload.finish_reason === 'stop') return this.#complete(state, terminal.payload.provider_response_ref, active);
        state = await this.#executeTools(state, turn, step, active);
      }
      return this.#fail(state, { code: 'budget_exceeded', message: 'agent loop iteration cap exhausted' }, active, 'loop-cap');
    } catch (error) {
      state = this.#store.replay(active.sessionId);
      if (state.cancellation_request) return this.#settleCancellation(state, active);
      return this.#fail(state, error, active, 'runtime-error');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async #run(method, input, setup) {
    const sessionId = input.session_id;
    if (this.#active.has(sessionId)) {
      throw new AgentRuntimeError('session already has active runtime work', 'AGENT_RUNTIME_SESSION_ACTIVE');
    }
    const active = { sessionId, request: null, tool: null, eventIds: [], deadline: false, controlError: null };
    this.#active.set(sessionId, active);
    try {
      await setup(active);
      const state = await this.#drive(active);
      return this.#operationResult(method, input, true, Boolean(state.terminal_event), active.eventIds);
    } finally {
      if (this.#active.get(sessionId) === active) this.#active.delete(sessionId);
    }
  }

  async send(value) {
    const input = validatePortInput('AgentRuntime', 'send', value);
    const existing = this.#store.replay(input.session_id);
    if (existing.terminal_event) return this.#operationResult('send', input, false, true, [existing.terminal_event.event_id]);
    if (existing.spec.execution.mode !== 'kernel') throw new AgentRuntimeError('session is not owned by the Agent Kernel');
    const existingTurn = existing.turns[input.turn_id];
    if (existingTurn && !equal(existingTurn.input, input.message)) {
      throw new AgentRuntimeError('turn identifier already has a different input', 'AGENT_RUNTIME_TURN_CONFLICT');
    }
    if (!existingTurn && existing.turn_order.length >= existing.spec.limits.max_turns) {
      const active = { eventIds: [] };
      const state = this.#fail(existing, { code: 'budget_exceeded', message: 'session turn limit exhausted' }, active, 'turn-budget');
      return this.#operationResult('send', input, true, true, active.eventIds.length ? active.eventIds : [state.terminal_event.event_id]);
    }
    return this.#run('send', input, async (active) => {
      if (!existingTurn) {
        this.#append(input.session_id, 'turn.started', { turn_id: input.turn_id, input: input.message }, [input.turn_id], active);
      }
    });
  }

  async resume(value) {
    const input = validatePortInput('AgentRuntime', 'resume', value);
    const state = this.#store.replay(input.session_id);
    if (state.current_sequence !== input.expected_sequence) {
      throw new AgentRuntimeError('resume sequence differs from durable state', 'AGENT_RUNTIME_RESUME_CONFLICT');
    }
    if (state.terminal_event) return this.#operationResult('resume', input, false, true, [state.terminal_event.event_id]);
    return this.#run('resume', input, async (active) => {
      this.#append(input.session_id, 'session.resumed', { from_sequence: input.expected_sequence }, [input.expected_sequence], active);
    });
  }

  async cancel(value) {
    const input = validatePortInput('AgentRuntime', 'cancel', value);
    let state = this.#store.replay(input.session_id);
    if (state.terminal_event) return this.#operationResult('cancel', input, false, true, [state.terminal_event.event_id]);
    const active = this.#active.get(input.session_id);
    const event = this.#requestCancellation(input.session_id, input.reason, input.cascade, 'user', active);
    if (active) {
      this.#cancelActiveWork(active, input.reason);
      return this.#operationResult('cancel', input, true, false, event ? [event.event_id] : []);
    }
    state = this.#settleCancellation(this.#store.replay(input.session_id), null);
    return this.#operationResult('cancel', input, true, true, [event.event_id, state.terminal_event.event_id]);
  }

  async dispose(value) {
    const input = validatePortInput('AgentRuntime', 'dispose', value);
    let state = this.#store.replay(input.session_id);
    if (state.terminal_event) {
      this.#tools.dispose({ schema_version: CONTRACT_SCHEMA_VERSION, session_id: input.session_id });
      return this.#operationResult('dispose', input, false, true, [state.terminal_event.event_id]);
    }
    const active = this.#active.get(input.session_id);
    const event = this.#requestCancellation(input.session_id, 'agent session disposed', true, 'dispose', active);
    this.#tools.dispose({ schema_version: CONTRACT_SCHEMA_VERSION, session_id: input.session_id });
    if (active) {
      this.#cancelActiveWork(active, 'agent session disposed');
      return this.#operationResult('dispose', input, true, false, event ? [event.event_id] : []);
    }
    state = this.#settleCancellation(this.#store.replay(input.session_id), null);
    return this.#operationResult('dispose', input, true, true, [event.event_id, state.terminal_event.event_id]);
  }

  snapshot() {
    return deepFreeze({ active_sessions: [...this.#active.keys()].sort() });
  }
}

Object.freeze(AgentRuntime.prototype);

module.exports = { AgentRuntime, AgentRuntimeError, RUNTIME_CAPS, STREAM_CAPS, stableId, tokenUsage };
