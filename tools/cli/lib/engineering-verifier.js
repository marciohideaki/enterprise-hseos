'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { canonicalJson } = require('../../../packages/agent-session-store');
const { executeIsolatedCommand } = require('../../../packages/agent-isolation-attestation/executor');

const CODE_SHA256 = createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const DEFINITIONS = Object.freeze({
  'verifier://fixtures/integer-addition-v1': {
    source: 'Implement integer addition in a disposable JavaScript fixture.',
    requirement: 'Return the sum of two integers.',
    acceptance: 'The protected verifier confirms positive, negative and zero operands.',
    runtime: 'node',
    file: 'add.js',
    cases: [
      [2, 3],
      [-7, 4],
      [0, 0],
      [13, -13],
    ],
    expected: [5, -3, 0, 0],
  },
  'verifier://fixtures/python-clamp-v1': {
    source: 'Correct clamping of a number to inclusive lower and upper bounds.',
    requirement: 'Return min(high, max(low, value)).',
    acceptance: 'The protected verifier confirms below, above, inside and boundary values.',
    runtime: 'python',
    file: 'clamp.py',
    cases: [
      [-3, 0, 10],
      [12, 0, 10],
      [5, 0, 10],
      [0, 0, 10],
    ],
    expected: [0, 10, 5, 0],
  },
  'verifier://fixtures/node-unique-v1': {
    source: 'Fix duplicate removal while preserving zero values and order.',
    requirement: 'Return unique input values in their original order, including zero.',
    acceptance: 'The protected verifier confirms duplicates and zero preservation.',
    runtime: 'node',
    file: 'unique.js',
    cases: [[[0, 1, 0, 2, 1]]],
    expected: [[0, 1, 2]],
  },
});

function engineeringVerifier(reference) {
  const definition = DEFINITIONS[reference];
  if (!definition) throw new Error('Unknown protected engineering verifier');
  const serialized = canonicalJson(definition);
  return { definition: JSON.parse(serialized), sha256: createHash('sha256').update(CODE_SHA256).update(serialized).digest('hex') };
}

function attestEngineeringVerifier(contract) {
  const verifier = engineeringVerifier(contract.verifier.reference);
  const { definition, sha256 } = verifier;
  if (
    sha256 !== contract.verifier.sha256 ||
    !contract.scope.read.includes(definition.file) ||
    canonicalJson(contract.sources) !==
      canonicalJson([
        {
          id: 'spec',
          kind: 'specification',
          content: definition.source,
          sha256: createHash('sha256').update(definition.source).digest('hex'),
        },
      ]) ||
    canonicalJson(contract.requirements) !== canonicalJson([{ id: 'r1', description: definition.requirement, source_ids: ['spec'] }]) ||
    canonicalJson(contract.acceptance) !== canonicalJson([{ id: 'a1', description: definition.acceptance, requirement_ids: ['r1'] }])
  ) {
    throw new Error('Protected verifier does not cover the declared task criteria');
  }
  return verifier;
}

async function verifyEngineeringTask({ contract, policy, deadline, signal }) {
  const { definition, sha256 } = attestEngineeringVerifier(contract);
  // The driver executes untrusted artifacts only inside the executor. Expected
  // values and the comparison stay in this trusted process, outside that driver.
  const script =
    definition.runtime === 'node'
      ? `const fn=require('./'+process.argv[1]);console.log(JSON.stringify(JSON.parse(process.argv[2]).map(args=>fn(...args))));`
      : `import json,runpy,sys\nfn=runpy.run_path(sys.argv[1])['clamp']\nprint(json.dumps([fn(*args) for args in json.loads(sys.argv[2])]))`;
  const remaining = deadline - Date.now();
  if (remaining < 1) return { approved: false, reason: 'budget-exhausted', verifier_sha256: sha256 };
  const result = await executeIsolatedCommand({
    policy,
    command:
      definition.runtime === 'node'
        ? ['/usr/bin/node', '-e', script, definition.file, JSON.stringify(definition.cases)]
        : ['/usr/bin/python3', '-I', '-B', '-c', script, definition.file, JSON.stringify(definition.cases)],
    timeout_ms: Math.min(remaining, 5000),
    max_output_bytes: contract.max_output_bytes,
    signal,
  });
  let approved = false;
  try {
    approved = result.status === 'succeeded' && canonicalJson(JSON.parse(result.stdout)) === canonicalJson(definition.expected);
  } catch {
    /* A process exit or textual claim cannot approve an artifact. */
  }
  return {
    approved,
    reason: approved ? 'criteria-satisfied' : 'criteria-not-satisfied',
    verifier_sha256: sha256,
    isolation_digest: result.policy_digest,
    workspace_access: result.workspace_access,
    descendants_terminated: result.descendants_terminated,
  };
}

module.exports = { engineeringVerifier, attestEngineeringVerifier, verifyEngineeringTask };
