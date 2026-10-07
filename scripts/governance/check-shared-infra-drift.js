'use strict';

// Read-only drift gate: compares the k3s table in
// .enterprise/policies/shared-infrastructure.md with the live namespace.
// Missing/extra Service = failure (exit 1). Replica divergence = warning.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NAMESPACE = 'platform-shared-dev';
const DEFAULT_POLICY = path.resolve(__dirname, '../../.enterprise/policies/shared-infrastructure.md');

function parsePolicy(markdown, namespace = NAMESPACE) {
  const start = markdown.indexOf('## Canonical mapping — k3s');
  if (start === -1) throw new Error('k3s mapping section not found in policy');
  const rest = markdown.slice(start + 3);
  const end = rest.search(/\n#{2,6}\s/);
  const section = end < 0 ? rest : rest.slice(0, end);
  const services = new Map();
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const dnsCell = cells[2] || '';
    const notes = cells[3] || '';
    const re = new RegExp('`([a-z0-9-]+)\\.' + namespace.replaceAll('-', String.raw`\-`) + '\\.svc\\.cluster\\.local:(\\d+)`', 'g');
    const ports = [];
    let name = null;
    for (const m of dnsCell.matchAll(re)) {
      name = name || m[1];
      if (m[1] === name) ports.push(Number(m[2]));
    }
    if (!name) continue;
    for (const m of dnsCell.matchAll(/`:(\d+)`/g)) ports.push(Number(m[1]));
    services.set(name, { ports, expectsZero: /scaled to 0 replicas/i.test(notes) });
  }
  return services;
}

function parseCluster(json) {
  const items = Array.isArray(json.items) ? json.items : [];
  const services = new Map();
  const replicas = new Map();
  for (const it of items) {
    const name = it.metadata && it.metadata.name;
    if (!name) continue;
    if (it.kind === 'Service') {
      services.set(name, { ports: ((it.spec && it.spec.ports) || []).map((p) => p.port) });
    } else if (it.kind === 'Deployment' || it.kind === 'StatefulSet') {
      const n = it.spec && typeof it.spec.replicas === 'number' ? it.spec.replicas : 1;
      replicas.set(name, n);
    }
  }
  return { services, replicas };
}

function compare(policy, cluster, ignore = new Set()) {
  const failures = [];
  const warnings = [];
  for (const [name, row] of policy) {
    const live = cluster.services.get(name);
    if (!live) {
      failures.push(`Service in policy table but not in cluster: ${name}`);
      continue;
    }
    const missingPorts = row.ports.filter((p) => !live.ports.includes(p));
    if (missingPorts.length > 0)
      warnings.push(`Port mismatch for ${name}: policy ports ${missingPorts.join(',')} not exposed (live: ${live.ports.join(',')})`);
    if (cluster.replicas.has(name)) {
      const n = cluster.replicas.get(name);
      if (n === 0 && !row.expectsZero) warnings.push(`Replicas for ${name}: live 0 but policy presents it as available`);
      if (n > 0 && row.expectsZero) warnings.push(`Replicas for ${name}: live ${n} but policy says scaled to 0`);
    } else {
      warnings.push(`No Deployment/StatefulSet named ${name}; replica check skipped`);
    }
  }
  for (const name of cluster.services.keys()) {
    if (!policy.has(name) && !ignore.has(name)) failures.push(`Service in cluster but missing from policy table: ${name}`);
  }
  return { failures, warnings };
}

function main(argv) {
  const args = { policy: DEFAULT_POLICY, clusterJson: null, ignore: new Set() };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--cluster-json': {
        args.clusterJson = argv[++i];
        break;
      }
      case '--policy': {
        args.policy = path.resolve(argv[++i]);
        break;
      }
      case '--ignore': {
        for (const s of argv[++i].split(',')) args.ignore.add(s);
        break;
      }
      default: {
        process.stderr.write(`unknown argument: ${argv[i]}\n`);
        return 2;
      }
    }
  }
  let raw;
  if (args.clusterJson) {
    try {
      raw = fs.readFileSync(args.clusterJson, 'utf8');
    } catch (error) {
      process.stderr.write(`cannot read cluster json: ${error.message}\n`);
      return 2;
    }
  } else {
    const r = spawnSync('kubectl', ['-n', NAMESPACE, 'get', 'svc,deploy,sts', '-o', 'json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error || r.status !== 0) {
      process.stderr.write(`kubectl read failed: ${r.error ? r.error.message : r.stderr}\n`);
      return 2;
    }
    raw = r.stdout;
  }
  let policy;
  let cluster;
  try {
    policy = parsePolicy(fs.readFileSync(args.policy, 'utf8'));
    cluster = parseCluster(JSON.parse(raw));
  } catch (error) {
    process.stderr.write(`cannot load inputs: ${error.message}\n`);
    return 2;
  }
  const { failures, warnings } = compare(policy, cluster, args.ignore);
  const stamp = new Date().toISOString();
  for (const w of warnings) process.stdout.write(`WARN ${w} (checked ${stamp})\n`);
  for (const f of failures) process.stdout.write(`FAIL ${f}\n`);
  process.stdout.write(
    `shared-infra drift: ${policy.size} policy services, ${failures.length} failure(s), ${warnings.length} warning(s)\n`,
  );
  return failures.length > 0 ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { parsePolicy, parseCluster, compare, main };
