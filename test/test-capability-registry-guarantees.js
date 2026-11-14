// Structural compatibility with the published ECP 0.6.1 catalog. Profile
// semantics remain at ECP; discovery must preserve the declarations verbatim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const { validateCapabilityRegistry, resolveCapability } = require('../tools/cli/lib/capability-registry');

const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ecp-registry/ai-guarantees-0.6.1.json'), 'utf8'));

test('published AI declarations survive validation and node/dotnet discovery unchanged', () => {
  const document = fixture();
  const original = JSON.stringify(document);
  assert.equal(validateCapabilityRegistry(document), document);
  assert.equal(JSON.stringify(document), original, 'validation must not strip metadata');
  const capability = document.capabilities[0];
  for (const stack of ['node', 'dotnet']) {
    const found = resolveCapability(document, 'ai.provider-access', { stacks: [stack] })[0];
    assert.equal(found.implementations.length, 1);
    assert.deepEqual(found.implementations[0].operations, ['generate']);
    assert.deepEqual(found.implementations[0].guarantees, [
      { operation: 'generate', billing_route: 'connection_pinned', cancellation: 'propagated', inference_retry: 'never_automatic' },
    ]);
    assert.deepEqual(
      found.implementations[0],
      capability.implementations.find((item) => item.stack === stack),
    );
  }
});

test('legacy catalogs without the optional pair remain valid without invented guarantees', () => {
  const document = fixture();
  for (const implementation of document.capabilities[0].implementations) {
    delete implementation.operations;
    delete implementation.guarantees;
  }
  validateCapabilityRegistry(document);
  assert.equal(resolveCapability(document, 'ai.provider-access', { stacks: ['node'] })[0].implementations[0].guarantees, undefined);
});

test('CLI JSON retains the canonical declarations rather than projecting them away', () => {
  const { runCapabilityCheck } = require('../tools/cli/commands/capability-check');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-guarantee-cli-'));
  try {
    fs.mkdirSync(path.join(directory, '.hseos/config'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'registry.json'), JSON.stringify(fixture()));
    for (const stack of ['node', 'dotnet']) {
      fs.writeFileSync(
        path.join(directory, '.hseos/config/platform-bindings.yaml'),
        JSON.stringify({ schema_version: '1.0.0', mode: 'platform', stacks: [stack], registry: { source: 'path', path: 'registry.json' } }),
      );
      const report = runCapabilityCheck('ai.provider-access', {
        directory,
        env: { HOME: directory, XDG_CONFIG_HOME: directory },
        runtimeRoot: path.join(__dirname, '..'),
      }).report;
      const implementation = report.results[0].implementations[0];
      const canonical = fixture().capabilities[0].implementations.find((item) => item.stack === stack);
      assert.deepEqual(implementation.operations, canonical.operations);
      assert.deepEqual(implementation.guarantees, canonical.guarantees);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('malformed declarations, unmatched operations and unrelated unknown implementation fields fail closed', () => {
  for (const mutate of [
    (item) => {
      item.operations = [];
    },
    (item) => {
      item.operations = ['*'];
    },
    (item) => {
      item.operations = ['Generate'];
    },
    (item) => {
      item.operations = ['generate', 'generate'];
    },
    (item) => {
      delete item.operations;
    },
    (item) => {
      delete item.guarantees;
    },
    (item) => {
      item.guarantees = [];
    },
    (item) => {
      item.guarantees = [null];
    },
    (item) => {
      delete item.guarantees[0].operation;
    },
    (item) => {
      item.guarantees[0].operation = '*';
    },
    (item) => {
      item.guarantees[0].operation = 'inspect';
    },
    (item) => {
      item.guarantees.push({ ...item.guarantees[0] });
    },
    (item) => {
      item.operations.push('inspect');
    },
    (item) => {
      item.guarantees[0].cancellation = true;
    },
    (item) => {
      item.guarantees[0].billing_route = { pinned: true };
    },
    (item) => {
      item.guarantees[0].inference_retry = 'NEVER';
    },
    (item) => {
      item.unrecognized = 'must-not-be-stripped';
    },
  ]) {
    const document = fixture();
    mutate(document.capabilities[0].implementations[0]);
    assert.throws(() => validateCapabilityRegistry(document), /Invalid capability registry/);
  }
});
