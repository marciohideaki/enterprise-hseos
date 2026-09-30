'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { engineeringVerifier } = require('../cli/lib/engineering-verifier');
const { parseEngineeringTask } = require('../cli/lib/engineering-task-contract');

const EXAMPLES = Object.freeze({
  addition: { reference: 'verifier://fixtures/integer-addition-v1', initial: null, code: 'module.exports = (a, b) => a + b;\n' },
  clamp: {
    reference: 'verifier://fixtures/python-clamp-v1',
    initial: 'def clamp(x, low, high): return x\n',
    code: 'def clamp(x, low, high): return min(high, max(low, x))\n',
  },
  unique: {
    reference: 'verifier://fixtures/node-unique-v1',
    initial: 'module.exports = xs => [...new Set(xs.filter(Boolean))];\n',
    code: 'module.exports = xs => [...new Set(xs)];\n',
  },
});
const sha = (value) => createHash('sha256').update(value).digest('hex');

function createEngineeringExample(name) {
  if (name === 'correction') {
    const example = structuredClone(createEngineeringExample('addition'));
    const bad = 'module.exports = () => 0;\n';
    const digest = sha(bad);
    const { canonicalJson } = require('../../packages/agent-session-store');
    example.contract.max_failed_corrections = 1;
    example.contract.limits.max_tokens = 500_000;
    example.contract.task_id = 'example-correction';
    example.responses = [
      { name: 'engineering.write', input: { ...example.responses[0].input, content: bad } },
      { name: 'fixture.submit', input: {} },
      {
        name: 'engineering.diagnose',
        input: {
          cause: 'Constant output violates the addition requirement.',
          correction: 'Compute the sum using both arguments, then run the authorized check.',
          requirement_ids: ['r1'],
          files_sha256: sha(canonicalJson([{ path: 'add.js', content: bad, sha256: digest }])),
        },
      },
      { name: 'engineering.write', input: { ...example.responses[0].input, expected_sha256: digest } },
      example.responses[1],
    ];
    example.contract = parseEngineeringTask(example.contract);
    return example;
  }
  const example = EXAMPLES[name];
  if (!example) throw new Error('Expected example: addition, clamp, unique, or correction');
  const verifier = engineeringVerifier(example.reference);
  const definition = verifier.definition;
  const contract = parseEngineeringTask({
    schema_version: 1,
    task_id: `example-${name}`,
    execution_profile: 'disposable-engineering-candidate',
    // Synthetic fixture provenance only; this is not a checkout attestation.
    baseline_sha: '0000000000000000000000000000000000000000',
    sources: [{ id: 'spec', kind: 'specification', content: definition.source, sha256: sha(definition.source) }],
    requirements: [{ id: 'r1', description: definition.requirement, source_ids: ['spec'] }],
    acceptance: [{ id: 'a1', description: definition.acceptance, requirement_ids: ['r1'] }],
    initial_files: example.initial === null ? [] : [{ path: definition.file, content: example.initial, sha256: sha(example.initial) }],
    scope: { read: [definition.file], write: [definition.file] },
    commands: [{ id: 'check', runtime: definition.runtime, entrypoint: definition.file, args: [] }],
    limits: { max_turns: 8, max_tokens: 100_000, max_duration_ms: 60_000, max_tool_calls: 8, max_children: 0, max_workflow_steps: 0 },
    max_failed_corrections: 0,
    max_artifact_bytes: 65_536,
    max_output_bytes: 8192,
    verifier: { reference: example.reference, sha256: verifier.sha256, acceptance_ids: ['a1'] },
    rollback: 'discard-disposable-workspace',
  });
  return {
    contract,
    responses: [
      {
        name: 'engineering.write',
        input: { path: definition.file, expected_sha256: example.initial === null ? null : sha(example.initial), content: example.code },
      },
      { name: 'engineering.command', input: { id: 'check' } },
    ],
  };
}

function createEngineeringWorkflowExample() {
  return {
    schema_version: 1,
    workflow_id: 'workflow:engineering-examples',
    max_parallelism: 1,
    limits: { max_turns: 24, max_tokens: 300_000, max_duration_ms: 180_000, max_tool_calls: 24, max_children: 3, max_workflow_steps: 3 },
    tasks: ['addition', 'clamp', 'unique'].map((name, index, names) => {
      const example = createEngineeringExample(name);
      return { id: name, contract: example.contract, responses: example.responses, depends_on: index === 0 ? [] : [names[index - 1]] };
    }),
  };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4)
      throw new Error('Usage: node engineering-task.js <addition|clamp|unique|correction|workflow> <new-directory>');
    const example =
      process.argv[2] === 'workflow' ? { workflow: createEngineeringWorkflowExample() } : createEngineeringExample(process.argv[2]);
    const directory = path.resolve(process.argv[3]);
    fs.mkdirSync(directory, { mode: 0o700 });
    for (const [name, value] of example.workflow
      ? [['workflow', example.workflow]]
      : [
          ['task', example.contract],
          ['responses', example.responses],
        ])
      fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const receipt = example.workflow
      ? { directory, workflow_definition: path.join(directory, 'workflow.json') }
      : { directory, task_contract: path.join(directory, 'task.json'), scripted_responses: path.join(directory, 'responses.json') };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createEngineeringExample, createEngineeringWorkflowExample };
