'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '../scripts/governance/check-shared-infra-drift.js');
const POLICY = path.resolve(__dirname, 'fixtures/shared-infra-drift/policy.md');

const svc = (name, ...ports) => ({ kind: 'Service', metadata: { name }, spec: { ports: ports.map((port) => ({ port })) } });
const sts = (name, replicas) => ({ kind: 'StatefulSet', metadata: { name }, spec: { replicas } });

function run(items) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'drift-'));
  const file = path.join(dir, 'cluster.json');
  fs.writeFileSync(file, JSON.stringify({ items }));
  try {
    return spawnSync(process.execPath, [SCRIPT, '--policy', POLICY, '--cluster-json', file], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const base = [svc('redis-shared', 6379), sts('redis-shared', 1), svc('nats-shared', 4222, 8222), sts('nats-shared', 0)];

test('matching cluster exits 0 without warnings', () => {
  const r = run(base);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /WARN|FAIL/);
});

test('missing Service exits 1', () => {
  const r = run(base.filter((i) => i.metadata.name !== 'redis-shared' || i.kind !== 'Service'));
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL .*redis-shared/);
});

test('extra Service exits 1', () => {
  const r = run([...base, svc('rogue-shared', 1234)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL .*rogue-shared/);
});

test('replica divergence exits 0 with warning', () => {
  const r = run([svc('redis-shared', 6379), sts('redis-shared', 0), svc('nats-shared', 4222, 8222), sts('nats-shared', 0)]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /WARN Replicas for redis-shared/);
});

test('workload with different name warns that replica check was skipped', () => {
  const r = run([svc('redis-shared', 6379), svc('nats-shared', 4222, 8222), sts('nats-shared', 0)]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /WARN No Deployment\/StatefulSet named redis-shared/);
});

test('port divergence exits 0 with warning', () => {
  const r = run([svc('redis-shared', 6380), sts('redis-shared', 1), svc('nats-shared', 4222, 8222), sts('nats-shared', 0)]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /WARN Port mismatch for redis-shared/);
});

test('parsePolicy reads multi-port rows and skips other namespaces', () => {
  const { parsePolicy } = require(SCRIPT);
  const rows = parsePolicy(fs.readFileSync(POLICY, 'utf8'));
  assert.deepStrictEqual([...rows.keys()].sort(), ['nats-shared', 'redis-shared']);
  assert.deepStrictEqual(rows.get('nats-shared').ports, [4222, 8222]);
  assert.strictEqual(rows.get('nats-shared').expectsZero, true);
});

test('unreadable kubectl or bad argument exits 2', () => {
  const bad = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 2);
  const noKubectl = spawnSync(process.execPath, [SCRIPT, '--policy', POLICY], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '/nonexistent' },
  });
  assert.strictEqual(noKubectl.status, 2);
});

test('real policy table parses', () => {
  const { parsePolicy } = require(SCRIPT);
  const rows = parsePolicy(fs.readFileSync(path.resolve(__dirname, '../.enterprise/policies/shared-infrastructure.md'), 'utf8'));
  assert.ok(rows.size > 5);
});

test('unreadable or invalid input exits 2, not drift code 1', () => {
  const missing = spawnSync(process.execPath, [SCRIPT, '--policy', POLICY, '--cluster-json', '/nonexistent/x.json'], { encoding: 'utf8' });
  assert.strictEqual(missing.status, 2);
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'drift-'));
  try {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, '{not json');
    const bad = spawnSync(process.execPath, [SCRIPT, '--policy', POLICY, '--cluster-json', file], { encoding: 'utf8' });
    assert.strictEqual(bad.status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parsePolicy stops the section at ### subsections', () => {
  const { parsePolicy } = require(SCRIPT);
  const md = [
    '## Canonical mapping — k3s',
    '| a | `redis-shared.platform-shared-dev.svc.cluster.local:6379` | x |',
    '### Services NOT yet in shared',
    '| b | `ghost-shared.platform-shared-dev.svc.cluster.local:1` | x |',
  ].join('\n');
  assert.deepStrictEqual([...parsePolicy(md).keys()], ['redis-shared']);
});
