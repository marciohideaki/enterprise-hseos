'use strict';

/**
 * Optional axon mirror for activity coordination events (W5-CO2).
 *
 * The core calls `adapter.mirror(event)` synchronously: this adapter schedules
 * the work fire-and-forget, never throws and returns immediately. It mirrors
 * `activity_declared` and `reservation_conflict` as axon handoffs, whether the
 * event arrives bare (`{type}`) or wrapped in an inbox entry (`{event:{type}}`).
 * Axon is never the source of truth: a missing binary or a failed call only
 * produces a warning result.
 */

const MIRRORED = new Set(['activity_declared', 'reservation_conflict']);
const OBJECTIVE_MAX = 8192;
const FIELD_MAX = 256;

function loadDefaults() {
  const { callAxon } = require('../../../mcp-axon-bridge/lib/axon-client');
  const { resolve } = require('../../../mcp-axon-bridge/lib/binary-resolver');
  return { callAxon, resolveBin: resolve };
}

// Control, format and line/paragraph separator characters are replaced; free text from other sessions is capped.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|[\u115F\u3164\u2800]|[\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]/gu;
const clean = (value, max = FIELD_MAX) =>
  String(value ?? '')
    .replaceAll(UNSAFE, ' ')
    .slice(0, max);

function eventType(event) {
  return event?.type || event?.event?.type;
}

function describe(event) {
  const details = { ...event.event, ...event };
  if (eventType(event) === 'reservation_conflict') {
    const text = event.reason
      ? clean(event.reason, 1024)
      : `Reservation conflict on ${clean(details.key) || 'resource'} (source: ${clean(details.source) || 'unknown'}) between sessions ${clean(details.session) || '?'} and ${clean(details.other_session) || '?'}.`;
    return text.slice(0, OBJECTIVE_MAX);
  }
  const paths = (Array.isArray(details.paths) ? details.paths : []).slice(0, 50).map((item) => clean(item));
  const intent = details.intent ? ` Intent: ${clean(details.intent, 1024)}` : '';
  return `Session ${clean(details.session) || '?'} (${clean(details.tool) || 'unknown tool'}) declared work on: ${paths.join(', ') || 'no paths'}.${intent}`.slice(
    0,
    OBJECTIVE_MAX,
  );
}

function createAxonAdapter(options = {}) {
  let cached = null;
  const dependencies = () => {
    cached ||= { ...loadDefaults(), ...options };
    return cached;
  };

  async function onEvent(event) {
    const type = eventType(event);
    if (!MIRRORED.has(type)) return { mirrored: false, reason: 'not-mirrored' };
    try {
      const deps = dependencies();
      const bin = deps.resolveBin();
      if (!bin) return { mirrored: false, reason: 'axon-unavailable' };
      const id = event.id || `${event.session || event.event?.session || ''}-${event.at || event.created_at || ''}`;
      await deps.callAxon(bin, 'handoff_create', {
        target_agent: type === 'reservation_conflict' ? 'coordination-conflict' : 'coordination-peer',
        objective: describe(event),
        idempotency_key: `hseos-activity-${type}-${clean(id)}`.slice(0, 256),
        ...(typeof event.directory === 'string' ? { working_directory: event.directory } : {}),
      });
      return { mirrored: true };
    } catch (error) {
      return { mirrored: false, reason: 'axon-error', warning: `axon mirror failed: ${error.message}` };
    }
  }

  return {
    name: 'axon',
    onEvent,
    /** Synchronous, never throws, returns immediately; the mirroring runs in the background. */
    mirror(event) {
      try {
        onEvent(event).catch(() => {});
      } catch {
        /* best effort */
      }
    },
  };
}

module.exports = { createAxonAdapter, MIRRORED, describe };
