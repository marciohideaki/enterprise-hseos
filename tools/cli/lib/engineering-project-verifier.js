'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { canonicalJson } = require('../../../packages/agent-session-store');
const { executeIsolatedCommand } = require('../../../packages/agent-isolation-attestation/executor');
const legacy = require('./engineering-verifier');

const CODE_SHA256 = createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const PROJECT_VERIFIERS = Object.freeze({
  'verifier://project/node-module-v1': Object.freeze({ version: 1, runtime: 'node', comparison: 'json-equality' }),
  'verifier://project/python-module-v1': Object.freeze({ version: 1, runtime: 'python', comparison: 'json-equality' }),
  'verifier://project/web-content-v1': Object.freeze({ version: 1, runtime: 'node', comparison: 'content-includes' }),
});

function executableDigest(filename) {
  const fd = fs.openSync(fs.realpathSync(filename), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(65_536);
    let length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}
const RUNTIMES = Object.freeze({ node: executableDigest(process.execPath), python: executableDigest('/usr/bin/python3') });

function declaredCommandArgv(contract, declared) {
  return declared.runtime === 'node'
    ? [
        '/usr/bin/node',
        ...(contract.schema_version === 2 ? ['--experimental-strip-types'] : []),
        `./${declared.entrypoint}`,
        ...declared.args,
      ]
    : ['/usr/bin/python3', '-I', '-B', `./${declared.entrypoint}`, ...declared.args];
}

function projectVerifierDigest(contract) {
  const { sha256: _pin, ...verifier } = contract.verifier;
  const hash = createHash('sha256')
    .update(CODE_SHA256)
    .update(RUNTIMES[PROJECT_VERIFIERS[verifier.reference]?.runtime] || 'unsupported')
    .update(canonicalJson({ verifier, sources: contract.sources, requirements: contract.requirements, acceptance: contract.acceptance }));
  // Acceptance commands bind the exact declared argv; contracts without them keep their original digest.
  if (verifier.command_checks)
    hash.update(
      canonicalJson(verifier.command_checks.map((item) => contract.commands.find((entry) => entry.id === item.command_id) || null)),
    );
  return hash.digest('hex');
}

function attestEngineeringVerifier(contract) {
  if (contract.schema_version === 1) return legacy.attestEngineeringVerifier(contract);
  const definition = PROJECT_VERIFIERS[contract.verifier.reference];
  if (
    !definition ||
    projectVerifierDigest(contract) !== contract.verifier.sha256 ||
    contract.verifier.checks.some((check) => !contract.scope.read.includes(check.path)) ||
    (contract.verifier.command_checks || []).some((item) => !contract.commands.some((entry) => entry.id === item.command_id))
  )
    throw new Error('Project verifier does not match pinned acceptance');
  if (
    definition.comparison === 'content-includes' &&
    contract.verifier.checks.some((check) => typeof check.expected !== 'string' || check.expected.length === 0)
  )
    throw new Error('Web content acceptance must be nonempty text');
  return { definition, sha256: contract.verifier.sha256 };
}

async function verifyEngineeringTask(options) {
  const { contract, policy, deadline, signal, files, runCommandChecks = true } = options;
  if (contract.schema_version === 1) return legacy.verifyEngineeringTask(options);
  const { definition, sha256 } = attestEngineeringVerifier(contract);
  const declaredChecks = contract.verifier.command_checks || [];
  // Protected files must still match the content pinned at preparation, otherwise nothing is executed.
  if (declaredChecks.length > 0) {
    const pinned = new Map(contract.initial_files.map((item) => [item.path, item.sha256]));
    const observed = new Map((files || []).map((item) => [item.path, item.sha256]));
    const intact = (contract.verifier.protected_paths || []).every(
      (entry) => pinned.has(entry) && observed.get(entry) === pinned.get(entry),
    );
    if (!files || !intact) return { approved: false, reason: 'protected-files-changed', verifier_sha256: sha256 };
    // Reconciliation only inspects prerequisites and never approves, so it does not replay acceptance commands.
    if (!runCommandChecks) return { approved: false, reason: 'command-checks-not-run', verifier_sha256: sha256 };
  }
  const probes = contract.verifier.checks.map(({ expected: _expected, ...probe }) => probe);
  const script =
    definition.runtime === 'python'
      ? "import json,runpy,sys,os\nsys.path.insert(0,os.getcwd())\nchecks=json.loads(sys.argv[1])\nprint(json.dumps([runpy.run_path(c['path'])[c['export_name']](*c['args']) for c in checks]))"
      : definition.comparison === 'content-includes'
        ? "const fs=require('node:fs');console.log(JSON.stringify(JSON.parse(process.argv[1]).map(c=>fs.readFileSync(c.path,'utf8'))));"
        : "(async()=>{const checks=JSON.parse(process.argv[1]);const out=[];for(const c of checks){const m=require('./'+c.path);const fn=c.export_name==='default'?(m.default||m):m[c.export_name];out.push(await fn(...c.args));}console.log(JSON.stringify(out));})().catch(()=>process.exitCode=1);";
  const remaining = deadline - Date.now();
  if (remaining < 1) return { approved: false, reason: 'budget-exhausted', verifier_sha256: sha256 };
  const result = await executeIsolatedCommand({
    policy,
    host_node: definition.runtime === 'node',
    command:
      definition.runtime === 'python'
        ? ['/usr/bin/python3', '-I', '-B', '-c', script, JSON.stringify(probes)]
        : ['/usr/bin/node', '--experimental-strip-types', '-e', script, JSON.stringify(probes)],
    timeout_ms: Math.min(remaining, 10_000),
    max_output_bytes: contract.max_output_bytes,
    signal,
  });
  let approved = false;
  try {
    const actual = JSON.parse(result.stdout);
    approved =
      result.status === 'succeeded' &&
      result.descendants_terminated &&
      Array.isArray(actual) &&
      actual.length === probes.length &&
      contract.verifier.checks.every((check, index) =>
        definition.comparison === 'content-includes'
          ? typeof actual[index] === 'string' && actual[index].includes(check.expected)
          : canonicalJson(actual[index]) === canonicalJson(check.expected),
      );
  } catch {
    /* Invalid or excess output cannot satisfy protected acceptance. */
  }
  const commandResults = [];
  let evidence = result;
  for (const item of approved ? declaredChecks : []) {
    const left = deadline - Date.now();
    const declared = contract.commands.find((entry) => entry.id === item.command_id);
    let outcome = { status: 'budget_exhausted', exit_code: null };
    if (left >= 1) {
      try {
        evidence = await executeIsolatedCommand({
          policy,
          host_node: declared.runtime === 'node',
          command: declaredCommandArgv(contract, declared),
          timeout_ms: Math.min(left, item.timeout_ms || 300_000),
          max_output_bytes: contract.max_output_bytes,
          signal,
        });
        outcome = { status: evidence.status, exit_code: evidence.exit_code ?? null };
        if (!evidence.descendants_terminated) outcome.status = 'descendants_not_terminated';
      } catch {
        outcome = { status: 'executor_error', exit_code: null };
      }
    }
    commandResults.push({ command_id: item.command_id, ...outcome });
    // Only a clean zero exit satisfies an acceptance command; failure, signal, timeout or a missing binary reject.
    if (outcome.status !== 'succeeded' || outcome.exit_code !== 0) approved = false;
  }
  return {
    approved,
    reason: approved ? 'criteria-satisfied' : 'criteria-not-satisfied',
    verifier_sha256: sha256,
    isolation_digest: evidence.policy_digest || result.policy_digest,
    workspace_access: evidence.workspace_access || result.workspace_access,
    descendants_terminated: result.descendants_terminated && evidence.descendants_terminated !== false,
    ...(declaredChecks.length > 0 ? { command_checks: commandResults } : {}),
  };
}

module.exports = { declaredCommandArgv, PROJECT_VERIFIERS, projectVerifierDigest, attestEngineeringVerifier, verifyEngineeringTask };
