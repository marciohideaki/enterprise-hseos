'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ESLint } = require('eslint');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');

test('every authored package source is linted with correctness rules enabled', async () => {
  const eslint = new ESLint({ cwd: root });
  const files = fs
    .readdirSync(path.join(root, 'packages'), { recursive: true })
    .filter((name) => /\.(?:js|cjs|mjs)$/.test(name) && !name.split(path.sep).includes('node_modules'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const filePath = path.join(root, 'packages', name);
    assert.equal(await eslint.isPathIgnored(filePath), false, name);
    const config = await eslint.calculateConfigForFile(filePath);
    for (const rule of ['no-undef', 'no-unreachable', 'no-unsafe-finally']) {
      assert.equal(config.rules[rule][0], 2, `${name}: ${rule}`);
    }
  }
  const [result] = await eslint.lintText('missingKernelAuthority();\n', {
    filePath: path.join(root, 'packages', 'agent-runtime', 'quality-probe.js'),
  });
  assert.ok(result.messages.some((message) => message.ruleId === 'no-undef'));
});

test('coverage counts unexecuted critical files and enforces per-file 90/80', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.c8-kernel.json'), 'utf8'));
  assert.equal(config.all, true);
  assert.equal(config['check-coverage'], true);
  assert.equal(config['per-file'], true);
  assert.ok(config.lines >= 90);
  assert.ok(config.branches >= 80);
  for (const entry of [
    'packages/agent-runtime/**/*.js',
    'packages/agent-session-store/**/*.js',
    'packages/agent-policy-lattice/**/*.js',
    'packages/agent-orchestration/**/*.js',
    'tools/cli/lib/engineering-*.js',
    'tools/cli/lib/job-materialization.js',
    'tools/cli/lib/job-dispatch.js',
    'tools/mcp-project-state/lib/execution-ledger-schema.js',
    'tools/cli/lib/provider-egress-broker.js',
    'packages/runtime-providers/codex-acp-peer.js',
    'packages/runtime-providers/codex-acp-composition.js',
    'packages/runtime-providers/codex-acp-launcher.js',
    'tools/cli/lib/provider-acp-adapter.js',
    'tools/cli/lib/provider-acp-worker.js',
  ])
    assert.ok(config.include.includes(entry), entry);
});

test('comparison inventory covers every source family and points to real sources and tests', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/evolution/requirements.json'), 'utf8'));
  const source = fs.readFileSync(path.join(root, inventory.source.path));
  assert.equal(createHash('sha256').update(source).digest('hex'), inventory.source.sha256);
  const rows = source
    .toString('utf8')
    .split('\n')
    .filter((line) => /^\| \d+\./.test(line));
  assert.equal(rows.length, 27);
  assert.deepEqual(
    inventory.families.map((family) => family.id),
    Array.from({ length: 27 }, (_, index) => `F${String(index + 1).padStart(2, '0')}`),
  );
  for (const [index, family] of inventory.families.entries()) {
    assert.equal(
      family.name,
      rows[index]
        .split('|')[1]
        .trim()
        .replace(/^\d+\. /, ''),
    );
    assert.ok(family.gap.length > 0);
    assert.ok(family.requirements.length > 0);
    assert.ok(family.requirements.every((requirement) => requirement.acceptance && requirement.verification));
    assert.ok(family.implementation.length > 0 && family.tests.length > 0);
    for (const reference of [...family.implementation, ...family.tests]) {
      const resolved = fs.realpathSync(path.resolve(root, reference));
      assert.ok(resolved.startsWith(`${root}${path.sep}`), reference);
      assert.ok(fs.statSync(resolved).isFile(), reference);
    }
  }
});
