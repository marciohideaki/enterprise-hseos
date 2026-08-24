'use strict';

const { createHash } = require('node:crypto');

const TRACE_ID = /^[0-9a-f]{32}$/u;
const SPAN_ID = /^[0-9a-f]{16}$/u;

class AgentTraceLineageError extends Error {
  constructor(message, code = 'AGENT_TRACE_LINEAGE_INVALID') {
    super(message);
    this.name = 'AgentTraceLineageError';
    this.code = code;
  }
}

function boundedIdentity(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 1024 ||
    [...value].some((character) => character.codePointAt(0) <= 32 || character.codePointAt(0) === 127)
  ) {
    throw new AgentTraceLineageError(`${label} is invalid`);
  }
  return value;
}

function digest(kind, value, length) {
  return createHash('sha256')
    .update(`hseos-${kind}\0${boundedIdentity(value, kind)}`)
    .digest('hex')
    .slice(0, length);
}

function canonicalTraceId(seed) {
  const value = boundedIdentity(seed, 'trace seed');
  if (TRACE_ID.test(value) && value !== '00000000000000000000000000000000') return value;
  return digest('trace', value, 32);
}

function canonicalSpanId(identity) {
  const value = boundedIdentity(identity, 'span identity');
  if (SPAN_ID.test(value) && value !== '0000000000000000') return value;
  return digest('span', value, 16);
}

function createTraceContext(traceSeed, spanIdentity) {
  const traceId = canonicalTraceId(traceSeed);
  const spanId = canonicalSpanId(spanIdentity);
  return Object.freeze({
    schema_version: 1,
    trace_id: traceId,
    span_id: spanId,
    traceparent: `00-${traceId}-${spanId}-01`,
  });
}

module.exports = {
  AgentTraceLineageError,
  canonicalSpanId,
  canonicalTraceId,
  createTraceContext,
};
