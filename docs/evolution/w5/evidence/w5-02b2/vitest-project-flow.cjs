'use strict';

// Real vitest as a protected acceptance command of a managed project, through the pnpm store mount (W5-02b2).
// The consumer's node_modules is cloned as a hardlink farm (cp -al): every file keeps the pnpm content-addressed
// inode, so the store check is exercised for real. Nothing is installed or downloaded. Run in a delegated cgroup:
//   node docs/evolution/w5/evidence/w5-02b2/vitest-project-flow.cjs <output.json>
// The consumer store /workspace/.pnpm-store is trusted through the internal controller API below; a real activation
// lists it in the controller configuration (~/.config/hseos/config.yaml: toolchain.pnpm_store_dirs). No environment
// variable can add a trusted store.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../../../../..');
const { runEngineeringTask, inspectEngineeringTask } = require(path.join(repo, 'tools/cli/lib/engineering-task-runtime'));
const { projectWorkspaceSnapshot, summarizePnpmStore, trustPnpmStores, verifyPnpmStoreMount } = require(
  path.join(repo, 'tools/cli/lib/engineering-workspace'),
);
const { projectVerifierDigest } = require(path.join(repo, 'tools/cli/lib/engineering-project-verifier'));
const base = require(path.join(repo, 'test/fixtures/engineering-task/addition.json'));

const CONSUMER = '/workspace/github/cambio-real/cambio-real-platforms/node_modules';
trustPnpmStores(['/workspace/.pnpm-store']);
const report = { schema_version: 1, node: process.version, consumer_node_modules: CONSUMER, runs: [] };

function buildProject(directory, limits) {
  const root = path.join(directory, 'project');
  fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const clone = path.join(root, 'node_modules');
  // Files the consumer keeps with a single link (pnpm bookkeeping such as lock.yaml) must stay single-link in the
  // clone; they are listed before cp -al raises every link count.
  const single = [];
  const collect = (directory) => {
    for (const entry of fs.readdirSync(path.join(CONSUMER, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(relative);
      else if (entry.isFile() && fs.lstatSync(path.join(CONSUMER, relative)).nlink === 1) single.push(relative);
    }
  };
  collect('.');
  execFileSync('cp', ['-al', CONSUMER, clone]);
  for (const relative of single) {
    fs.rmSync(path.join(clone, relative));
    fs.copyFileSync(path.join(CONSUMER, relative), path.join(clone, relative));
  }
  const files = {
    '.gitignore': 'node_modules\n',
    'sum.js': 'export const sum = (a, b) => a + b;\n',
    'sum.test.js':
      "import { sum } from './sum.js';\ntest('adds', () => { expect(sum(2, 3)).toBe(5); });\ntest('keeps zero', () => { expect(sum(0, 0)).toBe(0); });\n",
    'vitest.config.mjs': "export default { cacheDir: '/tmp/vitest-cache', test: { globals: true, pool: 'threads' } };\n",
    'run-vitest.mjs': [
      "process.argv = [process.argv[0], 'vitest', 'run', '--root', '/workspace', '--configLoader', 'runner'];",
      `await import('./node_modules/.pnpm/${fs.readdirSync(path.join(CONSUMER, '.pnpm')).find((name) => name.startsWith('vitest@'))}/node_modules/vitest/vitest.mjs');`,
      '',
    ].join('\n'),
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '.');
  git('commit', '-m', 'fixture');
  const contract = structuredClone(base);
  Object.assign(contract, {
    schema_version: 2,
    execution_profile: 'managed-project',
    baseline_sha: git('rev-parse', 'HEAD'),
    initial_files: [],
    scope: { read: ['sum.js', 'sum.test.js', 'vitest.config.mjs', 'run-vitest.mjs'], write: ['sum.js'] },
    commands: [{ id: 'vitest', runtime: 'node', entrypoint: 'run-vitest.mjs', args: [], ...(limits ? { limits } : {}) }],
    workspace: { root, files_sha256: '0'.repeat(64), store_mount: 'pnpm-virtual-store' },
  });
  contract.limits.max_duration_ms = 120_000;
  contract.verifier = {
    reference: 'verifier://project/node-module-v1',
    sha256: '0'.repeat(64),
    acceptance_ids: ['a1'],
    checks: [{ path: 'sum.js', export_name: 'sum', args: [2, 3], expected: 5 }],
    command_checks: [{ command_id: 'vitest', timeout_ms: 100_000 }],
    protected_paths: ['sum.test.js', 'vitest.config.mjs', 'run-vitest.mjs'],
  };
  contract.workspace.files_sha256 = projectWorkspaceSnapshot(contract).sha256;
  contract.verifier.sha256 = projectVerifierDigest(contract);
  const filename = path.join(directory, 'task.json');
  fs.writeFileSync(filename, JSON.stringify(contract));
  return { root, filename };
}

async function run(name, limits) {
  const directory = fs.mkdtempSync(path.join(repo, '.logs', 'vitest-flow-'));
  const started = Date.now();
  try {
    const { root, filename } = buildProject(directory, limits);
    const verifyStarted = process.hrtime.bigint();
    const mount = verifyPnpmStoreMount(root);
    const verifyMs = Number((process.hrtime.bigint() - verifyStarted) / 1_000_000n);
    // The per-launch cost: the content-free fingerprint only, repeated to show the spread.
    const fingerprintMs = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = process.hrtime.bigint();
      summarizePnpmStore(root);
      fingerprintMs.push(Number((process.hrtime.bigint() - started) / 1_000_000n));
    }
    fs.writeFileSync(path.join(directory, 'responses.json'), '[]');
    const result = await runEngineeringTask({ taskContract: filename, scriptedResponses: path.join(directory, 'responses.json') });
    const evidence = await inspectEngineeringTask({ state: result.state, action: 'evidence' });
    fs.rmSync(result.state, { recursive: true, force: true });
    const check = evidence.verification?.evidence?.command_checks?.[0];
    report.runs.push({
      name,
      limits_requested: limits || 'defaults',
      task_result: result.task_result,
      reason: result.reason,
      command_check: check,
      verify_ms: verifyMs,
      fingerprint_ms: fingerprintMs,
      store_mount: { entries: mount.entries, symlinks: mount.symlinks, hardlinks: mount.hardlinks, hashed_bytes: mount.hashed_bytes },
      duration_ms: Date.now() - started,
    });
  } catch (error) {
    report.runs.push({
      name,
      limits_requested: limits || 'defaults',
      error: { name: error.name, code: error.code, reason: error.reason, file: error.file, message: error.message },
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  if (!fs.existsSync(path.join(CONSUMER, '.pnpm'))) {
    report.verdict = 'BLOCKED';
    report.cause = `consumer pnpm store is absent: ${CONSUMER}`;
    return;
  }
  fs.mkdirSync(path.join(repo, '.logs'), { recursive: true });
  await run('vitest through the store mount, executor defaults');
  await run('vitest through the store mount, intermediate limits', { pids_max: 128, memory_max_bytes: 1_073_741_824, nofile: 1024 });
  report.verdict = report.runs.some((entry) => entry.task_result === 'approved') ? 'MEASURED' : 'BLOCKED';
}

if (require.main === module) {
  main()
    .catch((error) => {
      report.error = { name: error.name, code: error.code, message: error.message };
    })
    .finally(() => {
      const text = `${JSON.stringify(report, null, 2)}\n`;
      if (process.argv[2]) fs.writeFileSync(process.argv[2], text);
      process.stdout.write(text.slice(0, 5000));
    });
}

module.exports = { buildProject };
