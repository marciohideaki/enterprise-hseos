'use strict';

const { SessionEventSchema, deepFreeze, parseContract } = require('../agent-runtime-contracts');

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

function durableHistory(state, currentTurnId) {
  const history = [];
  for (const turnId of state.turn_order) {
    if (turnId === currentTurnId) break;
    const turn = state.turns[turnId];
    history.push({ message: turn.input, source_ref: `session-event://${turn.input_event_id}` });
    const terminalIndex = turn.model_events.findIndex((item) => item.event_type === 'completed');
    const content = turn.model_events
      .slice(0, terminalIndex < 0 ? 0 : terminalIndex)
      .filter((item) => item.event_type === 'content.delta')
      .map((item) => item.payload.text)
      .join('');
    if (terminalIndex >= 0 && content.length > 0) {
      history.push({
        message: { role: 'assistant', content },
        source_ref: `session-event://${turn.model_event_ids[terminalIndex]}`,
      });
    }
  }
  return history;
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
    terminal_event: null,
  };

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
        const selectedHistory = visibleHistory.length === 0 ? [] : durable.slice(-visibleHistory.length);
        if (
          visibleHistory.length > durable.length ||
          canonicalJson(visibleHistory) !== canonicalJson(selectedHistory.map((item) => item.message)) ||
          selectedHistory.some((item) => !event.payload.source_refs.includes(item.source_ref))
        ) {
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
      case 'model.streamed': {
        const turn = requireTurn(state, event.payload.turn_id, event);
        if (!turn.request) {
          throw new SessionReplayError('model stream cannot precede context assembly', 'AGENT_SESSION_REQUEST_NOT_ASSEMBLED');
        }
        if (event.payload.event.request_id !== turn.request.request_id || event.payload.provider_id !== turn.request.provider_id) {
          throw new SessionReplayError(
            'model stream identity does not match the assembled request',
            'AGENT_SESSION_MODEL_IDENTITY_MISMATCH',
          );
        }
        const expectedModelSequence = turn.model_events.length;
        if (event.payload.event.sequence !== expectedModelSequence) {
          throw new SessionReplayError('model stream sequence contains a gap or duplicate', 'AGENT_SESSION_MODEL_SEQUENCE_INVALID', {
            expected_sequence: expectedModelSequence,
            actual_sequence: event.payload.event.sequence,
          });
        }
        if (turn.model_events.some((item) => ['completed', 'failed'].includes(item.event_type))) {
          throw new SessionReplayError('model stream continues after a terminal provider event', 'AGENT_SESSION_MODEL_ALREADY_TERMINAL');
        }
        turn.model_events.push(event.payload.event);
        turn.model_event_ids.push(event.event_id);
        turn.model_event_sequences.push(event.sequence);
        break;
      }
      case 'tool.operation_linked':
        requireTurn(state, event.payload.turn_id, event);
        if (state.operation_ids.includes(event.payload.operation_id)) {
          throw new SessionReplayError('governed operation is already linked', 'AGENT_SESSION_DUPLICATE_OPERATION');
        }
        state.operation_ids.push(event.payload.operation_id);
        break;
      case 'compaction.completed':
        state.compactions.push({ ...event.payload, event_id: event.event_id });
        break;
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
      case 'session.cancelled':
      case 'session.failed':
        state.status = event.event_type.slice('session.'.length);
        state.terminal_event = event;
        break;
      case 'session.completed':
        if (
          Object.values(state.turns).some(
            (turn) => turn.model_events.length > 0 && !turn.model_events.some((item) => ['completed', 'failed'].includes(item.event_type)),
          )
        ) {
          throw new SessionReplayError('session cannot complete while a model stream is incomplete', 'AGENT_SESSION_MODEL_INCOMPLETE');
        }
        state.status = 'completed';
        state.terminal_event = event;
        break;
      default:
        break;
    }
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
    request = turn.request;
    const terminalModelEvent = turn.model_events.find((event) => ['completed', 'failed'].includes(event.event_type));
    nextAction = terminalModelEvent ? 'resume_after_model' : 'restart_model_request';
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
  buildRecoveryPlan,
  canonicalJson,
  reconstructModelRequest,
  replaySessionEvents,
};
