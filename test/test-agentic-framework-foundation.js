'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_ROOT = path.join(ROOT, '_graph', 'agentic-framework');
const ADR_PATH = path.join(ROOT, '.enterprise', '.specs', 'decisions', 'ADR-0024-model-agnostic-agent-framework.md');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('A0 publishes every governed and sharded artifact', () => {
  for (const relativePath of [
    '.enterprise/.specs/decisions/ADR-0024-model-agnostic-agent-framework.md',
    '_graph/agentic-framework/index.md',
    '_graph/agentic-framework/BASELINE.md',
    '_graph/agentic-framework/GOAL-GRAPH.md',
    '_graph/agentic-framework/STATE.md',
    '_graph/agentic-framework/state/events.jsonl',
    '_graph/agentic-framework/state/checkpoints/A0-foundation-readiness.md',
    '_graph/agentic-framework/state/checkpoints/A0-completion.md',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), true, relativePath);
  }
});

test('ADR-0024 is accepted and contains every mandatory section', () => {
  const adr = fs.readFileSync(ADR_PATH, 'utf8');
  assert.match(adr, /\*\*Status:\*\* Accepted/);
  assert.match(adr, /^## Status$/m);
  assert.doesNotMatch(adr, /\*\*Status:\*\* Proposed/);
  for (const heading of ['Context', 'Decision', 'Alternatives Considered', 'Consequences', 'Mitigations', 'References']) {
    assert.match(adr, new RegExp(`^## ${heading}$`, 'm'));
  }
  assert.match(adr, /ModelProvider/);
  assert.match(adr, /RuntimeProvider/);
  assert.match(adr, /Accepted by explicit human authorization/);
});

test('ADR index and graph index reference the canonical artifacts', () => {
  assert.match(
    read('.enterprise/.specs/decisions/_INDEX.md'),
    /ADR-0024-model-agnostic-agent-framework\.md\)[^\n]+Accepted \(2026-08-21\)/,
  );
  const index = read('_graph/agentic-framework/index.md');
  for (const target of ['BASELINE.md', 'GOAL-GRAPH.md', 'STATE.md', 'state/events.jsonl']) {
    assert.equal(index.includes(target), true, target);
  }
});

test('goal graph has an acyclic proof and activation tail', () => {
  const graph = read('_graph/agentic-framework/GOAL-GRAPH.md');
  const nodeRows = [...graph.matchAll(/^\| (A\d+)\s+\|/gm)].map((match) => match[1]);
  assert.deepEqual(
    nodeRows,
    Array.from({ length: 14 }, (_, index) => `A${index}`),
  );
  assert.match(graph, /\| A12\s+\|[^\n]+\| A0–A11\s+\|/);
  assert.match(graph, /\| A13\s+\|[^\n]+\| A12, harness-unification G9\s+\|/);
  assert.doesNotMatch(graph, /\| A12\s+\|[^\n]+\| all\s+\|/);
  assert.match(graph, /\| A3\s+\|[^\n]+OpenAI-compatible streaming provider/);
  assert.match(graph, /fake HTTP endpoint/);
  assert.match(graph, /\| A13\s+\|[^\n]+\| A12, harness-unification G9\s+\|[^\n]+Hard human gate/);
});

test('state declares governance metadata and advances only after approval', () => {
  for (const artifact of ['BASELINE.md', 'GOAL-GRAPH.md', 'STATE.md', 'index.md']) {
    const content = read(`_graph/agentic-framework/${artifact}`);
    assert.match(content, /\*\*Artifact type:\*\*/, artifact);
    assert.match(content, /\*\*Scope:\*\*/, artifact);
    assert.match(content, /\*\*Governing documents:\*\*/, artifact);
    assert.match(content, /Constitution/, artifact);
  }
  const state = read('_graph/agentic-framework/STATE.md');
  assert.match(state, /A0 completed; A1 ready to start/);
  assert.match(state, /Architectural gate:\*\* satisfied/);
  assert.match(state, /G9 compatibility evidence and separate human authorization remain prerequisites for activation/);

  const checkpoint = read('_graph/agentic-framework/state/checkpoints/A0-completion.md');
  assert.match(checkpoint, /authorizes A1–A12 fixture implementation/);
  assert.match(
    checkpoint,
    /does not authorize production schema migration, runtime cutover, merge, push, deployment, secret access or A13 activation/,
  );

  const adr = fs.readFileSync(ADR_PATH, 'utf8');
  assert.match(adr, /- \[ \] Operational activation explicitly authorized/);
});

test('event stream is valid, unique and records governance metadata', () => {
  const lines = fs
    .readFileSync(path.join(GRAPH_ROOT, 'state', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n');
  const events = lines.map((line) => JSON.parse(line));
  assert.ok(events.length >= 6);
  assert.deepEqual(
    events.slice(0, 6).map((event) => event.event_id),
    Array.from({ length: 6 }, (_, index) => `agentic-framework-${String(index + 1).padStart(4, '0')}`),
  );
  assert.deepEqual(
    events.slice(0, 6).map((event) => event.event_type),
    ['baseline.captured', 'node.ready_for_approval', 'goal.blocked', 'goal.resumed', 'node.completed', 'node.evidence_attached'],
  );
  assert.deepEqual(
    events.slice(0, 6).map((event) => event.status),
    ['awaiting_approval', 'awaiting_approval', 'blocked', 'active', 'completed', 'completed'],
  );
  assert.equal(new Set(events.map((event) => event.event_id)).size, events.length);
  const timestamps = events.map((event) => Date.parse(event.occurred_at));
  assert.equal(
    timestamps.every((timestamp, index) => index === 0 || timestamp >= timestamps[index - 1]),
    true,
  );
  assert.equal(events[0].artifact_type, 'governed-goal-event');
  assert.equal(events[0].scope, 'agentic-framework');
  assert.deepEqual(events[0].governing_documents, ['constitution', 'ADR-0024', 'adr-policy', 'automated-validation']);
  assert.equal(events[0].status, 'awaiting_approval');
  assert.match(events[3].authority, /ADR aprovada pode alterar e prosseguir!/);
  assert.equal(events[4].event_type, 'node.completed');
  assert.equal(events[4].node_id, 'A0');
  assert.equal(events[4].next_node, 'A1');
  assert.equal(events[5].event_type, 'node.evidence_attached');
});
