'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { createEngineeringWorkflowExample } = require('../tools/examples/engineering-task');
const cli = path.join(__dirname, '../tools/cli/hseos-cli.js');
const run = (args) =>
  spawnSync(process.execPath, [cli, 'workflow', ...args], {
    env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), HSEOS_DISABLE_UPDATE_CHECK: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  });

test('public workflow CLI validates, executes and reopens a task graph', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-workflow-cli-'));
  let state;
  try {
    const filename = path.join(directory, 'workflow.json');
    fs.writeFileSync(filename, JSON.stringify(createEngineeringWorkflowExample()));
    const validated = run(['validate', '--definition', filename, '--json']);
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(JSON.parse(validated.stdout).execution_authorized, false);
    const executed = run(['run', '--definition', filename, '--json']);
    assert.equal(executed.status, 0, executed.stdout + executed.stderr);
    const receipt = JSON.parse(executed.stdout);
    state = receipt.state;
    assert.equal(receipt.status, 'completed');
    assert.ok(receipt.tasks.every((task) => task.result === 'approved'));
    const status = run(['status', '--state', state, '--json']);
    assert.equal(status.status, 0, status.stderr);
    assert.deepEqual(JSON.parse(status.stdout), receipt);
  } finally {
    if (state) fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('retired YAML mutations fail with migration guidance and preserve legacy state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-workflow-legacy-'));
  const runDir = path.join(directory, '.hseos/runs/epic-delivery');
  fs.mkdirSync(runDir, { recursive: true });
  const filename = path.join(runDir, 'historical.yaml');
  const contents = 'workflow_id: epic-delivery\nrun_id: historical\nstatus: completed\nphases: []\n';
  fs.writeFileSync(filename, contents);
  try {
    for (const action of ['init', 'advance', 'resume', 'sync', 'gate', 'batch', 'story-status', 'story-commit']) {
      const result = run([action, 'epic-delivery', '--repo', directory, '--run-id', 'historical']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /V4_WORKFLOW_MIGRATION_REQUIRED/);
      assert.equal(fs.readFileSync(filename, 'utf8'), contents);
    }
    const inspected = run(['status', 'epic-delivery', '--repo', directory, '--run-id', 'historical', '--json']);
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.equal(JSON.parse(inspected.stdout).resumable, false);
    assert.equal(fs.readFileSync(filename, 'utf8'), contents);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
