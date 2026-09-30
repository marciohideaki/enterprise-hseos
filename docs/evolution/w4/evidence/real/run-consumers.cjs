'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

async function main() {
  const project = process.cwd();
  const packageRoot = path.join(project, 'node_modules', 'hseos');
  const yaml = require(path.join(project, 'node_modules', 'yaml'));
  const { admitExecutionPlugin } = require(path.join(packageRoot, 'tools', 'lib', 'execution-plugin-manifest'));
  const { executeExecutionPlugin, runExecutionPluginConformance } = require(
    path.join(packageRoot, 'tools', 'cli', 'lib', 'execution-plugin-runtime'),
  );
  const registry = yaml.parse(fs.readFileSync(path.join(project, '.agents', 'plugins', 'registry.yaml'), 'utf8'));
  const results = {};
  const inputs = {
    'source-audit': { text: 'alpha\nTODO: beta' },
    'runbook-context': { topic: 'recovery' },
    'policy-verifier': {
      instruction: JSON.stringify({
        artifact_sha256: createHash('sha256').update('alpha\nTODO: beta').digest('hex'),
        line_count: 2,
        max_lines: 2,
      }),
    },
    'source-review-model': {
      messages: [{ role: 'user', content: 'Review the source artifact.' }],
      tools: [{ name: 'source.audit' }],
    },
  };
  for (const entry of registry.plugins) {
    const directory = path.join(project, '.hseos', 'plugins', 'store', entry.execution.manifest_sha256);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'execution.json'), 'utf8'));
    const admission = admitExecutionPlugin(directory, {
      id: manifest.id,
      version: manifest.version,
      kind: manifest.kind,
      manifest_sha256: entry.execution.manifest_sha256,
      allowed_capabilities: manifest.capabilities,
      limits: manifest.limits,
      node_major: Number(process.versions.node.split('.')[0]),
      contract_version: 1,
    });
    const conformance = await runExecutionPluginConformance({ admission });
    assert.equal(conformance.certified, false);
    const result = await executeExecutionPlugin({
      admission,
      request: { request_id: randomUUID(), method: manifest.capabilities[0], input: inputs[entry.id] },
    });
    assert.equal(result.isolation.descendants_terminated, true);
    results[entry.id] = {
      kind: manifest.kind,
      manifest_sha256: entry.execution.manifest_sha256,
      conformance: conformance.diagnostics.length,
      isolation_policy_digest: result.isolation.policy_digest,
      descendants_terminated: result.isolation.descendants_terminated,
      result: result.result,
    };
  }
  assert.equal(results['source-audit'].result.lines, 2);
  assert.equal(results['source-audit'].result.review_markers, 1);
  assert.match(results['runbook-context'].result.items[0].content, /reconcile/);
  const provider = JSON.parse(results['policy-verifier'].result.text);
  assert.equal(provider.accepted, true);
  assert.equal(provider.artifact_sha256, results['source-audit'].result.sha256);
  assert.equal(results['source-review-model'].result.tool_calls[0].name, 'source.audit');
  process.stdout.write(JSON.stringify({ schema_version: 1, package_root: packageRoot, consumers: results }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.message}\n`);
  process.exitCode = 1;
});
