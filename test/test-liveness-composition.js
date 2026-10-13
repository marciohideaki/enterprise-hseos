'use strict';

// Composition of the real LV1 stop guard with the real LV2 `hseos liveness` CLI: each side passes
// its own tests with stubs, only running them together shows whether the contract lines up.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'tools/cli/hseos-cli.js');
const GUARDS = [
  ['compiled', path.join(REPO_ROOT, '.agents/hooks/handlers/liveness-guard.cjs')],
  ['canonical', path.join(REPO_ROOT, '.enterprise/governance/hooks/handlers/liveness-guard.cjs')],
];

function project(configText) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'liveness-composition-'));
  fs.mkdirSync(path.join(root, '.hseos/config'), { recursive: true });
  fs.writeFileSync(path.join(root, '.hseos/config/agent-liveness.yaml'), configText);
  const bin = path.join(root, 'hseos-real.sh');
  fs.writeFileSync(bin, `#!/usr/bin/env bash\nexec '${process.execPath}' '${CLI}' "$@"\n`, { mode: 0o755 });
  return { root, bin };
}

function stop(guardFile, root, bin, message) {
  const out = [];
  const err = [];
  const code = require(guardFile).main({
    mode: 'stop',
    stdin: JSON.stringify({
      cwd: root,
      session_id: 's1',
      hook_event_name: 'SubagentStop',
      agent_id: 'a1',
      last_assistant_message: message,
    }),
    env: { HSEOS_LIVENESS_CLI: bin },
    cwd: root,
    now: Date.now(),
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

function check(root) {
  const result = spawnSync(process.execPath, [CLI, 'liveness', 'check', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const FULL_CONFIG = [
  'enabled: true',
  'max_wait_deadline_s: 7200',
  'max_wakes_per_cycle: 2',
  'max_notify_attempts: 6',
  'max_stop_refusals: 2',
].join('\n');

for (const [label, guardFile] of GUARDS) {
  test(`[${label}] the guard accepts the LV2 config and records declaration plus turn_end through the real CLI`, () => {
    const { root, bin } = project(FULL_CONFIG);
    const result = stop(guardFile, root, bin, 'feito\nLIVENESS: {"state":"DONE","reason":"ok","evidence":"abc123"}');
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
    assert.equal(fs.existsSync(path.join(root, '.hseos/state/liveness/pending-reports.jsonl')), false);
    const [run] = check(root).runs;
    assert.equal(run.session, 's1');
    assert.equal(run.agent, 'a1');
    assert.equal(run.reported, 'DONE');
    assert.equal(run.state, 'done');
    assert.equal(run.reason_code, 'declared');
    assert.equal(run.violation, false);
  });

  test(`[${label}] an unknown config key only warns in the guard while the strict CLI rejects the file`, () => {
    const { root, bin } = project(`${FULL_CONFIG}\nfuture_key: 1`);
    const refused = stop(guardFile, root, bin, 'aguardando');
    assert.equal(refused.code, 0);
    assert.equal(JSON.parse(refused.stdout).decision, 'block');
    assert.match(refused.stderr, /chave desconhecida ignorada: future_key/);
    const cli = spawnSync(process.execPath, [CLI, 'liveness', 'check', '--json'], { cwd: root, encoding: 'utf8' });
    // The CLI schema is strict on purpose (a typo must not pass silently); the guard stays enabled so
    // the stop protection survives a key it does not know.
    assert.equal(cli.status, 2);
    assert.deepEqual(JSON.parse(cli.stdout), { enabled: false, valid: false, errors: ['Unrecognized key: "future_key"'] });
  });
}
