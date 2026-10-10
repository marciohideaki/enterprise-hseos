'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const yaml = require('yaml');
const { manifest } = require('./provider-control');
const { engineeringDigest } = require('../../tools/cli/lib/engineering-task-state');
const { nativeArtifactDigest } = require('../../tools/cli/lib/provider-native-adapter');
const { readBinding } = require('../../tools/cli/lib/provider-claude-account-adapter');

const FIXTURE = path.resolve(__dirname, '../fixtures/fake-claude-cli.mjs');
const IDENTITY = { authMethod: 'claude.ai', email: 'owner@example.invalid', orgId: 'org-fixture', subscriptionType: 'max' };
const PATH = `${path.dirname(process.execPath)}:/usr/bin:/bin`;

/** Runs the real worker as a plain child (no cgroup) so adapter tests exercise the full stack. */
function plainRunner(t) {
  return async ({ args, input, timeout_ms, signal }) => {
    const group = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-claude-group-'));
    fs.writeFileSync(path.join(group, 'cgroup.procs'), '');
    t.after(() => fs.rmSync(group, { recursive: true, force: true }));
    const child = spawn(process.execPath, args, { env: {}, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout_ms);
    signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
    child.stdin.end(JSON.stringify({ ...input, group }));
    await new Promise((resolve) => child.once('close', resolve));
    clearTimeout(timer);
    try {
      const envelope = JSON.parse(output);
      if (!envelope.result) throw new Error('uncertain');
      return envelope.result;
    } catch {
      throw Object.assign(new Error('CONTROL_OUTCOME_UNCERTAIN'), { code: 'CONTROL_OUTCOME_UNCERTAIN' });
    }
  };
}

function setup(t, { mode = {}, run = 'normal' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-claude-account-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cwd = path.join(home, 'work');
  fs.mkdirSync(cwd);
  const state = { auth: { loggedIn: true, apiProvider: 'firstParty', ...IDENTITY }, version: '2.1.296', run, ...mode };
  const writeMode = (patch = {}) => fs.writeFileSync(path.join(home, 'fake-mode.json'), JSON.stringify({ ...state, ...patch }));
  writeMode();
  const executable = path.join(home, 'claude');
  fs.copyFileSync(FIXTURE, executable);
  fs.chmodSync(executable, 0o755);
  const id = randomUUID();
  const settings = { model: 'pinned-model', tasks: { [id]: { prompt: 'ready' } }, environment: { HOME: home, PATH } };
  const filename = path.join(home, 'binding.yaml');
  fs.writeFileSync(
    filename,
    yaml.stringify({
      schema_version: 1,
      profile_id: 'agent-claude-cli-account-candidate',
      runtime_provider_id: 'runtime:claude-cli',
      executable,
      cwd,
      env_names: [],
      secret_refs: [],
    }),
  );
  const m = manifest('claude', 'account', 'client');
  m.adapter = 'hseos-claude-campaign-v1';
  m.provider_version = '2.1.296';
  m.artifact_sha256 = nativeArtifactDigest();
  m.binding_sha256 = engineeringDigest({ binding: readBinding(filename), options: settings });
  m.authentication.credential = { name: 'claude-login', source_ref: `file://${home}/.claude` };
  m.authentication.account_sha256 = engineeringDigest(IDENTITY);
  const create = (overrides = {}, wrap = (runner) => runner) =>
    require('../../tools/cli/lib/provider-native-adapter').createNativeCampaignAdapter(
      { manifest: m, binding: filename, options: settings, ...overrides },
      { processRunner: wrap(plainRunner(t)) },
    );
  const calls = () =>
    fs.existsSync(path.join(home, 'fake-calls.jsonl'))
      ? fs
          .readFileSync(path.join(home, 'fake-calls.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  return { home, cwd, executable, id, settings, filename, m, create, writeMode, calls, state };
}
/** Node injects NODE_V8_COVERAGE into children under c8; tolerate it only when this very process has it. */
const childEnvironment = (names) => names.filter((name) => !(name === 'NODE_V8_COVERAGE' && process.env.NODE_V8_COVERAGE !== undefined));
module.exports = { childEnvironment, setup, plainRunner, IDENTITY, PATH, FIXTURE };
