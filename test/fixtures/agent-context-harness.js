'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');

const Database = require('better-sqlite3');

const { ContextAssembler } = require('../../packages/agent-context');
const { RelationalSessionEventStore } = require('../../packages/agent-session-store');
const { ModelProviderRegistry, ScriptedModelProvider } = require('../../packages/model-providers');
const { ExecutionEventLedger } = require('../../tools/mcp-project-state/lib/execution-event-ledger');
const { applyExecutionLedgerFixtureSchema } = require('../../tools/mcp-project-state/lib/execution-ledger-schema');
const { runMigrations } = require('../../tools/mcp-project-state/lib/migrations');
const fixtures = require('./agent-runtime-contracts');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'tools', 'mcp-project-state', 'migrations');

function openStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR, { log: () => {} });
  applyExecutionLedgerFixtureSchema(db);
  return { db, store: new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(db) }) };
}

function session(sessionId) {
  return { ...structuredClone(fixtures.kernelSession), session_id: sessionId, metadata: { purpose: 'context-assembly-test' } };
}

function providerManifest({ contextTokens = 128_000, imageInput = false } = {}) {
  const manifest = structuredClone(fixtures.modelManifest);
  manifest.limits.context_tokens = contextTokens;
  manifest.secret_refs = [];
  if (imageInput) manifest.capabilities = [...manifest.capabilities, 'image_input'];
  return manifest;
}

function providerSnapshot(manifest) {
  const registry = new ModelProviderRegistry();
  const routes = [
    { match: () => true, events: [] },
    { match: () => false, events: [] },
  ];
  registry.register(new ScriptedModelProvider({ manifest, routes }), manifest);
  return registry.snapshot();
}

function assembler(store, { manifest = providerManifest(), counter, mediaStore } = {}) {
  return new ContextAssembler({
    session_store: store,
    model_provider_snapshot: providerSnapshot(manifest),
    ...(counter ? { token_counter: counter } : {}),
    ...(mediaStore ? { media_store: mediaStore } : {}),
  });
}

function eventId(label) {
  return `event:${createHash('sha256').update(label).digest('hex').slice(0, 20)}`;
}

function prepareSession(store, spec, turnId = 'turn:context-1', turnEventId = 'event:context-turn') {
  const turnMessage = { role: 'user', content: 'implement the selected change' };
  store.append({
    session_id: spec.session_id,
    expected_version: 0,
    events: [
      {
        schema_version: 1,
        event_id: eventId(`${spec.session_id}:created`),
        session_id: spec.session_id,
        sequence: 1,
        occurred_at: '2026-08-22T02:10:00Z',
        event_type: 'session.created',
        payload: { spec },
      },
      {
        schema_version: 1,
        event_id: turnEventId,
        session_id: spec.session_id,
        sequence: 2,
        occurred_at: '2026-08-22T02:10:01Z',
        event_type: 'turn.started',
        payload: { turn_id: turnId, input: turnMessage },
      },
    ],
  });
  return turnMessage;
}

function source(sourceRef, content, classification = 'internal') {
  return { source_ref: sourceRef, classification, content };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Turns a v1 source into a v2 source that declares its own authority and provenance. */
function declare(base, { authority = 'data', origin = 'tool', trust = 'untrusted', transform = [], content = base.content ?? base.message?.content } = {}) {
  return {
    ...base,
    authority,
    provenance: {
      origin,
      source_ref: base.source_ref,
      digest: sha256(content),
      retrieved_at: '2026-08-22T02:10:02Z',
      trust,
      transform,
    },
  };
}

function assemblyInput(spec, turnMessage, overrides = {}) {
  return {
    schema_version: 1,
    request_id: `request:${spec.session_id.split(':').at(-1)}`,
    turn_id: 'turn:context-1',
    event_id: eventId(`${spec.session_id}:context`),
    occurred_at: '2026-08-22T02:10:02Z',
    expected_version: 2,
    session: spec,
    instructions: {
      constitution: [source('governance://constitution/a', 'constitutional rule A')],
      project: [source('project://instructions', 'project rule')],
      adapter: [],
      agent: [],
      skill: [],
    },
    runtime_context: [source('runtime://environment', 'runtime fact')],
    references: [source('source://reference-a', 'reference A')],
    memory: [],
    current_turn: { source_ref: 'session-event://event:context-turn', message: turnMessage },
    tools: structuredClone(fixtures.modelRequest.tools),
    parameters: { max_output_tokens: 512, temperature: null, stop: [] },
    overflow_policy: 'reject',
    ...overrides,
  };
}

function crc32Placeholder() {
  return Buffer.alloc(4);
}

/** Minimal byte strings that carry the real magic (and, for PNG, the real IHDR dimensions). */
function pngBytes(width, height, filler = 32) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    length,
    Buffer.from('IHDR'),
    header,
    crc32Placeholder(),
    Buffer.alloc(filler, 7),
  ]);
}

function jpegBytes({ width = 4, height = 3, filler = 32, marker = 0xc0 } = {}) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14, 1)]);
  const frame = Buffer.alloc(19);
  frame.set([0xff, marker, 0x00, 0x11, 0x08]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame, Buffer.alloc(filler, 9)]);
}

function riff(chunkType, data, filler) {
  const chunk = Buffer.alloc(8);
  chunk.write(chunkType, 0, 'latin1');
  chunk.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from('WEBP'), chunk, data, Buffer.alloc(filler, 5)]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length, 0);
  return Buffer.concat([Buffer.from('RIFF'), size, body]);
}

/** kind: 'vp8' (lossy), 'vp8l' (lossless) or 'vp8x' (extended canvas). */
function webpBytes({ width = 4, height = 3, filler = 32, kind = 'vp8' } = {}) {
  if (kind === 'vp8l') {
    const data = Buffer.alloc(5);
    data[0] = 0x2f;
    data.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
    return riff('VP8L', data, filler);
  }
  if (kind === 'vp8x') {
    const data = Buffer.alloc(10);
    data.writeUIntLE(width - 1, 4, 3);
    data.writeUIntLE(height - 1, 7, 3);
    return riff('VP8X', data, filler);
  }
  const data = Buffer.alloc(10);
  data.set([0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a]);
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return riff('VP8 ', data, filler);
}

function mediaDescriptor(buffer, overrides = {}) {
  const digest = sha256(buffer);
  return {
    source_ref: 'media://capture/one',
    media_type: 'image/png',
    digest,
    bytes: buffer.length,
    width: 4,
    height: 3,
    origin: 'browser',
    authority: 'data',
    trust: 'untrusted',
    transform: [],
    priority: 50,
    artifact_ref: `artifact://sha256/${digest}`,
    ...overrides,
  };
}

module.exports = {
  assembler,
  assemblyInput,
  declare,
  eventId,
  jpegBytes,
  mediaDescriptor,
  openStore,
  pngBytes,
  prepareSession,
  providerManifest,
  session,
  sha256,
  source,
  riff,
  webpBytes,
};
