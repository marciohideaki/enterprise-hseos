'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  CONTEXT_ASSEMBLY_CONTRACT,
  CONTEXT_PRECEDENCE_PREAMBLE,
  CONTEXT_PRECEDENCE_REF,
  ContextBudgetReportSchema,
  ModelProviderManifestSchema,
  ModelRequestSchema,
  deepFreeze,
  parseContract,
} = require('../agent-runtime-contracts');
const { RelationalSessionEventStore, canonicalJson } = require('../agent-session-store');
const { ModelProviderRegistrySnapshot } = require('../model-providers');
const { ContextAssemblyInputSchema, HistorySourceSchema, MAX_CONTEXT_ASSEMBLY_BYTES } = require('./schemas');
const { ConservativeUtf8TokenCounter, deterministicCount, validateTokenCounter } = require('./token-counter');

const BUILTIN_PRECEDENCE_REF = CONTEXT_PRECEDENCE_REF;
const INSTRUCTION_TIERS = Object.freeze(['constitution', 'project', 'adapter', 'agent', 'skill']);
const PRECEDENCE_PREAMBLE = CONTEXT_PRECEDENCE_PREAMBLE;

class ContextAssemblyError extends Error {
  constructor(message, code = 'AGENT_CONTEXT_INVALID', details = {}) {
    super(message);
    this.name = 'ContextAssemblyError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

class ContextBudgetError extends ContextAssemblyError {
  constructor(message, details) {
    super(message, 'AGENT_CONTEXT_BUDGET_EXCEEDED', details);
    this.name = 'ContextBudgetError';
  }
}

function quotedData(kind, source) {
  return {
    role: 'system',
    content: `[HSEOS ${kind} source=${JSON.stringify(source.source_ref)} classification=${source.classification}]\n${JSON.stringify(
      source.content,
    )}\n[END HSEOS ${kind}]`,
  };
}

function instructionMessage(tier, source) {
  return {
    role: 'system',
    content: `[HSEOS INSTRUCTION tier=${tier} source=${JSON.stringify(source.source_ref)}]\n${source.content}\n[END HSEOS INSTRUCTION]`,
  };
}

function bySourceRef(left, right) {
  if (left.source_ref < right.source_ref) return -1;
  if (left.source_ref > right.source_ref) return 1;
  return 0;
}

function orderedInstructions(instructions) {
  return INSTRUCTION_TIERS.flatMap((tier) =>
    [...instructions[tier]].sort(bySourceRef).map((source) => ({ source, message: instructionMessage(tier, source) })),
  );
}

function orderedHistory(history) {
  return [...history].sort((left, right) => left.sequence - right.sequence || bySourceRef(left, right));
}

function orderedMemory(memory) {
  return [...memory].sort((left, right) => right.priority - left.priority || bySourceRef(left, right));
}

function uniqueReferences(references) {
  return [...new Set(references)];
}

function durableHistory(state, currentTurnId) {
  const history = [];
  for (const turnId of state.turn_order) {
    if (turnId === currentTurnId) break;
    const turn = state.turns[turnId];
    history.push(parseContract(HistorySourceSchema, {
      source_ref: `session-event://${turn.input_event_id}`,
      sequence: turn.input_event_sequence,
      message: turn.input,
    }, 'durable user history'));
    const terminalIndex = turn.model_events.findIndex((event) => event.event_type === 'completed');
    const content = turn.model_events
      .slice(0, terminalIndex < 0 ? 0 : terminalIndex)
      .filter((event) => event.event_type === 'content.delta')
      .map((event) => event.payload.text)
      .join('');
    if (terminalIndex >= 0 && content.length > 0) {
      history.push(parseContract(HistorySourceSchema, {
        source_ref: `session-event://${turn.model_event_ids[terminalIndex]}`,
        sequence: turn.model_event_sequences[terminalIndex],
        message: { role: 'assistant', content },
      }, 'durable assistant history'));
    }
  }
  if (history.length > 2048) throw new ContextAssemblyError('durable history exceeds the entry limit');
  if (Buffer.byteLength(canonicalJson(history), 'utf8') > MAX_CONTEXT_ASSEMBLY_BYTES) {
    throw new ContextAssemblyError('durable history exceeds the assembly byte limit');
  }
  return history;
}

function remainingSessionTokens(state, excludedTurnId) {
  let consumed = 0;
  for (const [turnId, turn] of Object.entries(state.turns)) {
    if (turnId === excludedTurnId) continue;
    if (!turn.budget) continue;
    consumed += turn.budget.input_tokens;
    const usageEvents = turn.model_events.filter((event) => event.event_type === 'usage');
    consumed +=
      usageEvents.length === 0
        ? turn.budget.reserved_output_tokens
        : usageEvents.reduce((total, event) => total + event.payload.output_tokens, 0);
    if (!Number.isSafeInteger(consumed)) {
      throw new ContextBudgetError('durable token usage exceeds safe accounting bounds');
    }
  }
  return Math.max(0, state.spec.limits.max_tokens - consumed);
}

class ContextAssembler {
  #store;
  #tokenCounter;
  #counterId;
  #countCache = new Map();
  #providerSnapshot;

  constructor({ session_store, model_provider_snapshot, token_counter = new ConservativeUtf8TokenCounter() }) {
    if (!(session_store instanceof RelationalSessionEventStore)) {
      throw new ContextAssemblyError('session store must be a verified RelationalSessionEventStore');
    }
    if (!(model_provider_snapshot instanceof ModelProviderRegistrySnapshot)) {
      throw new ContextAssemblyError('model provider snapshot must come from ModelProviderRegistry.snapshot()');
    }
    const validatedCounter = validateTokenCounter(token_counter);
    this.#store = session_store;
    this.#tokenCounter = validatedCounter;
    this.#counterId = validatedCounter.counter_id;
    this.#providerSnapshot = model_provider_snapshot;
  }

  #count(value) {
    const canonical = canonicalJson(value);
    const count = deterministicCount(this.#tokenCounter, canonical);
    const previous = this.#countCache.get(canonical);
    if (previous !== undefined && previous !== count) {
      throw new ContextAssemblyError('token counter changed for canonical input', 'AGENT_CONTEXT_COUNTER_NONDETERMINISTIC');
    }
    this.#countCache.set(canonical, count);
    return count;
  }

  #measure(messages, tools, parameters) {
    const messageTokens = this.#count(messages);
    const toolTokens = this.#count(tools);
    const parameterTokens = this.#count(parameters);
    return {
      message_tokens: messageTokens,
      tool_tokens: toolTokens,
      parameter_tokens: parameterTokens,
      input_tokens: messageTokens + toolTokens + parameterTokens,
    };
  }

  #compose(input, includedHistory, includedMemory) {
    const instructionItems = orderedInstructions(input.instructions);
    const runtimeItems = [...input.runtime_context].sort(bySourceRef);
    const referenceItems = [...input.references].sort(bySourceRef);
    const memoryItems = orderedMemory(includedMemory);
    const historyItems = orderedHistory(includedHistory);
    const messages = [
      { role: 'system', content: PRECEDENCE_PREAMBLE },
      ...instructionItems.map((item) => item.message),
      ...runtimeItems.map((source) => quotedData('RUNTIME_DATA', source)),
      ...referenceItems.map((source) => quotedData('REFERENCE_DATA', source)),
      ...memoryItems.map((source) => quotedData('MEMORY_DATA', source)),
      ...historyItems.map((entry) => entry.message),
      input.current_turn.message,
    ];
    const tools = [...input.tools].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    const sourceRefs = uniqueReferences([
      BUILTIN_PRECEDENCE_REF,
      ...instructionItems.map((item) => item.source.source_ref),
      ...runtimeItems.map((source) => source.source_ref),
      ...referenceItems.map((source) => source.source_ref),
      ...memoryItems.map((source) => source.source_ref),
      ...historyItems.map((entry) => entry.source_ref),
      input.current_turn.source_ref,
      ...tools.map((tool) => tool.governance_ref),
    ]);
    return { messages, tools, source_refs: sourceRefs, measurement: this.#measure(messages, tools, input.parameters) };
  }

  #budget(input, providerManifest, sessionRemainingTokens) {
    const contextLimit = Math.min(providerManifest.limits.context_tokens, sessionRemainingTokens);
    if (contextLimit < 1) throw new ContextBudgetError('session token budget is exhausted');
    const reservedOutput = input.parameters.max_output_tokens;
    if (reservedOutput > providerManifest.limits.max_output_tokens || reservedOutput > contextLimit) {
      throw new ContextBudgetError('reserved output exceeds provider or session limits', {
        context_limit_tokens: contextLimit,
        reserved_output_tokens: reservedOutput,
      });
    }
    const inputLimit = contextLimit - reservedOutput;
    const base = this.#compose(input, [], []);
    if (base.measurement.input_tokens > inputLimit) {
      throw new ContextBudgetError('required model context exceeds the input budget', {
        context_limit_tokens: contextLimit,
        input_limit_tokens: inputLimit,
        required_input_tokens: base.measurement.input_tokens,
      });
    }

    if (input.overflow_policy === 'reject') {
      const complete = this.#compose(input, input.history, input.memory);
      if (complete.measurement.input_tokens > inputLimit) {
        throw new ContextBudgetError('complete model context exceeds the input budget', {
          context_limit_tokens: contextLimit,
          input_limit_tokens: inputLimit,
          required_input_tokens: complete.measurement.input_tokens,
        });
      }
      return { composition: complete, omitted_source_refs: [], contextLimit, inputLimit, reservedOutput };
    }

    const selectedHistory = [];
    const selectedMemory = [];
    const omitted = [];
    let historyOverflowed = false;
    for (const entry of orderedHistory(input.history).reverse()) {
      if (historyOverflowed) {
        omitted.push(entry.source_ref);
        continue;
      }
      const candidate = this.#compose(input, [...selectedHistory, entry], selectedMemory);
      if (candidate.measurement.input_tokens <= inputLimit) selectedHistory.push(entry);
      else {
        historyOverflowed = true;
        omitted.push(entry.source_ref);
      }
    }
    for (const entry of orderedMemory(input.memory)) {
      const candidate = this.#compose(input, selectedHistory, [...selectedMemory, entry]);
      if (candidate.measurement.input_tokens <= inputLimit) selectedMemory.push(entry);
      else omitted.push(entry.source_ref);
    }
    return {
      composition: this.#compose(input, selectedHistory, selectedMemory),
      omitted_source_refs: omitted.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      contextLimit,
      inputLimit,
      reservedOutput,
    };
  }

  assembleAndRecord(inputValue) {
    const input = parseContract(ContextAssemblyInputSchema, inputValue, 'context assembly input');
    const durableState = this.#store.replay(input.session.session_id);
    const durableTurn = durableState.turns[input.turn_id];
    if (!durableTurn || durableState.turn_order.at(-1) !== input.turn_id) {
      throw new ContextAssemblyError('context assembly requires the latest durable turn', 'AGENT_CONTEXT_TURN_NOT_FOUND');
    }
    if (canonicalJson(durableState.spec) !== canonicalJson(input.session)) {
      throw new ContextAssemblyError('session specification differs from durable state', 'AGENT_CONTEXT_SESSION_MISMATCH');
    }
    if (canonicalJson(durableTurn.input) !== canonicalJson(input.current_turn.message)) {
      throw new ContextAssemblyError('current turn differs from its durable input', 'AGENT_CONTEXT_TURN_MISMATCH');
    }
    if (input.current_turn.source_ref !== `session-event://${durableTurn.input_event_id}`) {
      throw new ContextAssemblyError('current turn source does not identify its durable event', 'AGENT_CONTEXT_SOURCE_MISMATCH');
    }
    const providerEntry = this.#providerSnapshot.resolve(
      input.session.execution.model_provider_id,
      input.session.execution.model,
    );
    const providerManifest = parseContract(ModelProviderManifestSchema, providerEntry.manifest, 'registered model provider manifest');
    const enrichedInput = { ...input, history: durableHistory(durableState, input.turn_id) };
    const budgeted = this.#budget(enrichedInput, providerManifest, remainingSessionTokens(durableState, input.turn_id));
    const request = parseContract(
      ModelRequestSchema,
      {
        schema_version: CONTRACT_SCHEMA_VERSION,
        request_id: input.request_id,
        session_id: input.session.session_id,
        turn_id: input.turn_id,
        provider_id: providerManifest.provider_id,
        model: input.session.execution.model,
        messages: budgeted.composition.messages,
        tools: budgeted.composition.tools,
        parameters: input.parameters,
      },
      'assembled model request',
    );
    const budget = parseContract(
      ContextBudgetReportSchema,
      {
        counter_id: this.#counterId,
        context_limit_tokens: budgeted.contextLimit,
        reserved_output_tokens: budgeted.reservedOutput,
        input_limit_tokens: budgeted.inputLimit,
        input_tokens: budgeted.composition.measurement.input_tokens,
        message_tokens: budgeted.composition.measurement.message_tokens,
        tool_tokens: budgeted.composition.measurement.tool_tokens,
        parameter_tokens: budgeted.composition.measurement.parameter_tokens,
        overflow_policy: input.overflow_policy,
        omitted_source_refs: budgeted.omitted_source_refs,
      },
      'context budget report',
    );
    const appendResult = this.#store.append({
      session_id: input.session.session_id,
      expected_version: input.expected_version,
      events: [
        {
          schema_version: CONTRACT_SCHEMA_VERSION,
          event_id: input.event_id,
          session_id: input.session.session_id,
          sequence: input.expected_version + 1,
          occurred_at: input.occurred_at,
          event_type: 'context.assembled',
          payload: {
            assembly_contract: CONTEXT_ASSEMBLY_CONTRACT,
            turn_id: input.turn_id,
            request,
            source_refs: budgeted.composition.source_refs,
            budget,
          },
        },
      ],
    });
    if (
      !appendResult ||
      appendResult.current_version !== input.expected_version + 1 ||
      typeof appendResult.idempotent !== 'boolean' ||
      !Array.isArray(appendResult.events) ||
      appendResult.events.length !== 1 ||
      canonicalJson(appendResult.events[0]) !==
        canonicalJson({
          schema_version: CONTRACT_SCHEMA_VERSION,
          event_id: input.event_id,
          session_id: input.session.session_id,
          sequence: input.expected_version + 1,
          occurred_at: input.occurred_at,
          event_type: 'context.assembled',
          payload: {
            assembly_contract: CONTEXT_ASSEMBLY_CONTRACT,
            turn_id: input.turn_id,
            request,
            source_refs: budgeted.composition.source_refs,
            budget,
          },
        })
    ) {
      throw new ContextAssemblyError('session store returned an invalid append receipt', 'AGENT_CONTEXT_APPEND_RECEIPT_INVALID');
    }
    const reconstructed = this.#store.reconstructRequest(input.session.session_id, { turn_id: input.turn_id });
    if (
      reconstructed.source_event_id !== input.event_id ||
      reconstructed.canonical_json !== canonicalJson(request) ||
      canonicalJson(reconstructed.source_refs) !== canonicalJson(budgeted.composition.source_refs) ||
      canonicalJson(reconstructed.budget) !== canonicalJson(budget)
    ) {
      throw new ContextAssemblyError('durable context reconstruction mismatch', 'AGENT_CONTEXT_RECONSTRUCTION_MISMATCH');
    }
    return deepFreeze({
      request,
      budget,
      source_refs: budgeted.composition.source_refs,
      event: appendResult.events[0],
      current_version: appendResult.current_version,
      idempotent: appendResult.idempotent,
      reconstructed,
    });
  }
}

module.exports = {
  BUILTIN_PRECEDENCE_REF,
  ContextAssembler,
  ContextAssemblyError,
  ContextBudgetError,
  INSTRUCTION_TIERS,
  PRECEDENCE_PREAMBLE,
};
