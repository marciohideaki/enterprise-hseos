'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { randomUUID, createHash } = require('node:crypto');
const { engineeringDigest } = require('../tools/cli/lib/engineering-task-state');
const YAML = require('yaml');
const { createEngineeringExample } = require('../tools/examples/engineering-task');
const { runEngineeringTask, inspectEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
const { summarizeProviderProof } = require('../docs/evolution/w3/evidence/shared/summarize-provider-proof.cjs');
const { toWireToolName } = require('../packages/model-providers/openai-compatible-provider');

function response(frames) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name === 'content-type' ? 'text/event-stream' : null) },
    body: (async function* () {
      yield Buffer.from(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n');
    })(),
  };
}

for (const correction of [false, true])
  test(`bound engineering worker ${correction ? 'corrects a rejection' : 'implements the task'} through the broker without persisting its credential`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-engineering-binding-'));
    const secret = randomUUID();
    let result;
    let workflowResult;
    try {
      const example = structuredClone(createEngineeringExample('addition'));
      if (correction) {
        example.contract.max_failed_corrections = 1;
        example.contract.limits.max_tokens = 500_000;
        const bad = 'module.exports=()=>0;';
        const digest = createHash('sha256').update(bad).digest('hex');
        example.responses = [
          { name: 'engineering.write', input: { ...example.responses[0].input, content: bad } },
          { name: 'fixture.submit', input: {} },
          {
            name: 'engineering.diagnose',
            input: {
              cause: 'Constant output violates addition.',
              correction: 'Use both arguments to calculate their sum.',
              requirement_ids: ['r1'],
              files_sha256: engineeringDigest([{ path: 'add.js', content: bad, sha256: digest }]),
            },
          },
          { name: 'engineering.write', input: { ...example.responses[0].input, expected_sha256: digest } },
          example.responses[1],
        ];
      }
      fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(example.contract));
      const binding = YAML.parse(
        fs.readFileSync(path.join(__dirname, '../.agents/activation/provider-bindings/openai-compatible.example.yaml'), 'utf8'),
      );
      binding.provider.base_url = 'https://engineering.fixture.invalid/v1';
      binding.provider.limits = { context_tokens: 1_000_000, max_output_tokens: 65_536, max_parallel_requests: 1 };
      binding.provider.secret_refs[0].source_ref = 'env://ENGINEERING_FIXTURE_CREDENTIAL';
      binding.transport.max_attempts = 1;
      fs.writeFileSync(path.join(directory, 'binding.yaml'), YAML.stringify(binding));
      let calls = 0;
      const fetchImpl = async (url, init) => {
        assert.equal(url, 'https://engineering.fixture.invalid/v1/chat/completions');
        assert.equal(init.headers.authorization, `Bearer ${secret}`);
        const body = JSON.parse(init.body);
        assert.equal(init.body.includes(secret), false);
        assert.ok(body.messages.some((message) => message.content?.includes('protected-criteria')));
        const next = example.responses[calls++];
        if (correction && calls > 2) assert.ok(body.messages.some((message) => message.content?.includes('protected-engineering-review')));
        return next && next.name !== 'fixture.submit'
          ? response([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: `call:engineering:${calls}`,
                          function: { name: toWireToolName(next.name), arguments: JSON.stringify(next.input) },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              },
            ])
          : response([
              { choices: [{ delta: { content: 'implemented' }, finish_reason: 'stop' }] },
              { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } },
            ]);
      };
      result = await runEngineeringTask({
        taskContract: path.join(directory, 'task.json'),
        binding: path.join(directory, 'binding.yaml'),
        createOnly: true,
        environment: {},
        fetchImpl: () => {
          throw new Error('create-only cannot invoke a provider');
        },
      });
      assert.equal(result.task_result, 'not_executed');
      assert.equal(calls, 0);
      result = await inspectEngineeringTask({
        state: result.state,
        action: 'resume',
        expectedSequence: result.current_sequence,
        environment: { ENGINEERING_FIXTURE_CREDENTIAL: secret },
        fetchImpl,
      });
      assert.equal(result.task_result, 'approved', JSON.stringify(result));
      assert.equal(calls, example.responses.length + 1);
      const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
      assert.equal(JSON.stringify(evidence).includes(secret), false);
      for (const entry of fs.readdirSync(result.state, { withFileTypes: true }))
        if (entry.isFile()) assert.equal(fs.readFileSync(path.join(result.state, entry.name)).includes(Buffer.from(secret)), false);
      assert.deepEqual(await inspectEngineeringTask({ state: result.state }), result);
      const { runEngineeringWorkflow } = require('../tools/cli/lib/engineering-workflow-runtime');
      calls = 0;
      workflowResult = await runEngineeringWorkflow({
        definition: {
          schema_version: 1,
          workflow_id: 'workflow:bound-engineering',
          max_parallelism: 1,
          limits: { ...example.contract.limits, max_children: 1, max_workflow_steps: 1 },
          tasks: [{ id: 'addition', contract: example.contract, binding, depends_on: [] }],
        },
        environment: { ENGINEERING_FIXTURE_CREDENTIAL: secret },
        fetchImpl,
      });
      assert.equal(workflowResult.status, 'completed', JSON.stringify(workflowResult));
      assert.equal(workflowResult.tasks[0].result, 'approved');
      assert.equal(calls, example.responses.length + 1);
    } finally {
      if (workflowResult?.state) fs.rmSync(workflowResult.state, { recursive: true, force: true });
      if (result?.state) fs.rmSync(result.state, { recursive: true, force: true });
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

test('engineering model dispatch rejects retries and missing credentials without egress', async () => {
  const { createEngineeringModel, validateEngineeringBinding } = require('../tools/cli/lib/engineering-model');
  const binding = YAML.parse(
    fs.readFileSync(path.join(__dirname, '../.agents/activation/provider-bindings/openai-compatible.example.yaml'), 'utf8'),
  );
  binding.transport.max_attempts = 2;
  assert.throws(() => validateEngineeringBinding(binding), /max_attempts: 1/);
  binding.transport.max_attempts = 1;
  const model = createEngineeringModel({
    binding,
    deadline: Date.now() + 10_000,
    environment: {},
    fetchImpl: () => {
      throw new Error('egress must remain unreachable');
    },
  });
  try {
    await assert.rejects(model.connect(), /credential is unavailable/);
  } finally {
    await model.close();
  }
  await assert.rejects(runEngineeringTask({ taskContract: 'unused', scriptedResponses: 'unused', binding: 'unused' }), /exactly one/);
});

async function runBoundProof({ responseModel, omitModel = false, baseUrl = 'https://engineering.fixture.invalid/v1', local = false }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-engineering-proof-'));
  const secret = `fixture-${randomUUID()}`;
  let created;
  try {
    const example = structuredClone(createEngineeringExample('addition'));
    fs.writeFileSync(path.join(directory, 'task.json'), JSON.stringify(example.contract));
    const binding = YAML.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          '../.agents/activation/provider-bindings',
          local ? 'ollama-local.example.yaml' : 'openai-compatible.example.yaml',
        ),
        'utf8',
      ),
    );
    const controlManifest = local
      ? JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/evolution/w3/model-bindings/ollama-local.manifest.json'), 'utf8'))
      : undefined;
    binding.provider.base_url = baseUrl;
    binding.provider.limits = { context_tokens: 1_000_000, max_output_tokens: 65_536, max_parallel_requests: 1 };
    binding.provider.secret_refs[0].source_ref = 'env://ENGINEERING_FIXTURE_CREDENTIAL';
    binding.transport.max_attempts = 1;
    fs.writeFileSync(path.join(directory, 'binding.yaml'), YAML.stringify(binding));
    let calls = 0;
    const fetchImpl = async () => {
      const next = example.responses[calls++];
      const model = omitModel ? undefined : (responseModel ?? binding.provider.model);
      return next && next.name !== 'fixture.submit'
        ? response([
            {
              model,
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `call:proof:${calls}`,
                        function: { name: toWireToolName(next.name), arguments: JSON.stringify(next.input) },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            },
          ])
        : response([
            { model, choices: [{ delta: { content: 'implemented' }, finish_reason: 'stop' }] },
            { model, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } },
          ]);
    };
    created = await runEngineeringTask({
      taskContract: path.join(directory, 'task.json'),
      binding: path.join(directory, 'binding.yaml'),
      createOnly: true,
      environment: {},
      fetchImpl: () => {
        throw new Error('create-only cannot invoke a provider');
      },
    });
    const result = await inspectEngineeringTask({
      state: created.state,
      action: 'resume',
      expectedSequence: created.current_sequence,
      environment: { ENGINEERING_FIXTURE_CREDENTIAL: secret },
      fetchImpl,
      controlManifest,
    });
    const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
    const secretBytes = Buffer.from(secret);
    const scan = (directoryPath) =>
      fs
        .readdirSync(directoryPath, { withFileTypes: true })
        .some((entry) =>
          entry.isDirectory()
            ? scan(path.join(directoryPath, entry.name))
            : entry.isFile() && fs.readFileSync(path.join(directoryPath, entry.name)).includes(secretBytes),
        );
    return {
      result,
      evidence,
      secret,
      leaked: scan(result.state) || JSON.stringify(evidence).includes(secret) || JSON.stringify(result).includes(secret),
      calls: () => calls,
      state: result.state,
      directory,
      binding,
    };
  } catch (error) {
    if (created?.state) fs.rmSync(created.state, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

test('engineering binding evidence carries the adapter credential proof and never the secret', async () => {
  const run = await runBoundProof({});
  try {
    assert.equal(run.result.task_result, 'approved', JSON.stringify(run.result));
    const proof = run.evidence.verification.evidence.provider_proof;
    const expected = require('../tools/cli/lib/engineering-model').credentialFingerprint(run.secret);
    assert.equal(proof.auth_mode, 'credential');
    assert.equal(proof.credential_sha256, expected);
    assert.equal(proof.credential_pool, false);
    assert.equal(proof.fallback, false);
    assert.deepEqual(proof.declared, { origin: 'https://engineering.fixture.invalid', model: run.binding.provider.model });
    assert.deepEqual(proof.observed, { origin: proof.declared.origin, models: [proof.declared.model] });
    assert.equal(proof.credential_source, 'request-header');
    assert.equal(proof.requests_total, run.calls());
    assert.equal(proof.requests_verified, proof.requests_total);
    assert.equal(summarizeProviderProof(run.evidence).verdict, 'pass');
    assert.equal(proof.backend_verified, true);
    assert.equal(JSON.stringify(run.evidence).includes(run.secret), false);
    assert.equal(run.leaked, false);
    // Replay never appends a second proof and returns the same durable record.
    const again = await inspectEngineeringTask({ state: run.state, action: 'evidence' });
    assert.deepEqual(again.verification.evidence.provider_proof, proof);
    assert.deepEqual(await inspectEngineeringTask({ state: run.state }), run.result);
    // A restarted adapter instance starts from zero: the durable proof is never duplicated or inflated by a resume.
    const { createEngineeringModel } = require('../tools/cli/lib/engineering-model');
    const second = createEngineeringModel({
      binding: run.binding,
      deadline: Date.now() + 10_000,
      environment: { ENGINEERING_FIXTURE_CREDENTIAL: run.secret },
      fetchImpl: () => {
        throw new Error('no egress');
      },
    });
    try {
      await second.connect();
      const fresh = second.proof();
      assert.equal(fresh.requests_total, 0);
      assert.equal(fresh.auth_mode, 'not_observed');
      assert.equal(fresh.backend_verified, false);
      assert.equal(Object.hasOwn(fresh, 'credential_sha256'), false);
    } finally {
      await second.close();
    }
  } finally {
    fs.rmSync(run.state, { recursive: true, force: true });
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test('engineering binding refuses a response from a model other than the declared one', async () => {
  await assert.rejects(runBoundProof({ responseModel: 'undeclared-model-2099' }), { code: 'CONTROL_PROVIDER_BACKEND_DIVERGED' });
});

for (const [label, baseUrl] of [
  ['the cluster address', 'http://ollama-shared.platform-shared-dev.svc.cluster.local:11434/v1'],
  ['a tunnel address', 'http://203.0.113.7:18080/v1'],
]) {
  test(`engineering binding whose manifest declares route local records local authentication over ${label}`, async () => {
    const run = await runBoundProof({ local: true, baseUrl });
    try {
      const proof = run.evidence.verification.evidence?.provider_proof;
      assert.equal(proof?.auth_mode, 'local', JSON.stringify(run.result));
      assert.equal(Object.hasOwn(proof, 'credential_sha256'), false);
      assert.equal(run.leaked, false);
    } finally {
      fs.rmSync(run.state, { recursive: true, force: true });
      fs.rmSync(run.directory, { recursive: true, force: true });
    }
  });
}

test('a loopback address alone does not make a binding local', async () => {
  const run = await runBoundProof({ baseUrl: 'http://127.0.0.1:11434/v1' });
  try {
    const proof = run.evidence.verification.evidence.provider_proof;
    assert.equal(proof.auth_mode, 'credential');
    assert.equal(typeof proof.credential_sha256, 'string');
  } finally {
    fs.rmSync(run.state, { recursive: true, force: true });
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test('a response that names no model is recorded as not backend-verified, explicitly', async () => {
  const run = await runBoundProof({ omitModel: true });
  try {
    const proof = run.evidence.verification.evidence.provider_proof;
    assert.equal(proof.backend_verified, false);
    assert.deepEqual(proof.observed.models, []);
    assert.equal(proof.requests_verified, 0);
    assert.equal(summarizeProviderProof(run.evidence).verdict, 'unknown');
  } finally {
    fs.rmSync(run.state, { recursive: true, force: true });
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test('a manifest of another binding is refused', () => {
  const { createEngineeringModel } = require('../tools/cli/lib/engineering-model');
  const binding = YAML.parse(
    fs.readFileSync(path.join(__dirname, '../.agents/activation/provider-bindings/openai-compatible.example.yaml'), 'utf8'),
  );
  binding.transport.max_attempts = 1;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../docs/evolution/w3/model-bindings/ollama-local.manifest.json'), 'utf8'),
  );
  assert.throws(() => createEngineeringModel({ binding, manifest, deadline: Date.now() + 1000, environment: {} }), {
    code: 'CONTROL_PROVIDER_BINDING_DRIFT',
  });
});

function sse(frames) {
  return Buffer.from(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n');
}

function observerHarness(chunksFor, { secret = `observer-${randomUUID()}` } = {}) {
  const { createProviderObserver } = require('../tools/cli/lib/engineering-model');
  const declared = { origin: 'https://observer.fixture.invalid', model: 'declared-model' };
  let call = 0;
  const upstream = async () => ({ status: 200, ok: true, body: chunksFor(call++) });
  return {
    secret,
    declared,
    observer: createProviderObserver({ declared, secret, upstreamFetch: upstream }),
    headers: (value = secret) => ({ authorization: `Bearer ${value}` }),
    url: `${declared.origin}/v1/chat/completions`,
  };
}

async function drain(response) {
  const out = [];
  for await (const chunk of response.body) out.push(Buffer.from(chunk));
  return Buffer.concat(out);
}

test('every response is observed: a right model first and a divergent one later fails closed', async () => {
  const frames = (model) => sse([{ model, choices: [] }]);
  const harness = observerHarness(async function* (call) {
    yield frames(call === 0 ? 'declared-model' : 'EVIL-other-model');
  });
  await drain(await harness.observer.fetch(harness.url, { headers: harness.headers() }));
  assert.equal(harness.observer.proof().backend_verified, true);
  await assert.rejects(async () => drain(await harness.observer.fetch(harness.url, { headers: harness.headers() })), {
    code: 'CONTROL_PROVIDER_BACKEND_DIVERGED',
  });
  assert.throws(() => harness.observer.proof(), { code: 'CONTROL_PROVIDER_BACKEND_DIVERGED' });
});

test('a second frame that diverges inside one response fails closed', async () => {
  const harness = observerHarness(async function* () {
    yield sse([{ model: 'declared-model' }, { model: 'EVIL-other-model' }]);
  });
  await assert.rejects(async () => drain(await harness.observer.fetch(harness.url, { headers: harness.headers() })), {
    code: 'CONTROL_PROVIDER_BACKEND_DIVERGED',
  });
});

for (const [label, wrap] of [
  ['Buffer', (bytes) => Buffer.from(bytes)],
  ['Uint8Array', (bytes) => new Uint8Array(bytes)],
]) {
  test(`${label} chunks split inside an SSE frame and inside a multibyte character are observed and delivered unchanged`, async () => {
    const payload = Buffer.from(
      `data: ${JSON.stringify({ model: 'declared-model', choices: [{ delta: { content: 'caf\u00E9 \u{1F600}' } }] })}\n\ndata: [DONE]\n\n`,
    );
    const emoji = payload.indexOf(Buffer.from('\u{1F600}'));
    const cuts = [10, emoji + 2, payload.length - 3];
    const parts = [
      payload.subarray(0, cuts[0]),
      payload.subarray(cuts[0], cuts[1]),
      payload.subarray(cuts[1], cuts[2]),
      payload.subarray(cuts[2]),
    ];
    const harness = observerHarness(async function* () {
      for (const part of parts) yield wrap(part);
    });
    const delivered = await drain(await harness.observer.fetch(harness.url, { headers: harness.headers() }));
    assert.deepEqual(delivered, payload);
    const proof = harness.observer.proof();
    assert.deepEqual(proof.observed.models, ['declared-model']);
    assert.equal(proof.backend_verified, true);
  });
}

test('responses without a model are never backend-verified', async () => {
  const harness = observerHarness(async function* () {
    yield sse([{ choices: [] }]);
  });
  await drain(await harness.observer.fetch(harness.url, { headers: harness.headers() }));
  const proof = harness.observer.proof();
  assert.equal(proof.backend_verified, false);
  assert.equal(proof.requests_total, 1);
  assert.equal(proof.requests_verified, 0);
  assert.equal(summarizeProviderProof({ provider_proof: proof }).verdict, 'unknown');
});

test('one unobserved response among observed ones keeps the proof false', async () => {
  const harness = observerHarness(async function* (call) {
    yield sse(call === 1 ? [{ choices: [] }] : [{ model: 'declared-model' }]);
  });
  for (let index = 0; index < 2; index += 1) await drain(await harness.observer.fetch(harness.url, { headers: harness.headers() }));
  const proof = harness.observer.proof();
  assert.equal(proof.requests_verified, 1);
  assert.equal(proof.backend_verified, false);
});

test('the credential hash is taken from the Authorization header actually sent', async () => {
  const { credentialFingerprint } = require('../tools/cli/lib/engineering-model');
  const body = async function* () {
    yield sse([{ model: 'declared-model' }]);
  };
  for (const make of [
    (value) => ({ authorization: value }),
    (value) => new Headers({ Authorization: value }),
    (value) => [['Authorization', value]],
  ]) {
    const harness = observerHarness(body);
    await drain(await harness.observer.fetch(harness.url, { headers: make(`Bearer ${harness.secret}`) }));
    const proof = harness.observer.proof();
    assert.equal(proof.credential_sha256, credentialFingerprint(harness.secret));
    assert.equal(proof.credential_source, 'request-header');
    const other = observerHarness(body);
    await assert.rejects(async () => other.observer.fetch(other.url, { headers: make('Bearer a-different-credential') }), {
      code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED',
    });
    assert.throws(() => other.observer.proof(), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
  }
  const missing = observerHarness(body);
  await assert.rejects(async () => missing.observer.fetch(missing.url, { headers: {} }), { code: 'CONTROL_PROVIDER_IDENTITY_UNVERIFIED' });
});

test('a consumer that stops reading stops the tee and releases the upstream', async () => {
  let released = false;
  const harness = observerHarness(async function* () {
    try {
      yield sse([{ model: 'declared-model' }]);
      yield Buffer.from('data: {"model":"declared-model"}\n\n');
      yield Buffer.from('never read\n');
    } finally {
      released = true;
    }
  });
  const response = await harness.observer.fetch(harness.url, { headers: harness.headers() });
  for await (const chunk of response.body) {
    assert.ok(chunk.length > 0);
    break;
  }
  assert.equal(released, true);
  assert.equal(harness.observer.proof().requests_total, 1);
});
