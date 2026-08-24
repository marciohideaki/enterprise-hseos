'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const yaml = require('yaml');

const {
  BOUND_MANIFEST,
  cancelBoundKernelAgent,
  resumeBoundKernelAgent,
  runBoundKernelAgent,
} = require('../tools/cli/lib/bound-kernel-agent-runtime');
const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, '.agents', 'activation', 'provider-bindings', 'openai-compatible.example.yaml');
const SECRET = 'ephemeral-bound-kernel-secret';
const ATTESTATION = Object.freeze({
  provider: 'ai-jail',
  profile: 'lockdown',
  evidence_ref: 'sandbox://fixture/lockdown',
});

function bindingFixture(t, { bindingId = 'provider-binding:bound-fixture', model = 'fixture/model' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-bound-binding-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binding = yaml.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  binding.binding_id = bindingId;
  binding.provider.model = model;
  binding.provider.base_url = 'https://provider.fixture.invalid/v1';
  binding.transport.max_attempts = 1;
  binding.transport.retry_delay_ms = 0;
  const filename = path.join(directory, 'binding.yaml');
  fs.writeFileSync(filename, yaml.stringify(binding), { encoding: 'utf8', mode: 0o600 });
  return filename;
}

function authorize(attestation = ATTESTATION) {
  return async () => ({ ...attestation });
}

function response(frames) {
  const encoded = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`;
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : 'bound-kernel-fixture') },
    body: (async function* body() {
      yield Buffer.from(encoded);
    })(),
  };
}

function successfulFetch(observed) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    observed.push({ url, authorization: init.headers.authorization, body });
    if (body.messages.at(-1).role === 'tool') {
      return response([
        { choices: [{ delta: { content: 'state persisted' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 8, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 1 } } },
      ]);
    }
    return response([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call:set-state',
                  function: { name: 'temporary.set-state', arguments: '{"value":"durable"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]);
  };
}

function cleanupState(state) {
  const handle = openExecutionLedgerFileFixture(state);
  handle.cleanup();
}

test('bound kernel runs a real provider tool loop with sandbox evidence and no persisted secret', async (t) => {
  const bindingPath = bindingFixture(t);
  const observed = [];
  const result = await runBoundKernelAgent({
    bindingPath,
    value: 'durable',
    environment: { HSEOS_MODEL_PROVIDER_API_KEY: SECRET },
    executionAuthorizer: authorize(),
    fetch_impl: successfulFetch(observed),
  });
  try {
    assert.equal(result.status, 'completed');
    assert.equal(result.terminal, true);
    assert.equal(result.operational, false);
    assert.equal(result.output, 'state persisted');
    assert.deepEqual(JSON.parse(fs.readFileSync(result.world_state, 'utf8')), { schema_version: 1, value: 'durable' });
    assert.equal(observed.length, 2);
    assert.ok(observed.every((request) => request.authorization === `Bearer ${SECRET}`));
    assert.equal(observed[0].body.tools[0].function.name, 'temporary.set-state');

    const handle = openExecutionLedgerFileFixture(result.state);
    try {
      const durable = JSON.stringify(
        handle.db.prepare('SELECT payload_json, evidence_refs_json FROM execution_events ORDER BY rowid ASC').all(),
      );
      assert.match(durable, /sandbox:\/\/fixture\/lockdown/);
      assert.doesNotMatch(durable, new RegExp(SECRET));
      assert.doesNotMatch(fs.readFileSync(path.join(result.state, BOUND_MANIFEST), 'utf8'), new RegExp(SECRET));
    } finally {
      handle.close();
    }
  } finally {
    cleanupState(result.state);
  }
});

test('bound kernel resumes across an assembly boundary with the immutable binding', async (t) => {
  const bindingPath = bindingFixture(t);
  let secretReads = 0;
  const createEnvironment = {};
  Object.defineProperty(createEnvironment, 'HSEOS_MODEL_PROVIDER_API_KEY', {
    enumerable: true,
    get() {
      secretReads += 1;
      return SECRET;
    },
  });
  const created = await runBoundKernelAgent({
    bindingPath,
    value: 'durable',
    createOnly: true,
    environment: createEnvironment,
    executionAuthorizer: authorize(),
  });
  try {
    assert.equal(secretReads, 0);
    assert.equal(created.terminal, false);
    const resumed = await resumeBoundKernelAgent({
      state: created.state,
      expectedSequence: created.current_sequence,
      message: 'persist the bound value',
      environment: { HSEOS_MODEL_PROVIDER_API_KEY: SECRET },
      executionAuthorizer: authorize(),
      fetch_impl: successfulFetch([]),
    });
    assert.equal(resumed.session_id, created.session_id);
    assert.equal(resumed.status, 'completed');
    assert.deepEqual(JSON.parse(fs.readFileSync(resumed.world_state, 'utf8')), { schema_version: 1, value: 'durable' });
  } finally {
    cleanupState(created.state);
  }
});

test('bound kernel can be cancelled without provider dispatch or secret resolution', async (t) => {
  const bindingPath = bindingFixture(t);
  const created = await runBoundKernelAgent({ bindingPath, createOnly: true, executionAuthorizer: authorize() });
  try {
    const cancelled = await cancelBoundKernelAgent({ state: created.state, reason: 'fixture cancellation' });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.terminal, true);
    assert.equal(cancelled.world_state, null);
  } finally {
    cleanupState(created.state);
  }
});

test('different provider bindings use the same kernel assembly and preserve outcomes', async (t) => {
  const outcomes = [];
  for (const descriptor of [
    { bindingId: 'provider-binding:first-fixture', model: 'fixture/first' },
    { bindingId: 'provider-binding:second-fixture', model: 'fixture/second' },
  ]) {
    const result = await runBoundKernelAgent({
      bindingPath: bindingFixture(t, descriptor),
      value: 'durable',
      environment: { HSEOS_MODEL_PROVIDER_API_KEY: SECRET },
      executionAuthorizer: authorize(),
      fetch_impl: successfulFetch([]),
    });
    try {
      outcomes.push({ status: result.status, output: result.output, state: JSON.parse(fs.readFileSync(result.world_state, 'utf8')) });
    } finally {
      cleanupState(result.state);
    }
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test('execution requires a lockdown attestation before fixture, secret, or network access', async (t) => {
  const bindingPath = bindingFixture(t);
  let fetched = 0;
  let secretReads = 0;
  const environment = {};
  Object.defineProperty(environment, 'HSEOS_MODEL_PROVIDER_API_KEY', {
    enumerable: true,
    get() {
      secretReads += 1;
      return SECRET;
    },
  });
  await assert.rejects(
    () =>
      runBoundKernelAgent({
        bindingPath,
        environment,
        fetch_impl: async () => {
          fetched += 1;
        },
      }),
    /execution attestation authorizer is required/,
  );
  await assert.rejects(
    () => runBoundKernelAgent({ bindingPath, executionAuthorizer: authorize({ ...ATTESTATION, profile: 'permissive' }) }),
    /does not prove the required ai-jail lockdown profile/,
  );
  assert.equal(secretReads, 0);
  assert.equal(fetched, 0);
});

test('resume rejects changed attestation, optimistic sequence, binding and workspace before effects', async (t) => {
  const bindingPath = bindingFixture(t);
  const created = await runBoundKernelAgent({ bindingPath, value: 'durable', createOnly: true, executionAuthorizer: authorize() });
  try {
    await assert.rejects(
      () =>
        resumeBoundKernelAgent({
          state: created.state,
          expectedSequence: created.current_sequence,
          executionAuthorizer: authorize({ ...ATTESTATION, evidence_ref: 'sandbox://fixture/other' }),
        }),
      /attestation differs/,
    );
    await assert.rejects(
      () => resumeBoundKernelAgent({ state: created.state, executionAuthorizer: authorize() }),
      /expected_sequence is required/,
    );

    const manifestPath = path.join(created.state, BOUND_MANIFEST);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.binding.provider.model = 'fixture/tampered';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await assert.rejects(
      () =>
        resumeBoundKernelAgent({
          state: created.state,
          expectedSequence: created.current_sequence,
          executionAuthorizer: authorize(),
        }),
      /immutable profile or binding/,
    );
  } finally {
    cleanupState(created.state);
  }

  const confined = await runBoundKernelAgent({ bindingPath, value: 'durable', createOnly: true, executionAuthorizer: authorize() });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-bound-outside-'));
  try {
    fs.rmSync(path.join(confined.state, 'workspace'), { recursive: true });
    fs.symlinkSync(outside, path.join(confined.state, 'workspace'), 'dir');
    await assert.rejects(
      () =>
        resumeBoundKernelAgent({
          state: confined.state,
          expectedSequence: confined.current_sequence,
          message: 'try escaped effect',
          environment: { HSEOS_MODEL_PROVIDER_API_KEY: SECRET },
          executionAuthorizer: authorize(),
          fetch_impl: successfulFetch([]),
        }),
      /temporary workspace/,
    );
    assert.equal(fs.existsSync(path.join(outside, 'world-state.json')), false);
  } finally {
    cleanupState(confined.state);
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
