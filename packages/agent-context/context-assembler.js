'use strict';

const {
  CONTRACT_SCHEMA_VERSION,
  CONTEXT_ASSEMBLY_CONTRACT,
  CONTEXT_ASSEMBLY_CONTRACT_V2,
  CONTEXT_PRECEDENCE_PREAMBLE,
  CONTEXT_PRECEDENCE_REF,
  ContextBudgetReportSchema,
  ModelProviderManifestSchema,
  ModelRequestSchema,
  ModelRequestV2Schema,
  deepFreeze,
  parseContract,
} = require('../agent-runtime-contracts');
const { canonicalJson, isRelationalSessionEventStore } = require('../agent-session-store');
const { ModelProviderRegistrySnapshot } = require('../model-providers');
const { CompactionRuntime, CompactionRuntimeError } = require('../agent-compaction');
const { ContextAssemblyInputSchema, HistorySourceSchema, MAX_CONTEXT_ASSEMBLY_BYTES } = require('./schemas');
const { resolveInputAuthority } = require('./authority');
const { ContextMediaError, assertMediaWithinLimits } = require('./media-store');
const {
  accountSessionTokens,
  ConservativeUtf8TokenCounter,
  deterministicCount,
  deterministicCountMedia,
  validateTokenCounter,
} = require('./token-counter');

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

// A source that declared v2 authority advertises it to the model; v1 sources render byte-identically to before.
function authorityAttributes(meta) {
  return meta?.declared ? ` authority=${meta.authority} origin=${meta.provenance.origin} trust=${meta.provenance.trust}` : '';
}

function quotedData(kind, source, meta) {
  return {
    role: 'system',
    content: `[HSEOS ${kind} source=${JSON.stringify(source.source_ref)} classification=${source.classification}${authorityAttributes(
      meta,
    )}]\n${JSON.stringify(source.content)}\n[END HSEOS ${kind}]`,
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

function orderedMedia(media) {
  return orderedMemory(media);
}

function sourceRecord(source, meta, extra = {}) {
  return {
    source_ref: source.source_ref,
    authority: meta.authority,
    origin: meta.provenance.origin,
    digest: meta.provenance.digest,
    trust: meta.provenance.trust,
    ...extra,
  };
}

function uniqueReferences(references) {
  return [...new Set(references)];
}

function durableHistory(state, currentTurnId) {
  const history = [];
  for (const turnId of state.turn_order) {
    if (turnId === currentTurnId) break;
    const turn = state.turns[turnId];
    history.push(
      parseContract(
        HistorySourceSchema,
        {
          source_event_id: turn.input_event_id,
          source_ref: `session-event://${turn.input_event_id}`,
          sequence: turn.input_event_sequence,
          message: turn.input,
        },
        'durable user history',
      ),
    );
    const terminalIndex = turn.model_events.findIndex((event) => event.event_type === 'completed');
    const content = turn.model_events
      .slice(0, Math.max(terminalIndex, 0))
      .filter((event) => event.event_type === 'content.delta')
      .map((event) => event.payload.text)
      .join('');
    if (terminalIndex !== -1 && content.length > 0) {
      history.push(
        parseContract(
          HistorySourceSchema,
          {
            source_event_id: turn.model_event_ids[terminalIndex],
            source_ref: `session-event://${turn.model_event_ids[terminalIndex]}`,
            sequence: turn.model_event_sequences[terminalIndex],
            message: { role: 'assistant', content },
          },
          'durable assistant history',
        ),
      );
    }
  }
  if (history.length > 2048) throw new ContextAssemblyError('durable history exceeds the entry limit');
  if (Buffer.byteLength(canonicalJson(history), 'utf8') > MAX_CONTEXT_ASSEMBLY_BYTES) {
    throw new ContextAssemblyError('durable history exceeds the assembly byte limit');
  }
  return history;
}

function remainingSessionTokens(state, excludedTurnId) {
  const usage = accountSessionTokens(state, { excluded_turn_id: excludedTurnId });
  return Math.max(0, state.spec.limits.max_tokens - usage.total_tokens);
}

class ContextAssembler {
  #compactionRuntime;
  #store;
  #tokenCounter;
  #counterId;
  #countCache = new Map();
  #providerSnapshot;
  #mediaStore;

  constructor({
    session_store,
    model_provider_snapshot,
    compaction_runtime = null,
    token_counter = new ConservativeUtf8TokenCounter(),
    media_store = null,
  }) {
    if (!isRelationalSessionEventStore(session_store)) {
      throw new ContextAssemblyError('session store must be a verified RelationalSessionEventStore');
    }
    if (!(model_provider_snapshot instanceof ModelProviderRegistrySnapshot)) {
      throw new ContextAssemblyError('model provider snapshot must come from ModelProviderRegistry.snapshot()');
    }
    if (compaction_runtime !== null && !(compaction_runtime instanceof CompactionRuntime)) {
      throw new ContextAssemblyError('compaction runtime must be a nominal CompactionRuntime');
    }
    const validatedCounter = validateTokenCounter(token_counter);
    this.#store = session_store;
    this.#tokenCounter = validatedCounter;
    this.#counterId = validatedCounter.counter_id;
    this.#providerSnapshot = model_provider_snapshot;
    this.#compactionRuntime = compaction_runtime;
    this.#mediaStore = media_store;
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

  #measure(messages, tools, parameters, mediaTokens) {
    // media cost is folded into message tokens so the v1 budget accounting identity keeps balancing
    const messageTokens = this.#count(messages) + mediaTokens;
    const toolTokens = this.#count(tools);
    const parameterTokens = this.#count(parameters);
    return {
      message_tokens: messageTokens,
      tool_tokens: toolTokens,
      parameter_tokens: parameterTokens,
      input_tokens: messageTokens + toolTokens + parameterTokens,
    };
  }

  #compose(input, includedHistory, includedMemory, includedMedia = input.required_media) {
    const instructionItems = orderedInstructions(input.instructions);
    const runtimeItems = [...input.runtime_context].sort(bySourceRef);
    const referenceItems = [...input.references].sort(bySourceRef);
    const memoryItems = orderedMemory(includedMemory);
    const historyItems = orderedHistory(includedHistory);
    const messages = [
      { role: 'system', content: PRECEDENCE_PREAMBLE },
      ...instructionItems.map((item) => item.message),
      ...runtimeItems.map((source) => quotedData('RUNTIME_DATA', source, input.authority.get(source.source_ref))),
      ...referenceItems.map((source) => quotedData('REFERENCE_DATA', source, input.authority.get(source.source_ref))),
      ...memoryItems.map((source) => quotedData('MEMORY_DATA', source, input.authority.get(source.source_ref))),
      ...historyItems.map((entry) => entry.message),
      input.current_turn.message,
    ];
    const tools = [...input.tools].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    const mediaItems = orderedMedia(includedMedia);
    const parts = mediaItems.map((media) => ({
      type: 'image',
      source_ref: media.source_ref,
      media_type: media.media_type,
      digest: media.digest,
      bytes: media.bytes,
      artifact_ref: media.artifact_ref,
    }));
    const mediaTokens = mediaItems.reduce((total, media) => total + input.media_tokens.get(media.source_ref), 0);
    const included = [
      ...instructionItems.map((item) => item.source),
      ...runtimeItems,
      ...referenceItems,
      ...memoryItems,
      input.current_turn,
    ];
    const sources = [
      ...included.map((source) => sourceRecord(source, input.authority.get(source.source_ref))),
      ...mediaItems.map((media) =>
        sourceRecord(media, input.authority.get(media.source_ref), {
          media_type: media.media_type,
          bytes: media.bytes,
          artifact_ref: media.artifact_ref,
        }),
      ),
    ];
    const sourceRefs = uniqueReferences([
      BUILTIN_PRECEDENCE_REF,
      ...instructionItems.map((item) => item.source.source_ref),
      ...runtimeItems.map((source) => source.source_ref),
      ...referenceItems.map((source) => source.source_ref),
      ...memoryItems.map((source) => source.source_ref),
      ...mediaItems.map((media) => media.source_ref),
      ...historyItems.map((entry) => entry.source_ref),
      input.current_turn.source_ref,
      ...tools.map((tool) => tool.governance_ref),
    ]);
    return {
      messages,
      tools,
      parts,
      sources,
      source_refs: sourceRefs,
      measurement: this.#measure(messages, tools, input.parameters, mediaTokens),
    };
  }

  // Greedy selection of the optional context (newest history first, then memory, then media) under the input limit.
  #selectOptional(input, inputLimit) {
    const selectedHistory = [];
    const selectedMemory = [];
    const selectedMedia = [...input.required_media];
    const omitted = [];
    let historyOverflowed = false;
    for (const entry of orderedHistory(input.history).toReversed()) {
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
    const requiredRefs = new Set(input.required_media.map((media) => media.source_ref));
    for (const entry of orderedMedia(input.media)) {
      if (requiredRefs.has(entry.source_ref)) continue;
      const candidate = this.#compose(input, selectedHistory, selectedMemory, [...selectedMedia, entry]);
      if (candidate.measurement.input_tokens <= inputLimit) selectedMedia.push(entry);
      else omitted.push(entry.source_ref);
    }
    return { selectedHistory, selectedMemory, selectedMedia, omitted };
  }

  #budget(input, providerManifest, sessionRemainingTokens, recordedCompaction = null) {
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

    if (recordedCompaction) {
      return this.#resumeRecordedCompaction(input, recordedCompaction, { contextLimit, inputLimit, reservedOutput });
    }
    const complete = this.#compose(input, input.history, input.memory, input.media);
    if (input.overflow_policy === 'reject') {
      if (complete.measurement.input_tokens > inputLimit) {
        throw new ContextBudgetError('complete model context exceeds the input budget', {
          context_limit_tokens: contextLimit,
          input_limit_tokens: inputLimit,
          required_input_tokens: complete.measurement.input_tokens,
        });
      }
      return { composition: complete, omitted_source_refs: [], contextLimit, inputLimit, reservedOutput };
    }

    if (complete.measurement.input_tokens <= inputLimit) {
      return { composition: complete, omitted_source_refs: [], contextLimit, inputLimit, reservedOutput };
    }

    const { selectedHistory, selectedMemory, selectedMedia, omitted } = this.#selectOptional(input, inputLimit);
    const ordinary = {
      composition: this.#compose(input, selectedHistory, selectedMemory, selectedMedia),
      omitted_source_refs: omitted.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      contextLimit,
      inputLimit,
      reservedOutput,
      compaction: null,
    };
    if (input.overflow_policy !== 'compact') return ordinary;
    if (!this.#compactionRuntime) {
      throw new ContextBudgetError('compact overflow policy requires a compaction runtime');
    }
    let retainedHistory = orderedHistory(selectedHistory);
    let retainedMemory = orderedMemory(selectedMemory);
    let compactedHistory = orderedHistory(input.history).filter(
      (entry) => !retainedHistory.some((retained) => retained.source_event_id === entry.source_event_id),
    );
    const omittedMemoryRefs = input.memory
      .filter((entry) => !retainedMemory.some((retained) => retained.source_ref === entry.source_ref))
      .map((entry) => entry.source_ref);
    if (compactedHistory.length === 0) return ordinary;
    const pressure = this.#compactionRuntime.assess({
      schema_version: CONTRACT_SCHEMA_VERSION,
      provider_id: input.compaction_provider_id,
      session_id: input.session.session_id,
      turn_id: input.turn_id,
      trigger: 'context_pressure',
      input_tokens: complete.measurement.input_tokens,
      input_limit_tokens: inputLimit,
    });
    if (!pressure.should_compact) {
      throw new ContextBudgetError('compaction provider declined an over-budget request');
    }
    let acceptedComposition = null;
    let record = null;
    for (let attempt = 0; attempt <= input.history.length + input.memory.length; attempt++) {
      const withoutReplacement = this.#compose(input, retainedHistory, retainedMemory, selectedMedia);
      const targetTokens = Math.max(1, inputLimit - withoutReplacement.measurement.input_tokens);
      try {
        record = this.#compactionRuntime.compact(
          {
            schema_version: CONTRACT_SCHEMA_VERSION,
            provider_id: input.compaction_provider_id,
            compaction_id: input.compaction_id,
            session_id: input.session.session_id,
            turn_id: input.turn_id,
            trigger: 'context_pressure',
            strategy: 'history_summary',
            target_tokens: targetTokens,
            sources: compactedHistory,
          },
          retainedHistory.map((entry) => entry.source_event_id),
          (result) => {
            const replacement = {
              source_event_id: input.compaction_event_id,
              source_ref: `session-event://${input.compaction_event_id}`,
              sequence: compactedHistory[0].sequence,
              message: result.replacement_messages[0],
            };
            const candidate = this.#compose(input, [replacement, ...retainedHistory], retainedMemory, selectedMedia);
            if (candidate.measurement.input_tokens > inputLimit) return false;
            acceptedComposition = candidate;
            return true;
          },
        );
        break;
      } catch (error) {
        if (!(error instanceof CompactionRuntimeError) || error.code !== 'COMPACTION_REPLACEMENT_REJECTED') throw error;
        if (retainedMemory.length > 0) {
          omittedMemoryRefs.push(retainedMemory.pop().source_ref);
          continue;
        }
        if (retainedHistory.length > 0) {
          compactedHistory.push(retainedHistory.shift());
          compactedHistory = orderedHistory(compactedHistory);
          continue;
        }
        throw new ContextBudgetError('compaction replacement cannot fit the model input budget');
      }
    }
    if (!record || !acceptedComposition) throw new ContextBudgetError('compaction did not converge within bounded attempts');
    return {
      composition: acceptedComposition,
      omitted_source_refs: [
        ...compactedHistory.map((entry) => entry.source_ref),
        ...omittedMemoryRefs,
        ...input.media.filter((entry) => !selectedMedia.includes(entry)).map((entry) => entry.source_ref),
      ].sort(),
      contextLimit,
      inputLimit,
      reservedOutput,
      compaction: record,
    };
  }

  // Resume of a turn whose compaction.completed is already durable but whose context.assembled is not: the recorded
  // replacement is reused as is. The provider is not invoked again and the compaction event is not written twice.
  #resumeRecordedCompaction(input, recorded, { contextLimit, inputLimit, reservedOutput }) {
    if (
      recorded.compaction_id !== input.compaction_id ||
      recorded.provider_id !== input.compaction_provider_id ||
      recorded.event_id !== input.compaction_event_id
    ) {
      throw new ContextAssemblyError(
        'durable compaction differs from the requested compaction identity',
        'AGENT_CONTEXT_COMPACTION_MISMATCH',
        { compaction_id: recorded.compaction_id },
      );
    }
    const compactedIds = new Set(recorded.source_event_ids);
    const retainedIds = new Set(recorded.retained_source_event_ids);
    const compactedHistory = orderedHistory(input.history).filter((entry) => compactedIds.has(entry.source_event_id));
    const retainedHistory = orderedHistory(input.history).filter((entry) => retainedIds.has(entry.source_event_id));
    if (compactedHistory.length !== compactedIds.size || retainedHistory.length !== retainedIds.size) {
      throw new ContextAssemblyError('durable compaction no longer partitions the durable history', 'AGENT_CONTEXT_COMPACTION_MISMATCH', {
        compaction_id: recorded.compaction_id,
      });
    }
    const replacement = {
      source_event_id: recorded.event_id,
      source_ref: `session-event://${recorded.event_id}`,
      sequence: compactedHistory[0].sequence,
      message: recorded.replacement_messages[0],
    };
    const history = [replacement, ...retainedHistory];
    // Same selection and same rejection loop as the original attempt: memory leaves from the end until it fits.
    const { selectedMemory, selectedMedia } = this.#selectOptional(input, inputLimit);
    const retainedMemory = orderedMemory(selectedMemory);
    const omittedMemoryRefs = input.memory
      .filter((entry) => !retainedMemory.some((retained) => retained.source_ref === entry.source_ref))
      .map((entry) => entry.source_ref);
    while (
      retainedMemory.length > 0 &&
      this.#compose(input, history, retainedMemory, selectedMedia).measurement.input_tokens > inputLimit
    ) {
      omittedMemoryRefs.push(retainedMemory.pop().source_ref);
    }
    const composition = this.#compose(input, history, retainedMemory, selectedMedia);
    if (composition.measurement.input_tokens > inputLimit) {
      throw new ContextBudgetError('recorded compaction replacement cannot fit the model input budget');
    }
    return {
      composition,
      omitted_source_refs: [
        ...compactedHistory.map((entry) => entry.source_ref),
        ...omittedMemoryRefs,
        ...input.media.filter((entry) => !selectedMedia.includes(entry)).map((entry) => entry.source_ref),
      ].sort(),
      contextLimit,
      inputLimit,
      reservedOutput,
      compaction: null,
    };
  }

  // Rejects media before any effect: provider capability, counter support, then bytes against digest/size/magic.
  #verifiedMediaTokens(media, providerManifest) {
    const tokens = new Map();
    if (media.length === 0) return tokens;
    if (!providerManifest.capabilities.includes('image_input')) {
      throw new ContextAssemblyError('selected model provider does not declare image_input', 'AGENT_CONTEXT_PROVIDER_LACKS_IMAGE_INPUT', {
        provider_id: providerManifest.provider_id,
      });
    }
    for (const item of media) tokens.set(item.source_ref, deterministicCountMedia(this.#tokenCounter, item));
    if (!this.#mediaStore) {
      throw new ContextMediaError('media requires a context media store', 'AGENT_CONTEXT_MEDIA_STORE_REQUIRED');
    }
    for (const item of media) this.#mediaStore.load(item);
    return tokens;
  }

  assembleAndRecord(inputValue) {
    const input = parseContract(ContextAssemblyInputSchema, inputValue, 'context assembly input');
    const { resolved: authority, v2: declaredV2 } = resolveInputAuthority(input);
    assertMediaWithinLimits(input.media);
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
    const providerEntry = this.#providerSnapshot.resolve(input.session.execution.model_provider_id, input.session.execution.model);
    const providerManifest = parseContract(ModelProviderManifestSchema, providerEntry.manifest, 'registered model provider manifest');
    const mediaTokens = this.#verifiedMediaTokens(input.media, providerManifest);
    const requiredRefs = new Set((input.current_turn.parts ?? []).map((part) => part.source_ref));
    const enrichedInput = {
      ...input,
      history: durableHistory(durableState, input.turn_id),
      authority,
      media_tokens: mediaTokens,
      required_media: input.media.filter((media) => requiredRefs.has(media.source_ref)),
    };
    const recordedCompaction = durableTurn.request ? null : (durableTurn.context_compaction ?? null);
    if (recordedCompaction && input.overflow_policy !== 'compact') {
      throw new ContextAssemblyError(
        'a durable compaction requires the compact overflow policy to resume',
        'AGENT_CONTEXT_COMPACTION_MISMATCH',
        { compaction_id: recordedCompaction.compaction_id },
      );
    }
    const budgeted = this.#budget(enrichedInput, providerManifest, remainingSessionTokens(durableState, input.turn_id), recordedCompaction);
    const useV2 = declaredV2 || input.media.length > 0;
    const request = parseContract(
      budgeted.composition.parts.length > 0 ? ModelRequestV2Schema : ModelRequestSchema,
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
        ...(budgeted.composition.parts.length > 0 ? { parts: budgeted.composition.parts } : {}),
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
        compaction_provider_id: input.overflow_policy === 'compact' ? input.compaction_provider_id : null,
        checkpoint_provider_id: input.overflow_policy === 'compact' ? this.#compactionRuntime.checkpoint_provider_id : null,
        compaction_provider_manifest:
          input.overflow_policy === 'compact' ? this.#compactionRuntime.resolve(input.compaction_provider_id, 'history_summary') : null,
        omitted_source_refs: budgeted.omitted_source_refs,
      },
      'context budget report',
    );
    const compactionEvent = budgeted.compaction
      ? {
          schema_version: CONTRACT_SCHEMA_VERSION,
          event_id: input.compaction_event_id,
          session_id: input.session.session_id,
          sequence: input.expected_version + 1,
          occurred_at: input.occurred_at,
          event_type: 'compaction.completed',
          payload: budgeted.compaction,
        }
      : null;
    const contextEvent = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      event_id: input.event_id,
      session_id: input.session.session_id,
      sequence: input.expected_version + (compactionEvent ? 2 : 1),
      occurred_at: input.occurred_at,
      event_type: 'context.assembled',
      payload: {
        assembly_contract: useV2 ? CONTEXT_ASSEMBLY_CONTRACT_V2 : CONTEXT_ASSEMBLY_CONTRACT,
        turn_id: input.turn_id,
        request,
        source_refs: budgeted.composition.source_refs,
        ...(useV2 ? { sources: budgeted.composition.sources } : {}),
        budget,
      },
    };
    const appendedEvents = compactionEvent ? [compactionEvent, contextEvent] : [contextEvent];
    const appendResult = this.#store.append({
      session_id: input.session.session_id,
      expected_version: input.expected_version,
      events: appendedEvents,
    });
    if (
      !appendResult ||
      appendResult.current_version !== input.expected_version + appendedEvents.length ||
      typeof appendResult.idempotent !== 'boolean' ||
      !Array.isArray(appendResult.events) ||
      appendResult.events.length !== appendedEvents.length ||
      canonicalJson(appendResult.events) !== canonicalJson(appendedEvents)
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
      event: appendResult.events.at(-1),
      compaction_event: compactionEvent ? appendResult.events[0] : null,
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
