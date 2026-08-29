'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  CompactionProviderRegistry,
  CompactionProviderRegistryError,
  CompactionRuntime,
  CompactionRuntimeError,
  DeterministicCompactionProvider,
  InMemoryCheckpointProvider,
  canonicalJson,
  digest,
} = require('../packages/agent-compaction');
const { CONTRACT_SCHEMA_VERSION } = require('../packages/agent-runtime-contracts');

function source(index, message = null) {
  return {
    source_event_id: `event:history-${index}`,
    source_ref: `session-event://event:history-${index}`,
    sequence: index + 1,
    message: message || { role: index % 2 ? 'assistant' : 'user', content: `history-${index} `.repeat(80) },
  };
}

function fixture() {
  const provider = new DeterministicCompactionProvider({ provider_id: 'compaction:fixture' });
  const registry = new CompactionProviderRegistry();
  const manifestInput = {
    schema_version: CONTRACT_SCHEMA_VERSION,
    request_id: 'request:fixture-manifest',
    provider_id: 'compaction:fixture',
  };
  const manifest = provider.manifest(manifestInput);
  registry.register(provider, manifest);
  const checkpoint = new InMemoryCheckpointProvider({ provider_id: 'checkpoint:fixture' });
  const runtime = new CompactionRuntime({
    compaction_provider_snapshot: registry.snapshot(),
    checkpoint_provider: checkpoint,
    checkpoint_provider_id: 'checkpoint:fixture',
  });
  return { provider, registry, manifest, checkpoint, runtime };
}

function compactInput(overrides = {}) {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    provider_id: 'compaction:fixture',
    compaction_id: 'compaction:fixture-1',
    session_id: 'session:fixture-1',
    turn_id: 'turn:fixture-3',
    trigger: 'context_pressure',
    strategy: 'history_summary',
    target_tokens: 256,
    sources: [source(1), source(2), source(3)],
    ...overrides,
  };
}

test('registry snapshots isolate provider changes and reject duplicate identities', () => {
  const { registry, manifest } = fixture();
  const snapshot = registry.snapshot();
  assert.equal(snapshot.resolve('compaction:fixture', 'history_summary').manifest.provider_id, 'compaction:fixture');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(
    () => registry.register(new DeterministicCompactionProvider({ provider_id: 'compaction:fixture' }), manifest),
    (error) => error instanceof CompactionProviderRegistryError && error.code === 'COMPACTION_PROVIDER_DUPLICATE',
  );
  assert.throws(() => snapshot.resolve('compaction:fixture', 'unknown'), CompactionProviderRegistryError);
});

test('registry snapshots bind provider methods instead of retaining mutable method lookup', () => {
  const honest = new DeterministicCompactionProvider({ provider_id: 'compaction:sealed' });
  const mutable = {
    manifest: (input) => honest.manifest(input),
    assess: (input) => honest.assess(input),
    compact: (input) => honest.compact(input),
    dispose: (input) => honest.dispose(input),
  };
  const registry = new CompactionProviderRegistry();
  registry.register(
    mutable,
    honest.manifest({ schema_version: 1, request_id: 'request:sealed-manifest', provider_id: 'compaction:sealed' }),
  );
  const snapshot = registry.snapshot();
  mutable.compact = () => {
    throw new Error('substituted after snapshot');
  };
  const checkpoint = new InMemoryCheckpointProvider({ provider_id: 'checkpoint:fixture' });
  const runtime = new CompactionRuntime({
    compaction_provider_snapshot: snapshot,
    checkpoint_provider: checkpoint,
    checkpoint_provider_id: 'checkpoint:fixture',
  });
  assert.equal(runtime.compact(compactInput({ provider_id: 'compaction:sealed' })).provider_id, 'compaction:sealed');
});

test('pressure is deterministic and history compaction writes one immutable exact checkpoint', () => {
  const { runtime, checkpoint } = fixture();
  const pressureInput = {
    schema_version: 1,
    provider_id: 'compaction:fixture',
    session_id: 'session:fixture-1',
    turn_id: 'turn:fixture-3',
    trigger: 'context_pressure',
    input_tokens: 900,
    input_limit_tokens: 1000,
  };
  assert.deepEqual(runtime.assess(pressureInput), runtime.assess(pressureInput));
  assert.equal(runtime.assess(pressureInput).should_compact, true);

  const input = compactInput();
  const record = runtime.compact(input, ['event:history-4']);
  assert.equal(record.source_digest, digest(input.sources));
  assert.deepEqual(record.source_event_ids, input.sources.map((entry) => entry.source_event_id));
  assert.deepEqual(record.retained_source_event_ids, ['event:history-4']);
  assert.ok(record.after.bytes < record.before.bytes);
  const stored = checkpoint.get({
    schema_version: 1,
    provider_id: 'checkpoint:fixture',
    checkpoint_id: input.compaction_id,
    session_id: input.session_id,
  });
  assert.equal(stored.checkpoint_ref, record.checkpoint_ref);
  assert.equal(stored.payload_digest, digest(stored.payload));
  assert.deepEqual(runtime.compact(input, ['event:history-4']), record);
});

test('crash retry reconstructs the exact result from checkpoint without reinvoking provider', () => {
  const honest = new DeterministicCompactionProvider({ provider_id: 'compaction:resume' });
  let calls = 0;
  const provider = {
    manifest: (input) => honest.manifest(input),
    assess: (input) => honest.assess(input),
    compact(input) {
      calls++;
      if (calls > 1) throw new Error('nondeterministic second invocation must be unreachable');
      return honest.compact(input);
    },
    dispose: (input) => honest.dispose(input),
  };
  const registry = new CompactionProviderRegistry();
  registry.register(
    provider,
    honest.manifest({ schema_version: 1, request_id: 'request:resume-manifest', provider_id: 'compaction:resume' }),
  );
  const runtime = new CompactionRuntime({
    compaction_provider_snapshot: registry.snapshot(),
    checkpoint_provider: new InMemoryCheckpointProvider({ provider_id: 'checkpoint:fixture' }),
    checkpoint_provider_id: 'checkpoint:fixture',
  });
  const input = compactInput({ provider_id: 'compaction:resume', compaction_id: 'compaction:resume-1' });
  const first = runtime.compact(input);
  assert.deepEqual(runtime.compact(input), first);
  assert.equal(calls, 1);
});

test('manifest caps fail closed before input dispatch and after provider output', () => {
  const tinyInput = new DeterministicCompactionProvider({ provider_id: 'compaction:tiny-input', max_input_bytes: 128 });
  const inputRegistry = new CompactionProviderRegistry();
  inputRegistry.register(
    tinyInput,
    tinyInput.manifest({ schema_version: 1, request_id: 'request:tiny-input', provider_id: 'compaction:tiny-input' }),
  );
  const inputRuntime = new CompactionRuntime({
    compaction_provider_snapshot: inputRegistry.snapshot(),
    checkpoint_provider: new InMemoryCheckpointProvider({ provider_id: 'checkpoint:fixture' }),
    checkpoint_provider_id: 'checkpoint:fixture',
  });
  assert.throws(
    () => inputRuntime.compact(compactInput({ provider_id: 'compaction:tiny-input' })),
    (error) => error.code === 'COMPACTION_INPUT_CAP_EXCEEDED',
  );

  const tinyOutput = new DeterministicCompactionProvider({ provider_id: 'compaction:tiny-output', max_output_bytes: 32 });
  const outputRegistry = new CompactionProviderRegistry();
  outputRegistry.register(
    tinyOutput,
    tinyOutput.manifest({ schema_version: 1, request_id: 'request:tiny-output', provider_id: 'compaction:tiny-output' }),
  );
  const outputRuntime = new CompactionRuntime({
    compaction_provider_snapshot: outputRegistry.snapshot(),
    checkpoint_provider: new InMemoryCheckpointProvider({ provider_id: 'checkpoint:fixture' }),
    checkpoint_provider_id: 'checkpoint:fixture',
  });
  assert.throws(
    () => outputRuntime.compact(compactInput({ provider_id: 'compaction:tiny-output' })),
    (error) => ['COMPACTION_PROVIDER_FAILED', 'COMPACTION_OUTPUT_CAP_EXCEEDED'].includes(error.code),
  );
});

test('tool-result pruning removes result bodies while preserving identity, evidence and digest', () => {
  const { runtime, checkpoint } = fixture();
  const toolResult = {
    status: 'succeeded',
    result: { body: 'sensitive external payload '.repeat(100) },
    error: null,
    evidence_refs: ['evidence://tool/read-1'],
    warnings: ['fixture warning'],
  };
  const input = compactInput({
    compaction_id: 'compaction:tool-1',
    trigger: 'tool_result_pressure',
    strategy: 'tool_result_prune',
    sources: [
      source(1, {
        role: 'tool',
        name: 'fixture.read',
        tool_call_id: 'call:fixture-1',
        content: canonicalJson(toolResult),
      }),
    ],
  });
  const record = runtime.compact(input);
  assert.deepEqual(record.pruned_tool_call_ids, ['call:fixture-1']);
  assert.match(record.replacement_messages[0].content, /evidence:\/\/tool\/read-1/);
  assert.match(record.replacement_messages[0].content, /result_digest/);
  assert.doesNotMatch(record.replacement_messages[0].content, /sensitive external payload/);
  const stored = checkpoint.get({
    schema_version: 1,
    provider_id: 'checkpoint:fixture',
    checkpoint_id: input.compaction_id,
    session_id: input.session_id,
  });
  assert.doesNotMatch(canonicalJson(stored.payload), /sensitive external payload/);
});

test('runtime rejects a provider result not bound to the exact input before checkpoint persistence', () => {
  const honest = new DeterministicCompactionProvider({ provider_id: 'compaction:forged' });
  const provider = {
    manifest: (input) => honest.manifest(input),
    assess: (input) => honest.assess(input),
    compact: (input) => ({ ...honest.compact(input), source_digest: `sha256:${'0'.repeat(64)}` }),
    dispose: (input) => honest.dispose(input),
  };
  const registry = new CompactionProviderRegistry();
  registry.register(
    provider,
    honest.manifest({ schema_version: 1, request_id: 'request:forged-manifest', provider_id: 'compaction:forged' }),
  );
  let writes = 0;
  const checkpoint = {
    put() {
      writes++;
      throw new Error('must not write');
    },
    get() {
      const error = new Error('not found');
      error.code = 'CHECKPOINT_NOT_FOUND';
      throw error;
    },
    dispose() {},
  };
  const runtime = new CompactionRuntime({
    compaction_provider_snapshot: registry.snapshot(),
    checkpoint_provider: checkpoint,
    checkpoint_provider_id: 'checkpoint:fixture',
  });
  assert.throws(
    () => runtime.compact(compactInput({ provider_id: 'compaction:forged' })),
    (error) => error instanceof CompactionRuntimeError && error.code === 'COMPACTION_SOURCE_DIGEST_MISMATCH',
  );
  assert.equal(writes, 0);
});

test('runtime independently verifies provider accounting and ordered tool identities', () => {
  function runtimeWithMutation(providerId, mutate) {
    const honest = new DeterministicCompactionProvider({ provider_id: providerId });
    const provider = {
      manifest: (input) => honest.manifest(input),
      assess: (input) => honest.assess(input),
      compact: (input) => mutate(honest.compact(input)),
      dispose: (input) => honest.dispose(input),
    };
    const registry = new CompactionProviderRegistry();
    registry.register(
      provider,
      honest.manifest({ schema_version: 1, request_id: `request:${providerId}:manifest`, provider_id: providerId }),
    );
    return new CompactionRuntime({
      compaction_provider_snapshot: registry.snapshot(),
      checkpoint_provider: new InMemoryCheckpointProvider({ provider_id: 'checkpoint:fixture' }),
      checkpoint_provider_id: 'checkpoint:fixture',
    });
  }

  const accounting = runtimeWithMutation('compaction:false-accounting', (result) => ({
    ...result,
    before: { ...result.before, bytes: result.before.bytes + 1 },
  }));
  assert.throws(
    () => accounting.compact(compactInput({ provider_id: 'compaction:false-accounting' })),
    (error) => ['COMPACTION_ACCOUNTING_MISMATCH', 'COMPACTION_PROVIDER_FAILED'].includes(error.code),
  );

  const identity = runtimeWithMutation('compaction:false-identity', (result) => ({
    ...result,
    replacement_messages: result.replacement_messages.map((message) => ({ ...message, tool_call_id: 'call:forgedxx' })),
    pruned_tool_call_ids: ['call:forgedxx'],
  }));
  const toolInput = compactInput({
    provider_id: 'compaction:false-identity',
    trigger: 'tool_result_pressure',
    strategy: 'tool_result_prune',
    sources: [
      source(1, {
        role: 'tool',
        name: 'fixture.read',
        tool_call_id: 'call:original',
        content: canonicalJson({ status: 'succeeded', result: { large: 'x'.repeat(1000) }, evidence_refs: [], warnings: [] }),
      }),
    ],
  });
  assert.throws(
    () => identity.compact(toolInput),
    (error) => error.code === 'COMPACTION_TOOL_IDENTITY_MISMATCH',
  );
});

test('checkpoint ids are immutable and dispose never erases evidence', () => {
  const checkpoint = new InMemoryCheckpointProvider({ provider_id: 'checkpoint:fixture' });
  const input = {
    schema_version: 1,
    provider_id: 'checkpoint:fixture',
    checkpoint_id: 'checkpoint:immutable',
    session_id: 'session:fixture-1',
    payload: { value: 1 },
  };
  const first = checkpoint.put(input);
  assert.deepEqual(checkpoint.put(input), first);
  assert.throws(() => checkpoint.put({ ...input, payload: { value: 2 } }), /immutable/);
  checkpoint.dispose({ schema_version: 1, provider_id: 'checkpoint:fixture', session_id: input.session_id });
  assert.deepEqual(
    checkpoint.get({
      schema_version: 1,
      provider_id: 'checkpoint:fixture',
      checkpoint_id: input.checkpoint_id,
      session_id: input.session_id,
    }),
    first,
  );
});

test('checkpoint payloads reject nested credential-bearing fields', () => {
  const checkpoint = new InMemoryCheckpointProvider({ provider_id: 'checkpoint:fixture' });
  assert.throws(
    () => checkpoint.put({
      schema_version: 1,
      provider_id: 'checkpoint:fixture',
      checkpoint_id: 'checkpoint:secret',
      session_id: 'session:fixture-1',
      payload: { nested: { api_key: 'plaintext-secret' } },
    }),
    (error) =>
      error.code === 'AGENT_CONTRACT_SCHEMA_INVALID' &&
      error.details.issues.some((issue) => issue.message.includes('credential-bearing checkpoint field is forbidden')),
  );
  assert.throws(
    () => checkpoint.get({
      schema_version: 1,
      provider_id: 'checkpoint:fixture',
      checkpoint_id: 'checkpoint:secret',
      session_id: 'session:fixture-1',
    }),
    (error) => error.code === 'CHECKPOINT_NOT_FOUND',
  );
});
