'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { AgentTraceLineageError, canonicalSpanId, canonicalTraceId, createTraceContext } = require('../packages/agent-trace-lineage');

test('trace and span identities are deterministic W3C-compatible projections', () => {
  const first = createTraceContext('session:root', 'event:turn');
  const replay = createTraceContext('session:root', 'event:turn');
  assert.deepEqual(replay, first);
  assert.match(first.trace_id, /^[0-9a-f]{32}$/u);
  assert.match(first.span_id, /^[0-9a-f]{16}$/u);
  assert.equal(first.traceparent, `00-${first.trace_id}-${first.span_id}-01`);
  assert.equal(canonicalTraceId(first.trace_id), first.trace_id);
  assert.equal(canonicalSpanId(first.span_id), first.span_id);
  assert.equal(Object.isFrozen(first), true);
});

test('trace identities fail closed on empty, whitespace, control, and oversized input', () => {
  for (const value of ['', 'trace with spaces', 'trace\nnewline', 'trace\0control', 'x'.repeat(1025)]) {
    assert.throws(
      () => canonicalTraceId(value),
      (error) => error instanceof AgentTraceLineageError,
    );
  }
});
