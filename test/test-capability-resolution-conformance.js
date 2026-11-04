'use strict';

/**
 * ECP resolution v1.1 conformance (Decision 0011): every vector of the vendored ECP suite against the HSEOS
 * resolver and the capability-check verdict rules, with the stack vocabulary; the v1 vectors again without one.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { buildResult } = require('../tools/cli/commands/capability-check');
const { createVocabulary, resolveCapability } = require('../tools/cli/lib/capability-registry');

const DIRECTORY = path.join(__dirname, 'fixtures', 'ecp-resolution-v1.1');
const PINNED_SHA256 = {
  'cases.json': 'caa61d3479da8311c58fd9c4962b567fddfcf4fba2b9cf35074946123199df33',
  'registry.fixture.json': '91630bebdb5db1da228bebb2e3c2ae1c7b3a9434f9264a35433a744e30342cab',
  'stacks.json': '3493ab2b549d3b91fde521c8be6df4865819dbe5f27e12c358ccd072b81cfb03',
};

const read = (name) => fs.readFileSync(path.join(DIRECTORY, name));
const json = (name) => JSON.parse(read(name).toString('utf8'));
const registry = json('registry.fixture.json');
const cases = json('cases.json');
const vocabulary = createVocabulary(json('stacks.json'));

const isV11 = (vector) => vector.expect.listed_packages !== undefined || vector.expect.missing_targets !== undefined;

/** Runs one vector through the HSEOS pipeline as `hseos capability-check` does in platform mode without overrides. */
function run(vector, vocab) {
  const stacks = Array.isArray(vector.stacks) ? vector.stacks : [];
  const query = vector.query.trim();
  const entries = resolveCapability(registry, query, { stacks, vocabulary: vocab });
  const limited = vector.limit === undefined ? entries : entries.slice(0, vector.limit); // `limit` is an ECP-only extension
  return limited.map((entry) =>
    buildResult(entry, { mode: 'platform', bindings: { overrides: [] }, stacks, queryLower: query.toLowerCase(), vocabulary: vocab }),
  );
}

/** Mirrors the projection of the ECP test suite (`project` in tests/test_resolution.py). */
function project(vector, results) {
  const got = {
    names: results.map((result) => result.capability),
    matched_by: results.map((result) => result.matched_by),
    verdicts: results.map((result) => result.verdict),
    other_stacks: results.map((result) => result.other_stacks),
  };
  if (vector.expect.chosen_packages !== undefined) {
    got.chosen_packages = results.map((result) => {
      const chosen = /^consume (.+) \((?:experimental|stable)\)(?: \(advisory\))?$/.exec(result.verdict_text);
      return chosen ? chosen[1] : null;
    });
  }
  if (vector.expect.listed_packages !== undefined) {
    got.listed_packages = results.map((result) => result.implementations.map((implementation) => implementation.package));
  }
  if (vector.expect.missing_targets !== undefined) got.missing_targets = results.map((result) => result.missing_targets);
  return got;
}

test('the vendored files are the pinned ECP copies', () => {
  for (const [name, expected] of Object.entries(PINNED_SHA256)) {
    assert.equal(crypto.createHash('sha256').update(read(name)).digest('hex'), expected, name);
  }
});

test('the suite has 97 vectors: 78 v1 and 19 v1.1, with unique ids', () => {
  assert.equal(cases.length, 97);
  assert.equal(new Set(cases.map((vector) => vector.id)).size, 97);
  assert.equal(cases.filter((vector) => !isV11(vector)).length, 78);
  assert.equal(cases.filter(isV11).length, 19);
});

test('all 97 vectors pass with the stack vocabulary', () => {
  const failures = [];
  for (const vector of cases) {
    try {
      assert.deepEqual(project(vector, run(vector, vocabulary)), vector.expect);
    } catch (error) {
      failures.push(`${vector.id}: ${error.message.split('\n').slice(0, 12).join(' | ')}`);
    }
  }
  assert.deepEqual(failures, [], `${cases.length - failures.length}/${cases.length} vectors`);
});

test('the 78 v1 vectors still pass without a vocabulary (resolution v1 rules intact)', () => {
  const failures = [];
  for (const vector of cases.filter((candidate) => !isV11(candidate))) {
    try {
      assert.deepEqual(project(vector, run(vector, null)), vector.expect);
    } catch (error) {
      failures.push(`${vector.id}: ${error.message.split('\n').slice(0, 12).join(' | ')}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('the v1.1 vectors that need the vocabulary fail without one', () => {
  const needsVocabulary = ['stack-alias-ts', 'stack-node-accepts-typescript', 'stack-react-accepts-typescript'];
  for (const id of needsVocabulary) {
    const vector = cases.find((candidate) => candidate.id === id);
    assert.notDeepEqual(project(vector, run(vector, null)), vector.expect, id);
  }
});

const extendOf = (vector) => run(vector, vocabulary).find((result) => result.verdict === 'extend');
const SCAFFOLD_TAIL = 'REPOSITORY=CORE_REPOSITORY IMPL_PATH=IMPLEMENTATION_PATH PACKAGE=PACKAGE_NAME';
const scaffoldCase = (query, stacks) => ({ query, stacks });

test('extend relays the ECP scaffold command with the stack and the missing targets', () => {
  const vector = cases.find(
    (candidate) =>
      candidate.expect.missing_targets &&
      candidate.expect.verdicts &&
      candidate.expect.verdicts[0] === 'extend' &&
      candidate.expect.missing_targets[0].length > 0,
  );
  assert.ok(vector, 'the suite has an extend vector with missing targets');
  const result = run(vector, vocabulary)[0];
  assert.equal(result.verdict, 'extend');
  assert.deepEqual(Object.keys(result.scaffold), ['command', 'stack', 'missing_targets']);
  assert.equal(
    result.scaffold.command,
    `make scaffold-impl CAPABILITY=${result.capability} STACK=${result.scaffold.stack} ${SCAFFOLD_TAIL}`,
  );
  assert.deepEqual(result.scaffold.missing_targets, result.missing_targets);
});

test('extend with an unmet requested stack scaffolds that stack even without targets', () => {
  const results = run(scaffoldCase('cache.typed', ['java']), vocabulary);
  assert.equal(results[0].verdict, 'extend');
  assert.equal(results[0].scaffold.command, `make scaffold-impl CAPABILITY=cache.typed STACK=java ${SCAFFOLD_TAIL}`);
  const identity = run(scaffoldCase('cache.typed', ['java']), null);
  assert.equal(identity[0].scaffold.command, results[0].scaffold.command);
  assert.deepEqual(identity[0].scaffold.missing_targets, []);
});

test('extend has scaffold null when the requested stack is already planned', () => {
  const planned = cases
    .map((vector) => ({ vector, result: extendOf(vector) }))
    .find(
      ({ vector, result }) =>
        result &&
        result.implementations.some((item) => item.status === 'planned') &&
        Array.isArray(vector.stacks) &&
        vector.stacks.length > 0 &&
        result.scaffold === null,
    );
  assert.ok(planned, 'the suite has an extend vector whose requested stack is only planned');
});

test('consume carries no scaffold key', () => {
  for (const vector of cases) {
    for (const result of run(vector, vocabulary)) {
      if (result.verdict !== 'extend') assert.equal('scaffold' in result, false, vector.id);
    }
  }
});

test('the scaffold command is shell-quoted like the ECP', () => {
  const entry = { capability: { name: "weird name's", targets: [], implementations: [] }, implementations: [], matchedBy: 'name' };
  const result = buildResult(entry, { mode: 'platform', bindings: { overrides: [] }, stacks: ['go'], queryLower: 'x', vocabulary });
  assert.equal(result.scaffold.command, `make scaffold-impl CAPABILITY='weird name'"'"'s' STACK=go ${SCAFFOLD_TAIL}`);
});

const ECP_CHECKOUT = process.env.ECP_CHECKOUT;
test(
  'every extend scaffold matches the ECP MCP command for the same registry (set ECP_CHECKOUT to an ECP develop checkout)',
  { skip: ECP_CHECKOUT ? false : 'ECP_CHECKOUT not set' },
  () => {
    const script = [
      'import json, sys',
      'gateways, runtimes, queries = sys.argv[1], sys.argv[2], json.load(sys.stdin)',
      'sys.path.insert(0, gateways); sys.path.insert(0, runtimes)',
      'from ecp_mcp.server import run_tool',
      'out = []',
      'for query, stacks in queries:',
      '    r = run_tool("capability_check", {"query": query, **({"stacks": stacks} if stacks else {})})',
      '    out.append(r.get("scaffold", "absent"))',
      'print(json.dumps(out))',
    ].join('\n');
    const selected = cases.filter((vector) => !('limit' in vector) && extendOf(vector));
    assert.ok(selected.length >= 3, 'enough extend vectors');
    const queries = selected.map((vector) => [vector.query.trim(), Array.isArray(vector.stacks) ? vector.stacks : []]);
    const executed = spawnSync(
      'python3',
      ['-I', '-c', script, path.join(ECP_CHECKOUT, 'gateways', 'python'), path.join(ECP_CHECKOUT, 'runtimes', 'python')],
      {
        input: JSON.stringify(queries),
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ECP_REGISTRY: path.join(DIRECTORY, 'registry.fixture.json') },
      },
    );
    assert.equal(executed.status, 0, executed.stderr);
    const expected = JSON.parse(executed.stdout);
    let compared = 0;
    for (const [index, vector] of selected.entries()) {
      const mine = run(vector, vocabulary)[0];
      // The MCP judges the top result only; compare when the top result is the extend one.
      if (mine.verdict !== 'extend') continue;
      compared += 1;
      assert.deepEqual(mine.scaffold, expected[index], vector.id);
    }
    assert.ok(compared >= 3, `compared ${compared} extend vectors`);
  },
);
