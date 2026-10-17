'use strict';

// Measures what a real vitest run and a real tsc run need inside the isolated executor (W5-02b2).
// The consumer's node_modules is mounted read-only under /opt/hseos through the controller allowlist; nothing is
// installed or downloaded. Run in a delegated cgroup:
//   node docs/evolution/w5/evidence/w5-02b2/vitest-measurement.cjs <output.json>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../..');
const { createIsolationPolicy } = require(path.join(root, 'packages/agent-isolation-attestation'));
const { executeIsolatedCommand } = require(path.join(root, 'packages/agent-isolation-attestation/executor'));

const CONSUMER_MODULES = '/workspace/github/cambio-real/cambio-real-platforms/node_modules';
const report = { schema_version: 1, node: process.version, consumer_node_modules: CONSUMER_MODULES, runs: [] };

function storeEntry(prefix) {
  const store = path.join(CONSUMER_MODULES, '.pnpm');
  return fs.readdirSync(store).find((name) => name.startsWith(prefix));
}

async function main() {
  if (!fs.existsSync(path.join(CONSUMER_MODULES, '.pnpm'))) {
    report.verdict = 'BLOCKED';
    report.cause = `consumer pnpm store is absent: ${CONSUMER_MODULES}`;
    return;
  }
  const vitest = storeEntry('vitest@');
  const typescript = storeEntry('typescript@');
  report.vitest_store_entry = vitest;
  report.typescript_store_entry = typescript;
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-vitest-measure-'));
  try {
    const workspace = path.join(main, 'workspace');
    fs.mkdirSync(workspace, { mode: 0o700 });
    fs.writeFileSync(path.join(main, 'control'), 'control');
    fs.writeFileSync(path.join(workspace, 'sum.js'), 'export const sum = (a, b) => a + b;\n');
    fs.writeFileSync(
      path.join(workspace, 'sum.test.js'),
      "import { sum } from './sum.js';\ntest('adds', () => { expect(sum(2, 3)).toBe(5); });\ntest('keeps zero', () => { expect(sum(0, 0)).toBe(0); });\n",
    );
    fs.writeFileSync(
      path.join(workspace, 'vitest.config.mjs'),
      "export default { cacheDir: '/tmp/vitest-cache', test: { globals: true } };\n",
    );
    fs.writeFileSync(path.join(workspace, 'add.ts'), 'export const add = (a: number, b: number): number => a + b;\n');
    fs.writeFileSync(
      path.join(workspace, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ES2022', types: [] }, files: ['add.ts'] }),
    );
    const policyFor = (profile) =>
      createIsolationPolicy({
        backend: 'bwrap',
        host_workspace: workspace,
        main_checkout: main,
        protected_paths: [path.join(main, 'control')],
        toolchain_roots: [CONSUMER_MODULES],
        ...(profile === 'P0' ? {} : { profile }),
      });
    const policies = { P0: policyFor('P0'), P1: policyFor('P1') };
    const mounts = [{ source: CONSUMER_MODULES, target: '/opt/hseos/nm' }];
    const run = async (name, command, limits, profile = 'P0') => {
      const started = Date.now();
      try {
        const result = await executeIsolatedCommand({
          policy: policies[profile],
          command,
          host_node: true,
          timeout_ms: 120_000,
          max_output_bytes: 65_536,
          limits,
          readonly_mounts: mounts,
        });
        report.runs.push({
          name,
          profile,
          limits_requested: limits || 'defaults',
          status: result.status,
          exit_code: result.exit_code,
          pids_peak: result.pids_peak,
          memory_peak_bytes: result.memory_peak_bytes,
          effective_limits: result.limits,
          duration_ms: Date.now() - started,
          stdout_tail: result.stdout.slice(-700),
          stderr_tail: result.stderr.slice(-500),
        });
      } catch (error) {
        report.runs.push({
          name,
          limits_requested: limits || 'defaults',
          error: { name: error.name, code: error.code, message: error.message },
        });
      }
    };
    const runner = `/opt/hseos/nm/.pnpm/${vitest}/node_modules/vitest/vitest.mjs`;
    const vitestCommand = ['/usr/bin/node', runner, 'run', '--config', 'vitest.config.mjs', '--root', '/workspace'];
    // The workspace is read-only inside the executor, so vitest must not bundle its config next to it.
    const base = [...vitestCommand, '--configLoader', 'runner'];
    const raised = { pids_max: 256, memory_max_bytes: 2_147_483_648, nofile: 4096 };
    const middle = { pids_max: 128, memory_max_bytes: 1_073_741_824, nofile: 1024 };
    await run('vitest, config bundled into the workspace (read-only), P0, raised limits', vitestCommand, raised);
    // Node IPC between vitest and its workers needs socketpair, which P0 refuses; worker_threads do not.
    await run('vitest threads pool, P0, executor defaults', [...base, '--pool=threads']);
    await run('vitest threads pool, P0, intermediate limits', [...base, '--pool=threads'], middle);
    await run('vitest threads pool, P0, raised limits', [...base, '--pool=threads'], raised);
    await run('vitest forks pool, P0, raised limits', [...base, '--pool=forks'], raised);
    await run('vitest forks pool, P1, intermediate limits', [...base, '--pool=forks'], middle, 'P1');
    await run('vitest forks pool, P1, raised limits', [...base, '--pool=forks'], raised, 'P1');
    const tsc = `/opt/hseos/nm/.pnpm/${typescript}/node_modules/typescript/lib/tsc.js`;
    await run('tsc with the executor defaults', ['/usr/bin/node', tsc, '--noEmit', '-p', 'tsconfig.json']);
    await run('tsc with raised limits', ['/usr/bin/node', tsc, '--noEmit', '-p', 'tsconfig.json'], {
      pids_max: 64,
      memory_max_bytes: 1_073_741_824,
      nofile: 256,
    });
    report.verdict = report.runs.some((entry) => entry.exit_code === 0) ? 'MEASURED' : 'BLOCKED';
  } finally {
    fs.rmSync(main, { recursive: true, force: true });
  }
}

main()
  .catch((error) => {
    report.error = { name: error.name, code: error.code, message: error.message };
  })
  .finally(() => {
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (process.argv[2]) fs.writeFileSync(process.argv[2], text);
    process.stdout.write(text.slice(0, 5000));
  });
