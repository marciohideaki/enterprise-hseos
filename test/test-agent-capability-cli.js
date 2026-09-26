'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const { resolveCapabilityPlan } = require('../tools/cli/lib/capability-catalog');
const { RelationalSessionEventStore } = require('../packages/agent-session-store');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const {
  ExecutionLedgerActivationError,
  openExecutionLedgerFileFixture,
} = require('../tools/mcp-project-state/lib/execution-ledger-schema');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'cli', 'hseos-cli.js');

function cli(...args) {
  const stdout = execFileSync(process.execPath, [CLI, 'agent', ...args, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      TMPDIR: os.tmpdir(),
      HSEOS_DISABLE_UPDATE_CHECK: '1',
    },
  });
  return JSON.parse(stdout.trim());
}

function cleanupState(state) {
  const handle = openExecutionLedgerFileFixture(state);
  handle.cleanup();
}

test('failed durable sessions return a failing CLI exit code without rewriting evidence', () => {
  const created = cli('run', '--create-only');
  const handle = openExecutionLedgerFileFixture(created.state);
  try {
    const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) });
    store.append({
      session_id: created.session_id,
      expected_version: created.current_sequence,
      events: [
        {
          schema_version: 1,
          event_id: 'event:cli-failed-fixture',
          session_id: created.session_id,
          sequence: created.current_sequence + 1,
          occurred_at: new Date().toISOString(),
          event_type: 'session.failed',
          payload: { error_code: 'budget_exceeded', message: 'fixture budget exhausted', retryable: false },
        },
      ],
    });
    const before = store.readSession(created.session_id);
    for (const json of [true, false]) {
      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'agent',
          'resume',
          '--state',
          created.state,
          '--expected-sequence',
          String(created.current_sequence + 1),
          ...(json ? ['--json'] : []),
        ],
        {
          cwd: ROOT,
          encoding: 'utf8',
          env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), HSEOS_DISABLE_UPDATE_CHECK: '1' },
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, result.stdout);
      if (json) {
        const output = JSON.parse(result.stdout);
        assert.equal(output.status, 'failed');
        assert.equal(output.state, created.state);
        assert.equal(output.world_state, null);
      } else assert.match(result.stdout, /status: failed/);
      assert.deepEqual(store.readSession(created.session_id), before);
    }
  } finally {
    handle.cleanup();
  }
});

test('resuming a cancelled session fails while explicit cancellation remains successful', () => {
  const created = cli('run', '--create-only');
  try {
    const cancelled = cli('cancel', '--state', created.state);
    assert.equal(cancelled.status, 'cancelled');
    const result = spawnSync(
      process.execPath,
      [CLI, 'agent', 'resume', '--state', created.state, '--expected-sequence', String(cancelled.current_sequence), '--json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), HSEOS_DISABLE_UPDATE_CHECK: '1' },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'cancelled');
    assert.equal(JSON.parse(result.stdout).current_sequence, cancelled.current_sequence);
  } finally {
    cleanupState(created.state);
  }
});

test('reference completion rejects a real failed write instead of claiming the requested effect', () => {
  const created = cli('run', '--create-only', '--value', 'must-not-be-claimed');
  const output = path.join(created.state, 'workspace', 'world-state.json');
  try {
    fs.mkdirSync(output);
    const child = spawnSync(
      process.execPath,
      [
        CLI,
        'agent',
        'resume',
        '--state',
        created.state,
        '--expected-sequence',
        String(created.current_sequence),
        '--message',
        'persist the requested state',
        '--json',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), HSEOS_DISABLE_UPDATE_CHECK: '1' },
      },
    );
    assert.equal(child.error, undefined);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'failed');
    assert.equal(result.terminal, true);
    assert.equal(result.output, '');
    assert.equal(result.world_state, null);
    assert.ok(fs.statSync(output).isDirectory(), 'the requested state was not written');
    const handle = openExecutionLedgerFileFixture(created.state);
    try {
      const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) });
      const events = store.readSession(created.session_id);
      assert.equal(events.filter((event) => event.event_type === 'tool.execution.started').length, 1);
      const failedTool = events.find((event) => event.event_type === 'tool.execution.completed');
      assert.equal(failedTool.payload.outcome.status, 'uncertain');
      assert.equal(failedTool.payload.outcome.error.code, 'EXECUTION_OUTCOME_IN_DOUBT');
      assert.equal(events.at(-1).event_type, 'session.failed');
      assert.equal(events.at(-1).payload.error_code, 'tool_failed');
    } finally {
      handle.close();
    }
  } finally {
    cleanupState(created.state);
  }
});

test('agent-reference capability plan selects exactly one keyless model and kernel runtime', () => {
  const plan = resolveCapabilityPlan({ root: ROOT, profile: 'agent-reference' });
  assert.deepEqual(plan.materialization.selected_model_providers, ['model:scripted-reference']);
  assert.deepEqual(plan.materialization.selected_runtime_providers, ['runtime:hseos-kernel']);
  assert.deepEqual(plan.materialization.secret_refs, []);
  assert.deepEqual(plan.agent, {
    execution_mode: 'kernel',
    model_provider_id: 'model:scripted-reference',
    runtime_provider_id: 'runtime:hseos-kernel',
    secret_refs: [],
  });
  assert.ok(plan.install_paths.includes('packages/agent-runtime/'));
  assert.ok(plan.install_paths.includes('tools/cli/commands/agent.js'));
  assert.ok(!plan.install_paths.includes('packages/runtime-providers/'));
  assert.ok(!JSON.stringify(plan).includes('runtime:codex'));
  assert.ok(!JSON.stringify(plan).includes('runtime:claude-code'));
  assert.ok(!JSON.stringify(plan).includes('runtime:deepseek-harness'));
});

test('agent run completes a governed tool loop and exposes externally verifiable state', () => {
  const result = cli('run', '--value', 'clean-env-value', '--message', 'write reference state');
  try {
    assert.equal(result.operation, 'run');
    assert.equal(result.profile, 'agent-reference');
    assert.equal(result.status, 'completed');
    assert.equal(result.terminal, true);
    assert.match(result.output, /clean-env-value/);
    assert.equal(path.dirname(path.dirname(result.world_state)), result.state);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.world_state, 'utf8')), {
      schema_version: 1,
      value: 'clean-env-value',
    });
    assert.equal(path.dirname(result.state), fs.realpathSync(os.tmpdir()));
  } finally {
    cleanupState(result.state);
  }
});

test('agent resume crosses a process boundary with optimistic sequence and then completes', () => {
  const created = cli('run', '--create-only', '--value', 'resumed-value');
  try {
    assert.equal(created.operation, 'created');
    assert.equal(created.terminal, false);
    assert.equal(created.world_state, null);
    const resumed = cli(
      'resume',
      '--state',
      created.state,
      '--expected-sequence',
      String(created.current_sequence),
      '--message',
      'continue the pending reference session',
    );
    assert.equal(resumed.session_id, created.session_id);
    assert.equal(resumed.operation, 'resume-and-send');
    assert.equal(resumed.status, 'completed');
    assert.deepEqual(JSON.parse(fs.readFileSync(resumed.world_state, 'utf8')), {
      schema_version: 1,
      value: 'resumed-value',
    });
  } finally {
    cleanupState(created.state);
  }
});

test('agent cancel durably terminalizes a created reference session', () => {
  const created = cli('run', '--create-only', '--value', 'never-written');
  try {
    const cancelled = cli('cancel', '--state', created.state, '--reason', 'reference cancellation check');
    assert.equal(cancelled.session_id, created.session_id);
    assert.equal(cancelled.operation, 'cancel');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.terminal, true);
    assert.equal(cancelled.world_state, null);
  } finally {
    cleanupState(created.state);
  }
});

test('temporary fixture reopen rejects unmarked and symlink aliases', () => {
  const created = cli('run', '--create-only');
  const alias = path.join(os.tmpdir(), `hseos-ledger-fixture-alias-${process.pid}`);
  try {
    assert.throws(() => openExecutionLedgerFileFixture(path.join(created.state, 'workspace')), ExecutionLedgerActivationError);
    fs.symlinkSync(created.state, alias, 'dir');
    assert.throws(() => openExecutionLedgerFileFixture(alias), ExecutionLedgerActivationError);
  } finally {
    if (fs.existsSync(alias)) fs.unlinkSync(alias);
    cleanupState(created.state);
  }
});

test('resume requires caller-supplied optimistic sequence', () => {
  const created = cli('run', '--create-only');
  try {
    assert.throws(() => cli('resume', '--state', created.state, '--message', 'unsafe implicit resume'), /expected_sequence is required/);
  } finally {
    cleanupState(created.state);
  }
});

test('resume rejects a workspace replaced by an escaping symlink before tool execution', () => {
  const created = cli('run', '--create-only', '--value', 'must-stay-confined');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-reference-outside-'));
  const workspace = path.join(created.state, 'workspace');
  try {
    fs.rmSync(workspace, { recursive: true });
    fs.symlinkSync(outside, workspace, 'dir');
    assert.throws(
      () =>
        cli(
          'resume',
          '--state',
          created.state,
          '--expected-sequence',
          String(created.current_sequence),
          '--message',
          'attempt escaped write',
        ),
      /reference workspace/,
    );
    assert.equal(fs.existsSync(path.join(outside, 'world-state.json')), false);
  } finally {
    cleanupState(created.state);
    fs.rmSync(outside, { recursive: true });
  }
});

test('resume rejects a reference manifest changed after durable session creation', () => {
  const created = cli('run', '--create-only', '--value', 'durably-bound');
  const manifestPath = path.join(created.state, 'reference-agent.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.value = 'tampered-between-processes';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    assert.throws(
      () =>
        cli(
          'resume',
          '--state',
          created.state,
          '--expected-sequence',
          String(created.current_sequence),
          '--message',
          'attempt changed provider configuration',
        ),
      /reference manifest differs from the durable session binding/,
    );
    assert.equal(fs.existsSync(path.join(created.state, 'workspace', 'world-state.json')), false);
  } finally {
    cleanupState(created.state);
  }
});
