'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildAiJailArgs, resolveCommand } = require('./sandbox');

const FLAGS = Object.freeze([
  '--clean',
  '--lockdown',
  '--no-save-config',
  '--exec',
  '--private-home',
  '--no-network',
  '--no-docker',
  '--no-display',
  '--no-gpu',
  '--no-inherit-env',
  '--no-update-check',
]);
const RUNTIMES = Object.freeze([
  {
    id: 'node',
    binary: '/usr/bin/node',
    flag: '-e',
    script: String.raw`
const fs = require('node:fs');
const [marker, challenge] = process.argv.slice(1);
let write = false;
try { fs.writeFileSync('effect', challenge, { flag: 'wx', mode: 0o600 }); write = true; } catch {}
console.log(JSON.stringify({ write, protected_visible: fs.existsSync(marker) }));
`,
  },
  {
    id: 'python',
    binary: '/usr/bin/python3',
    flag: '-c',
    script: String.raw`
import json, os, sys
write = False
try:
    with open('effect', 'x') as target:
        target.write(sys.argv[2])
    write = True
except OSError:
    pass
print(json.dumps({'write': write, 'protected_visible': os.path.exists(sys.argv[1])}))
`,
  },
]);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function confirmedEffect(filename, challenge) {
  try {
    const stat = fs.lstatSync(filename);
    return (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      stat.size === challenge.length &&
      fs.readFileSync(filename, 'utf8') === challenge
    );
  } catch {
    return false;
  }
}

// Necessary prerequisites only. This diagnostic never grants execution authority.
function checkEngineeringSandbox({ env = process.env, launch = spawnSync } = {}) {
  const report = {
    schema_version: 1,
    status: 'blocked',
    ready: false,
    operational_authorized: false,
    scope: 'fixed-disposable-write-probes',
    profile: 'lockdown',
    checks: [],
    remaining_gates: [
      'network-and-ipc-isolation',
      'descendant-cancellation',
      'resource-bounds',
      'protected-verifier',
      'task-contract-and-snapshot',
      'real-provider-campaign',
      'operational-authorization',
    ],
  };
  let binary;
  try {
    binary = resolveCommand('ai-jail', env);
    report.backend_sha256 = digest(fs.readFileSync(binary.path));
  } catch {
    report.blocker = 'sandbox-backend-unavailable';
    return report;
  }
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-engineering-check-')));
  try {
    const home = path.join(directory, 'home');
    fs.mkdirSync(home, { mode: 0o700 });
    const marker = path.join(directory, 'protected-control');
    const challenge = randomBytes(32).toString('hex');
    fs.writeFileSync(marker, challenge, { mode: 0o600, flag: 'wx' });
    for (const runtime of RUNTIMES) {
      const workspace = path.join(directory, runtime.id);
      fs.mkdirSync(workspace, { mode: 0o700 });
      const args = buildAiJailArgs({
        sandbox: { profiles: { lockdown: { flags: FLAGS, rw_maps: [workspace] } } },
        profileName: 'lockdown',
        command: [runtime.binary, runtime.flag, runtime.script, marker, challenge],
      });
      const result = launch(binary.path, args, {
        cwd: workspace,
        env: { PATH: '/usr/bin:/bin', HOME: home },
        encoding: 'utf8',
        timeout: 10_000,
        killSignal: 'SIGKILL',
        maxBuffer: 65_536,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let observation;
      try {
        observation = JSON.parse(result.stdout);
      } catch {
        observation = null;
      }
      const valid =
        observation &&
        Object.keys(observation).sort().join(',') === 'protected_visible,write' &&
        typeof observation.write === 'boolean' &&
        typeof observation.protected_visible === 'boolean';
      const effect = confirmedEffect(path.join(workspace, 'effect'), challenge);
      const protectedIntact = confirmedEffect(marker, challenge);
      const check = {
        runtime: runtime.id,
        process_ok: !result.error && result.status === 0,
        report_valid: Boolean(valid),
        workspace_write_confirmed: effect,
        protected_marker_hidden: Boolean(valid && observation.protected_visible === false),
        protected_marker_intact: protectedIntact,
        stderr_sha256: digest(result.stderr || ''),
      };
      check.ok =
        check.process_ok && check.report_valid && observation.write === true && effect && check.protected_marker_hidden && protectedIntact;
      report.checks.push(check);
    }
    const after = resolveCommand('ai-jail', env);
    report.backend_unchanged = after.path === binary.path && digest(fs.readFileSync(after.path)) === report.backend_sha256;
    const passed = report.backend_unchanged && report.checks.every((check) => check.ok);
    report.status = passed ? 'prerequisites-passed' : 'blocked';
    report.blocker = passed ? null : 'sandbox-engineering-prerequisite-failed';
    return report;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { checkEngineeringSandbox };
