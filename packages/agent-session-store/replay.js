'use strict';

const { createHash } = require('node:crypto');

const {
  MAX_MODEL_EVENTS_PER_STEP,
  MAX_MODEL_STREAM_BYTES_PER_STEP,
  MODEL_TERMINAL_RESERVE_BYTES,
  SessionEventSchema,
  deepFreeze,
  parseContract,
} = require('../agent-runtime-contracts');

class SessionReplayError extends Error {
  constructor(message, code = 'AGENT_SESSION_REPLAY_INVALID', details = {}) {
    super(message);
    this.name = 'SessionReplayError';
    this.code = code;
    this.details = details;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function compactionStats(messages) {
  const bytes = Buffer.byteLength(canonicalJson(messages), 'utf8');
  return { message_count: messages.length, bytes, tokens: bytes };
}

function requireTurn(state, turnId, event) {
  const turn = state.turns[turnId];
  if (!turn) {
    throw new SessionReplayError(`${event.event_type} references an unknown turn`, 'AGENT_SESSION_TURN_NOT_STARTED', {
      event_id: event.event_id,
      turn_id: turnId,
    });
  }
  return turn;
}

function assembledToolCalls(modelEvents) {
  const calls = new Map();
  for (const event of modelEvents) {
    if (event.event_type !== 'tool_call.delta') continue;
    let call = calls.get(event.payload.tool_call_id);
    if (!call) {
      call = { tool_call_id: event.payload.tool_call_id, name: null, arguments_json: '' };
      calls.set(event.payload.tool_call_id, call);
    }
    if (event.payload.name !== null) {
      if (call.name !== null && call.name !== event.payload.name) {
        throw new SessionReplayError('tool call name changed across deltas', 'AGENT_SESSION_TOOL_CALL_INVALID');
      }
      call.name = event.payload.name;
    }
    call.arguments_json += event.payload.arguments_delta;
  }
  return [...calls.values()].map((call) => {
    let input;
    try {
      input = JSON.parse(call.arguments_json);
    } catch {
      throw new SessionReplayError('tool call arguments are not complete JSON', 'AGENT_SESSION_TOOL_CALL_INVALID', {
        tool_call_id: call.tool_call_id,
      });
    }
    if (!call.name || !input || typeof input !== 'object' || Array.isArray(input)) {
      throw new SessionReplayError('tool call requires a name and JSON object input', 'AGENT_SESSION_TOOL_CALL_INVALID', {
        tool_call_id: call.tool_call_id,
      });
    }
    return { tool_call_id: call.tool_call_id, name: call.name, input };
  });
}

function toolOutcomeMessage(execution) {
  const outcome = execution.outcome;
  return {
    role: 'tool',
    name: execution.name,
    tool_call_id: execution.tool_call_id,
    content: canonicalJson({
      status: outcome.status,
      result: outcome.result,
      error: outcome.error,
      evidence_refs: outcome.evidence_refs,
      warnings: outcome.warnings,
    }),
  };
}

function durableHistory(state, currentTurnId) {
  const history = [];
  for (const turnId of state.turn_order) {
    if (turnId === currentTurnId) break;
    const turn = state.turns[turnId];
    history.push({
      source_event_id: turn.input_event_id,
      source_ref: `session-event://${turn.input_event_id}`,
      sequence: turn.input_event_sequence,
      message: turn.input,
    });
    const terminalIndex = turn.model_events.findIndex((item) => item.event_type === 'completed');
    const content = turn.model_events
      .slice(0, terminalIndex < 0 ? 0 : terminalIndex)
      .filter((item) => item.event_type === 'content.delta')
      .map((item) => item.payload.text)
      .join('');
    if (terminalIndex >= 0 && content.length > 0) {
      history.push({
        source_event_id: turn.model_event_ids[terminalIndex],
        message: { role: 'assistant', content },
        source_ref: `session-event://${turn.model_event_ids[terminalIndex]}`,
        sequence: turn.model_event_sequences[terminalIndex],
      });
    }
  }
  return history;
}

function assertStartedWorkSettled(state) {
  const incompleteModel = Object.values(state.turns).some((turn) =>
    turn.model_steps.some((step) => !step.model_events.some((event) => ['completed', 'failed'].includes(event.event_type))) ||
    (turn.model_steps.length === 0 &&
      turn.model_events.length > 0 &&
      !turn.model_events.some((event) => ['completed', 'failed'].includes(event.event_type))),
  );
  const incompleteTool = Object.values(state.tool_invocations).some((execution) => !execution.outcome);
  if (incompleteModel || incompleteTool) {
    throw new SessionReplayError('session terminal event precedes settlement of started work', 'AGENT_SESSION_WORK_INCOMPLETE');
  }
}

function replaySessionEvents(inputEvents) {
  if (!Array.isArray(inputEvents)) throw new SessionReplayError('events must be an array');
  const events = inputEvents.map((event) => parseContract(SessionEventSchema, event, 'session event'));
  const state = {
    session_id: null,
    spec: null,
    status: 'empty',
    current_sequence: 0,
    parent: null,
    turns: {},
    turn_order: [],
    operation_ids: [],
    children: [],
    compactions: [],
    workflow_checkpoints: [],
    cancellation_request: null,
    tool_invocations: {},
    terminal_event: null,
  };
  const seenEventIds = new Set();

  for (const event of events) {
    const expectedSequence = state.current_sequence + 1;
    if (event.sequence !== expectedSequence) {
      throw new SessionReplayError('session stream contains a sequence gap or duplicate', 'AGENT_SESSION_SEQUENCE_INVALID', {
        event_id: event.event_id,
        expected_sequence: expectedSequence,
        actual_sequence: event.sequence,
      });
    }
    if (state.session_id !== null && event.session_id !== state.session_id) {
      throw new SessionReplayError('session stream contains a foreign session identifier', 'AGENT_SESSION_IDENTITY_MISMATCH');
    }
    if (state.terminal_event) {
      throw new SessionReplayError('session stream continues after its terminal outcome', 'AGENT_SESSION_ALREADY_TERMINAL', {
        terminal_event_id: state.terminal_event.event_id,
        rejected_event_id: event.event_id,
      });
    }
    if (event.sequence === 1 && event.event_type !== 'session.created') {
      throw new SessionReplayError('the first session event must be session.created', 'AGENT_SESSION_CREATION_REQUIRED');
    }
    if (event.sequence > 1 && event.event_type === 'session.created') {
      throw new SessionReplayError('session.created may occur only once', 'AGENT_SESSION_DUPLICATE_CREATION');
    }

    state.session_id = event.session_id;
    state.current_sequence = event.sequence;
    switch (event.event_type) {
      case 'session.created':
        state.spec = event.payload.spec;
        state.status = 'active';
        break;
      case 'session.forked':
        if (event.sequence !== 2 || state.parent) {
          throw new SessionReplayError(
            'session fork lineage must be recorded exactly once after creation',
            'AGENT_SESSION_FORK_SEQUENCE_INVALID',
          );
        }
        if (state.spec.parent_session_id !== event.payload.parent_session_id) {
          throw new SessionReplayError('fork parent does not match the child session spec', 'AGENT_SESSION_FORK_PARENT_MISMATCH');
        }
        state.parent = { ...event.payload };
        break;
      case 'session.resumed':
        if (event.payload.from_sequence !== event.sequence - 1) {
          throw new SessionReplayError(
            'resume source must be the immediately preceding durable sequence',
            'AGENT_SESSION_RESUME_SEQUENCE_INVALID',
          );
        }
        break;
      case 'turn.started': {
        const turnId = event.payload.turn_id;
        if (state.turns[turnId]) {
          throw new SessionReplayError('turn identifier is already present', 'AGENT_SESSION_DUPLICATE_TURN', { turn_id: turnId });
        }
        state.turns[turnId] = {
          turn_id: turnId,
          input: event.payload.input,
          input_event_id: event.event_id,
          request: null,
          budget: null,
          model_events: [],
          model_event_ids: [],
          model_event_sequences: [],
          model_steps: [],
          model_steps_by_id: {},
          tool_executions: {},
          context_compaction: null,
          tool_compactions: [],
          input_event_sequence: event.sequence,
        };
        state.turn_order.push(turnId);
        break;
      }
      case 'context.assembled': {
        const turn = requireTurn(state, event.payload.turn_id, event);
        if (turn.request) {
          throw new SessionReplayError('a turn may have only one assembled request', 'AGENT_SESSION_DUPLICATE_REQUEST');
        }
        if (state.spec.execution.mode !== 'kernel') {
          throw new SessionReplayError('delegated sessions cannot contain kernel model requests', 'AGENT_SESSION_EXECUTION_MODE_MISMATCH');
        }
        if (
          event.payload.request.provider_id !== state.spec.execution.model_provider_id ||
          event.payload.request.model !== state.spec.execution.model
        ) {
          throw new SessionReplayError(
            'assembled request provider or model differs from the durable session',
            'AGENT_SESSION_PROVIDER_MISMATCH',
          );
        }
        if (canonicalJson(event.payload.request.messages.at(-1)) !== canonicalJson(turn.input)) {
          throw new SessionReplayError(
            'assembled request does not end with the durable turn input',
            'AGENT_SESSION_TURN_INPUT_MISMATCH',
          );
        }
        if (!event.payload.source_refs.includes(`session-event://${turn.input_event_id}`)) {
          throw new SessionReplayError(
            'assembled request does not reference the durable turn event',
            'AGENT_SESSION_SOURCE_MISMATCH',
          );
        }
        const durable = durableHistory(state, event.payload.turn_id);
        const visibleHistory = event.payload.request.messages
          .slice(1, -1)
          .filter((message) => message.role !== 'system');
        const compaction = turn.context_compaction;
        if (event.payload.budget.overflow_policy === 'compact') {
          if (
            compaction &&
            (event.payload.budget.compaction_provider_id !== compaction.provider_id ||
              event.payload.budget.checkpoint_provider_id !== compaction.checkpoint_provider_id ||
              canonicalJson(event.payload.budget.compaction_provider_manifest) !== canonicalJson(compaction.provider_manifest))
          ) {
            throw new SessionReplayError('context compaction provenance differs from selected budget providers', 'AGENT_SESSION_COMPACTION_PROVENANCE_INVALID');
          }
        }
        const selectedHistory = visibleHistory.length === 0 ? [] : durable.slice(-visibleHistory.length);
        const expectedCompactedHistory = compaction
          ? [
              compaction.replacement_messages[0],
              ...durable
                .filter((item) => compaction.retained_source_event_ids.includes(item.source_event_id))
                .map((item) => item.message),
            ]
          : null;
        const ordinaryInvalid =
          visibleHistory.length > durable.length ||
          canonicalJson(visibleHistory) !== canonicalJson(selectedHistory.map((item) => item.message)) ||
          selectedHistory.some((item) => !event.payload.source_refs.includes(item.source_ref));
        const compactedInvalid =
          !compaction ||
          canonicalJson(visibleHistory) !== canonicalJson(expectedCompactedHistory) ||
          !event.payload.source_refs.includes(`session-event://${compaction.event_id}`) ||
          durable
            .filter((item) => compaction.retained_source_event_ids.includes(item.source_event_id))
            .some((item) => !event.payload.source_refs.includes(item.source_ref)) ||
          durable
            .filter((item) => compaction.source_event_ids.includes(item.source_event_id))
            .some((item) => event.payload.source_refs.includes(item.source_ref));
        if (compaction ? compactedInvalid : ordinaryInvalid) {
          throw new SessionReplayError(
            'model-visible history is not a durable contiguous suffix',
            'AGENT_SESSION_HISTORY_MISMATCH',
          );
        }
        turn.request = event.payload.request;
        turn.source_refs = event.payload.source_refs;
        turn.budget = event.payload.budget;
        turn.request_event_id = event.event_id;
        break;
      }
      case 'model.request.started': {
        const turn = requireTurn(state, event.payload.turn_id, event);
        if (!turn.request) {
          throw new SessionReplayError('model work cannot start before context assembly', 'AGENT_SESSION_REQUEST_NOT_ASSEMBLED');
        }
        if (turn.model_steps_by_id[event.payload.step_id]) {
          throw new SessionReplayError('model step identifier is already present', 'AGENT_SESSION_DUPLICATE_MODEL_STEP');
        }
        if (turn.model_steps.some((step) => step.request.request_id === event.payload.request.request_id)) {
          throw new SessionReplayError('model request identifier is already present', 'AGENT_SESSION_DUPLICATE_MODEL_REQUEST');
        }
        if (
          event.payload.request.provider_id !== state.spec.execution.model_provider_id ||
          event.payload.request.model !== state.spec.execution.model
        ) {
          throw new SessionReplayError('model step provider differs from the durable session', 'AGENT_SESSION_PROVIDER_MISMATCH');
        }
        if (event.payload.source_event_ids.some((eventId) => !seenEventIds.has(eventId))) {
          throw new SessionReplayError('model step references a missing or future source event', 'AGENT_SESSION_SOURCE_MISMATCH');
        }
        const previous = turn.model_steps.at(-1);
        if (!previous) {
          if (
            canonicalJson(event.payload.request) !== canonicalJson(turn.request) ||
            canonicalJson(event.payload.source_event_ids) !== canonicalJson([turn.request_event_id])
          ) {
            throw new SessionReplayError('initial model step must use the assembled request', 'AGENT_SESSION_REQUEST_MISMATCH');
          }
        } else {
          const terminal = previous.model_events.at(-1);
          if (terminal?.event_type !== 'completed' || terminal.payload.finish_reason !== 'tool_calls') {
            throw new SessionReplayError('a continuation requires a completed tool-call step', 'AGENT_SESSION_MODEL_STEP_ORDER_INVALID');
          }
          const prefix = event.payload.request.messages.slice(0, previous.request.messages.length);
          if (
            canonicalJson(prefix) !== canonicalJson(previous.request.messages) ||
            event.payload.request.messages.length <= previous.request.messages.length ||
            !event.payload.source_event_ids.includes(previous.terminal_event_id)
          ) {
            throw new SessionReplayError('continuation request does not preserve its durable predecessor', 'AGENT_SESSION_REQUEST_MISMATCH');
          }
          const calls = assembledToolCalls(previous.model_events);
          const executions = calls.map((call) => turn.tool_executions[call.tool_call_id]);
          const toolCompaction = turn.tool_compactions.find(
            (compaction) =>
              canonicalJson(compaction.source_event_ids) ===
              canonicalJson(executions.map((execution) => execution?.completed_event_id)),
          );
          if (
            executions.some((execution) => !execution?.outcome) ||
            (!toolCompaction && executions.some((execution) => !event.payload.source_event_ids.includes(execution.completed_event_id))) ||
            (toolCompaction && !event.payload.source_event_ids.includes(toolCompaction.event_id))
          ) {
            throw new SessionReplayError('model continuation precedes durable tool outcomes', 'AGENT_SESSION_TOOL_INCOMPLETE');
          }
          const content = previous.model_events
            .filter((modelEvent) => modelEvent.event_type === 'content.delta')
            .map((modelEvent) => modelEvent.payload.text)
            .join('');
          const expectedMessages = [
            ...previous.request.messages,
            { role: 'assistant', content, tool_calls: calls },
            ...(toolCompaction ? toolCompaction.replacement_messages : executions.map(toolOutcomeMessage)),
          ];
          const expectedSources = [
            previous.terminal_event_id,
            ...(toolCompaction ? [toolCompaction.event_id] : executions.map((execution) => execution.completed_event_id)),
          ];
          const stableRequest = { ...event.payload.request, request_id: previous.request.request_id, messages: previous.request.messages };
          if (
            canonicalJson(event.payload.request.messages) !== canonicalJson(expectedMessages) ||
            canonicalJson(event.payload.source_event_ids) !== canonicalJson(expectedSources) ||
            canonicalJson(stableRequest) !== canonicalJson(previous.request)
          ) {
            throw new SessionReplayError('continuation request differs from durable model and tool facts', 'AGENT_SESSION_REQUEST_MISMATCH');
          }
        }
        const step = {
          step_id: event.payload.step_id,
          request: event.payload.request,
          request_event_id: event.event_id,
          source_event_ids: event.payload.source_event_ids,
          model_events: [],
          model_event_ids: [],
          model_stream_bytes: 2,
          terminal_event_id: null,
        };
        turn.model_steps.push(step);
        turn.model_steps_by_id[step.step_id] = step;
        break;
      }
      case 'model.streamed': {
        const turn = requireTurn(state, event.payload.turn_id, event);
        if (!turn.request) {
          throw new SessionReplayError('model stream cannot precede context assembly', 'AGENT_SESSION_REQUEST_NOT_ASSEMBLED');
        }
        const step = event.payload.step_id ? turn.model_steps_by_id[event.payload.step_id] : null;
        if (event.payload.step_id && !step) {
          throw new SessionReplayError('model stream references an unknown step', 'AGENT_SESSION_MODEL_STEP_NOT_STARTED');
        }
        const request = step?.request || turn.request;
        if (event.payload.event.request_id !== request.request_id || event.payload.provider_id !== request.provider_id) {
          throw new SessionReplayError(
            'model stream identity does not match the assembled request',
            'AGENT_SESSION_MODEL_IDENTITY_MISMATCH',
          );
        }
        const targetEvents = step?.model_events || turn.model_events;
        const expectedModelSequence = targetEvents.length;
        if (event.payload.event.sequence !== expectedModelSequence) {
          throw new SessionReplayError('model stream sequence contains a gap or duplicate', 'AGENT_SESSION_MODEL_SEQUENCE_INVALID', {
            expected_sequence: expectedModelSequence,
            actual_sequence: event.payload.event.sequence,
          });
        }
        if (targetEvents.some((item) => ['completed', 'failed'].includes(item.event_type))) {
          throw new SessionReplayError('model stream continues after a terminal provider event', 'AGENT_SESSION_MODEL_ALREADY_TERMINAL');
        }
        if (step) {
          const terminal = ['completed', 'failed'].includes(event.payload.event.event_type);
          const nextBytes =
            step.model_stream_bytes +
            (targetEvents.length === 0 ? 0 : 1) +
            Buffer.byteLength(canonicalJson(event.payload.event), 'utf8');
          if (
            targetEvents.length >= MAX_MODEL_EVENTS_PER_STEP ||
            (!terminal && targetEvents.length >= MAX_MODEL_EVENTS_PER_STEP - 1) ||
            nextBytes > MAX_MODEL_STREAM_BYTES_PER_STEP ||
            (!terminal && nextBytes > MAX_MODEL_STREAM_BYTES_PER_STEP - MODEL_TERMINAL_RESERVE_BYTES)
          ) {
            throw new SessionReplayError('model step exceeds its cumulative stream bound', 'AGENT_SESSION_MODEL_STREAM_LIMIT');
          }
          step.model_stream_bytes = nextBytes;
        }
        turn.model_events.push(event.payload.event);
        turn.model_event_ids.push(event.event_id);
        turn.model_event_sequences.push(event.sequence);
        if (step) {
          step.model_events.push(event.payload.event);
          step.model_event_ids.push(event.event_id);
          if (['completed', 'failed'].includes(event.payload.event.event_type)) step.terminal_event_id = event.event_id;
        }
        break;
      }
      case 'tool.execution.started': {
        const turn = requireTurn(state, event.payload.turn_id, event);
        const step = turn.model_steps_by_id[event.payload.step_id];
        const terminal = step?.model_events.at(-1);
        if (!step || terminal?.event_type !== 'completed' || terminal.payload.finish_reason !== 'tool_calls') {
          throw new SessionReplayError('tool execution requires a durable completed tool-call step', 'AGENT_SESSION_TOOL_STEP_INVALID');
        }
        if (state.tool_invocations[event.payload.invocation_id] || turn.tool_executions[event.payload.tool_call_id]) {
          throw new SessionReplayError('tool execution identity is already present', 'AGENT_SESSION_DUPLICATE_TOOL_EXECUTION');
        }
        const call = assembledToolCalls(step.model_events).find((candidate) => candidate.tool_call_id === event.payload.tool_call_id);
        if (!call || call.name !== event.payload.name || canonicalJson(call.input) !== canonicalJson(event.payload.input)) {
          throw new SessionReplayError('tool execution differs from the durable model call', 'AGENT_SESSION_TOOL_CALL_MISMATCH');
        }
        if (Object.keys(state.tool_invocations).length >= state.spec.limits.max_tool_calls) {
          throw new SessionReplayError('session tool-call limit is exhausted', 'AGENT_SESSION_TOOL_LIMIT_EXCEEDED');
        }
        const execution = { ...event.payload, started_event_id: event.event_id, outcome: null, completed_event_id: null };
        turn.tool_executions[event.payload.tool_call_id] = execution;
        state.tool_invocations[event.payload.invocation_id] = execution;
        break;
      }
      case 'tool.execution.completed': {
        const turn = requireTurn(state, event.payload.turn_id, event);
        const execution = state.tool_invocations[event.payload.outcome.invocation_id];
        if (
          !execution ||
          execution.outcome ||
          execution.step_id !== event.payload.step_id ||
          execution.tool_call_id !== event.payload.outcome.tool_call_id ||
          execution.name !== event.payload.outcome.name
        ) {
          throw new SessionReplayError('tool outcome does not match one pending durable execution', 'AGENT_SESSION_TOOL_OUTCOME_MISMATCH');
        }
        execution.outcome = event.payload.outcome;
        execution.completed_event_id = event.event_id;
        execution.completed_event_sequence = event.sequence;
        turn.tool_executions[execution.tool_call_id] = execution;
        break;
      }
      case 'tool.operation_linked':
        {
          const turn = requireTurn(state, event.payload.turn_id, event);
          const execution = turn.tool_executions[event.payload.tool_call_id];
          if (execution && execution.outcome?.operation_id !== event.payload.operation_id) {
            throw new SessionReplayError('operation link differs from the durable tool outcome', 'AGENT_SESSION_OPERATION_MISMATCH');
          }
        }
        if (state.operation_ids.includes(event.payload.operation_id)) {
          throw new SessionReplayError('governed operation is already linked', 'AGENT_SESSION_DUPLICATE_OPERATION');
        }
        state.operation_ids.push(event.payload.operation_id);
        break;
      case 'compaction.completed': {
        const turn = requireTurn(state, event.payload.turn_id, event);
        if (
          state.compactions.some(
            (compaction) =>
              compaction.compaction_id === event.payload.compaction_id ||
              compaction.checkpoint_ref === event.payload.checkpoint_ref ||
              (compaction.turn_id === event.payload.turn_id &&
                compaction.trigger === event.payload.trigger &&
                canonicalJson(compaction.source_event_ids) === canonicalJson(event.payload.source_event_ids)),
          )
        ) {
          throw new SessionReplayError('compaction identity or source set is already recorded', 'AGENT_SESSION_DUPLICATE_COMPACTION');
        }
        let sources;
        if (event.payload.trigger === 'context_pressure') {
          if (turn.request || turn.context_compaction) {
            throw new SessionReplayError(
              'turn context compaction must occur exactly once before context assembly',
              'AGENT_SESSION_COMPACTION_ORDER_INVALID',
            );
          }
          const durable = durableHistory(state, event.payload.turn_id);
          const durableIds = durable.map((item) => item.source_event_id);
          const recordedIds = [...event.payload.source_event_ids, ...event.payload.retained_source_event_ids];
          if (canonicalJson(recordedIds) !== canonicalJson(durableIds)) {
            throw new SessionReplayError(
              'compaction lineage must partition the exact durable history into prefix and suffix',
              'AGENT_SESSION_COMPACTION_LINEAGE_INVALID',
            );
          }
          sources = durable.slice(0, event.payload.source_event_ids.length);
        } else {
          const step = turn.model_steps.at(-1);
          const terminal = step?.model_events.at(-1);
          if (!step || terminal?.event_type !== 'completed' || terminal.payload.finish_reason !== 'tool_calls') {
            throw new SessionReplayError('tool compaction requires a completed tool-call step', 'AGENT_SESSION_COMPACTION_ORDER_INVALID');
          }
          const calls = assembledToolCalls(step.model_events);
          const executions = calls.map((call) => turn.tool_executions[call.tool_call_id]);
          if (
            executions.some((execution) => !execution?.outcome) ||
            event.payload.retained_source_event_ids.length !== 0 ||
            canonicalJson(event.payload.source_event_ids) !==
              canonicalJson(executions.map((execution) => execution.completed_event_id))
          ) {
            throw new SessionReplayError('tool compaction lineage differs from exact durable outcomes', 'AGENT_SESSION_COMPACTION_LINEAGE_INVALID');
          }
          if (
            canonicalJson(event.payload.replacement_messages.map((message) => message.tool_call_id)) !==
            canonicalJson(calls.map((call) => call.tool_call_id))
          ) {
            throw new SessionReplayError('tool compaction changed call identity or ordering', 'AGENT_SESSION_COMPACTION_TOOL_IDENTITY_INVALID');
          }
          sources = executions.map((execution) => ({
            source_event_id: execution.completed_event_id,
            source_ref: `session-event://${execution.completed_event_id}`,
            sequence: execution.completed_event_sequence,
            message: toolOutcomeMessage(execution),
          }));
        }
        if (event.payload.source_digest !== digest(sources)) {
          throw new SessionReplayError('compaction source digest differs from durable history', 'AGENT_SESSION_COMPACTION_DIGEST_INVALID');
        }
        const sourceMessages = sources.map((source) => source.message);
        if (
          canonicalJson(event.payload.before) !== canonicalJson(compactionStats(sourceMessages)) ||
          canonicalJson(event.payload.after) !== canonicalJson(compactionStats(event.payload.replacement_messages))
        ) {
          throw new SessionReplayError('compaction accounting differs from durable messages', 'AGENT_SESSION_COMPACTION_ACCOUNTING_INVALID');
        }
        if (
          event.payload.before.bytes > event.payload.provider_manifest.max_input_bytes ||
          event.payload.after.bytes > event.payload.provider_manifest.max_output_bytes
        ) {
          throw new SessionReplayError('compaction exceeds its durable provider manifest', 'AGENT_SESSION_COMPACTION_CAP_INVALID');
        }
        if (
          turn.budget &&
          (turn.budget.compaction_provider_id !== event.payload.provider_id ||
            turn.budget.checkpoint_provider_id !== event.payload.checkpoint_provider_id ||
            canonicalJson(turn.budget.compaction_provider_manifest) !== canonicalJson(event.payload.provider_manifest))
        ) {
          throw new SessionReplayError('tool compaction provenance differs from selected budget providers', 'AGENT_SESSION_COMPACTION_PROVENANCE_INVALID');
        }
        const compaction = { ...event.payload, event_id: event.event_id };
        if (event.payload.trigger === 'context_pressure') turn.context_compaction = compaction;
        else turn.tool_compactions.push(compaction);
        state.compactions.push(compaction);
        break;
      }
      case 'child.attached':
        if (event.payload.child_session_id === state.session_id) {
          throw new SessionReplayError('session cannot attach itself as a child', 'AGENT_SESSION_SELF_CHILD');
        }
        if (state.children.includes(event.payload.child_session_id)) {
          throw new SessionReplayError('child session is already attached', 'AGENT_SESSION_DUPLICATE_CHILD');
        }
        if (state.children.length >= state.spec.limits.max_children) {
          throw new SessionReplayError('session child limit is exhausted', 'AGENT_SESSION_CHILD_LIMIT_EXCEEDED');
        }
        state.children.push(event.payload.child_session_id);
        break;
      case 'workflow.checkpointed':
        state.workflow_checkpoints.push({ ...event.payload, event_id: event.event_id });
        break;
      case 'session.cancellation.requested':
        if (state.cancellation_request) {
          throw new SessionReplayError('session cancellation was already requested', 'AGENT_SESSION_DUPLICATE_CANCELLATION');
        }
        state.cancellation_request = { ...event.payload, event_id: event.event_id };
        break;
      case 'session.cancelled':
        if (!state.cancellation_request) {
          throw new SessionReplayError(
            'session cancellation requires a preceding durable request',
            'AGENT_SESSION_CANCELLATION_REQUIRED',
          );
        }
        if (state.cancellation_request.source === 'deadline') {
          throw new SessionReplayError(
            'deadline cancellation must terminate as a timeout failure',
            'AGENT_SESSION_CANCELLATION_TERMINAL_INVALID',
          );
        }
        if (
          event.payload.reason !== state.cancellation_request.reason ||
          event.payload.cascade !== state.cancellation_request.cascade
        ) {
          throw new SessionReplayError(
            'session cancellation terminal differs from the durable request',
            'AGENT_SESSION_CANCELLATION_MISMATCH',
          );
        }
        assertStartedWorkSettled(state);
        state.status = 'cancelled';
        state.terminal_event = event;
        break;
      case 'session.failed':
        assertStartedWorkSettled(state);
        state.status = 'failed';
        state.terminal_event = event;
        break;
      case 'session.completed':
        if (
          Object.values(state.turns).some(
            (turn) =>
              turn.model_steps.length === 0 &&
              turn.model_events.length > 0 &&
              !turn.model_events.some((item) => ['completed', 'failed'].includes(item.event_type)),
          )
        ) {
          throw new SessionReplayError('session cannot complete while a model stream is incomplete', 'AGENT_SESSION_MODEL_INCOMPLETE');
        }
        assertStartedWorkSettled(state);
        {
          const latestTurn = state.turns[state.turn_order.at(-1)];
          const latestStep = latestTurn?.model_steps.at(-1);
          const modelTerminal = (latestStep?.model_events || latestTurn?.model_events || []).find((item) =>
            ['completed', 'failed'].includes(item.event_type),
          );
          if (modelTerminal?.event_type !== 'completed' || modelTerminal.payload.finish_reason !== 'stop') {
            throw new SessionReplayError(
              'session success requires the latest model step to complete with stop',
              'AGENT_SESSION_SUCCESS_PRECONDITION_INVALID',
            );
          }
        }
        state.status = 'completed';
        state.terminal_event = event;
        break;
      default:
        break;
    }
    seenEventIds.add(event.event_id);
  }

  return deepFreeze(state);
}

function reconstructModelRequest(events, { turn_id } = {}) {
  const state = replaySessionEvents(events);
  const selectedTurnId = turn_id || state.turn_order.at(-1);
  const turn = selectedTurnId && state.turns[selectedTurnId];
  if (!turn || !turn.request) {
    throw new SessionReplayError('no assembled model request exists for the selected turn', 'AGENT_SESSION_REQUEST_NOT_FOUND', {
      turn_id: selectedTurnId || null,
    });
  }
  const canonicalRequestJson = canonicalJson(turn.request);
  return deepFreeze({
    request: turn.request,
    canonical_json: canonicalRequestJson,
    byte_length: Buffer.byteLength(canonicalRequestJson, 'utf8'),
    source_refs: turn.source_refs,
    budget: turn.budget,
    source_event_id: turn.request_event_id,
  });
}

function buildRecoveryPlan(events) {
  const state = replaySessionEvents(events);
  if (state.status === 'empty') {
    throw new SessionReplayError('cannot recover an empty session', 'AGENT_SESSION_NOT_FOUND');
  }
  if (state.terminal_event) {
    return deepFreeze({
      session_id: state.session_id,
      current_sequence: state.current_sequence,
      terminal: true,
      next_action: 'none',
      turn_id: null,
      request: null,
    });
  }

  const turnId = state.turn_order.at(-1) || null;
  const turn = turnId && state.turns[turnId];
  let nextAction = 'await_input';
  let request = null;
  if (turn && !turn.request) nextAction = 'assemble_context';
  if (turn && turn.request) {
    const step = turn.model_steps.at(-1);
    request = step?.request || turn.request;
    if (state.cancellation_request) nextAction = 'settle_cancellation';
    else if (!step) nextAction = 'restart_model_request';
    else {
      const terminalModelEvent = step.model_events.find((event) => ['completed', 'failed'].includes(event.event_type));
      if (!terminalModelEvent) nextAction = step.model_events.length === 0 ? 'restart_model_request' : 'fail_interrupted_model';
      else if (terminalModelEvent.event_type === 'failed') nextAction = 'fail_after_model';
      else if (terminalModelEvent.payload.finish_reason === 'tool_calls') {
        const calls = assembledToolCalls(step.model_events);
        const executions = calls.map((call) => turn.tool_executions[call.tool_call_id]).filter(Boolean);
        if (executions.length < calls.length) nextAction = 'execute_tools';
        else if (executions.some((execution) => !execution.outcome)) nextAction = 'resume_tools';
        else nextAction = 'continue_after_tools';
      } else nextAction = 'settle_after_model';
    }
  }
  return deepFreeze({
    session_id: state.session_id,
    current_sequence: state.current_sequence,
    terminal: false,
    next_action: nextAction,
    turn_id: turnId,
    request,
  });
}

module.exports = {
  SessionReplayError,
  assembledToolCalls,
  buildRecoveryPlan,
  canonicalJson,
  reconstructModelRequest,
  replaySessionEvents,
};
