'use strict';
// Run from this task worktree. Fixed disposable probes; no provider or secret.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveCommand, resolveSandbox, buildAiJailArgs } = require(path.join(process.cwd(), 'tools/cli/lib/sandbox'));
const { sandboxWithBrokerMap } = require(path.join(process.cwd(), 'tools/cli/lib/bound-kernel-supervisor'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-runtime-visibility-'));
try {
  const binary = resolveCommand('ai-jail').path;
  const runtime = path.join(directory, 'node');
  fs.copyFileSync(process.execPath, runtime);
  fs.chmodSync(runtime, 0o500);
  const observations = [];
  for (const explicitMap of [false, true]) {
    const sandbox = sandboxWithBrokerMap(resolveSandbox(directory).sandbox, directory);
    if (explicitMap) sandbox.profiles.lockdown.ro_maps = [directory];
    const args = buildAiJailArgs({ sandbox, profileName: 'lockdown', command: [runtime, '--version'] });
    const options = { cwd: process.cwd(), env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 15_000, maxBuffer: 65_536 };
    const executed = spawnSync(binary, args, options);
    const dryRun = spawnSync(binary, ['--dry-run', ...args], options);
    observations.push({
      explicit_map: explicitMap,
      exit_code: executed.status,
      stdout: executed.stdout,
      stderr: executed.stderr,
      dry_run: dryRun.stdout,
      dry_run_exit_code: dryRun.status,
    });
  }
  console.log(JSON.stringify({ provider_calls: 0, observations }, null, 2));
  process.exitCode = observations.every((item) => item.exit_code === 0) ? 0 : 2;
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
