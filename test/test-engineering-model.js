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
                        { index: 0, id: `call:engineering:${calls}`, function: { name: next.name, arguments: JSON.stringify(next.input) } },
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
